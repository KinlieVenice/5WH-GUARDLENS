import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { verifyAccessToken } from "../../shared/auth/jwt.js";
import { ACCESS_COOKIE } from "../../shared/auth/cookies.js";

let spy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  spy = vi.spyOn(console, "info").mockImplementation(() => {});
  await resetDb();
  await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
});
afterAll(async () => {
  spy.mockRestore();
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
});
