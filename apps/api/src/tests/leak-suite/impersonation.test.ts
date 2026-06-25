import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { verifyAccessToken } from "../../shared/auth/jwt.js";
import { ACCESS_COOKIE, CSRF_COOKIE } from "../../shared/auth/cookies.js";

function jar(cookies: string[]): string { return cookies.map((c) => c.split(";")[0]).join("; "); }
function csrfValue(cookies: string[]): string {
  return cookies.find((c) => c.startsWith(`${CSRF_COOKIE}=`))!.split(";")[0]!.replace(`${CSRF_COOKIE}=`, "");
}

beforeAll(async () => {
  await resetDb();
  await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
});
afterAll(async () => {
  await resetDb();
});

describe("impersonation seam (B6)", () => {
  it("mints a tenant token stamped with impersonatedBy", async () => {
    // env PLATFORM_ADMINS for tests holds id "ops-1" with password "platformpass" (see test setup note)
    const res = await client().post("/api/platform/impersonate").set("Host", HOST).send({ platformId: "ops-1", password: "platformpass" });
    expect(res.status).toBe(200);
    const cookies = res.headers["set-cookie"] as unknown as string[];
    const at = cookies.find((c) => c.startsWith(`${ACCESS_COOKIE}=`))!.split(";")[0]!.replace(`${ACCESS_COOKIE}=`, "");
    const claims = verifyAccessToken(decodeURIComponent(at));
    expect(claims.impersonatedBy).toBe("ops-1");
    expect(claims.role).toBe("SUPER_ADMIN");
  });
  it("rejects a bad platform credential", async () => {
    const res = await client().post("/api/platform/impersonate").set("Host", HOST).send({ platformId: "ops-1", password: "wrong" });
    expect(res.status).toBe(401);
  });
  it("impersonation session logout returns 200 and clears auth cookies (not 500)", async () => {
    // Obtain an impersonation session
    const impRes = await client().post("/api/platform/impersonate").set("Host", HOST).send({ platformId: "ops-1", password: "platformpass" });
    expect(impRes.status).toBe(200);
    const cookies = impRes.headers["set-cookie"] as unknown as string[];
    // POST logout with the impersonation cookies + CSRF header
    const logoutRes = await client()
      .post("/api/auth/logout")
      .set("Host", HOST)
      .set("Cookie", jar(cookies))
      .set("x-csrf-token", csrfValue(cookies));
    expect(logoutRes.status).toBe(200);
    // Response must clear the access cookie (set-cookie should contain hs_at with empty/cleared value)
    const responseCookies: string[] = logoutRes.headers["set-cookie"] as unknown as string[];
    const clearedAt = responseCookies?.find((c) => c.startsWith(`${ACCESS_COOKIE}=`));
    expect(clearedAt).toBeDefined();
    // clearCookie sets Max-Age=0 or Expires in the past, or an empty value
    expect(clearedAt).toMatch(/Max-Age=0|Expires=.*GMT/i);
  });
});
