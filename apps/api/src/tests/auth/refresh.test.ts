// Proves: refresh-token rotation (each token single-use), the benign double-submit grace window, and that replaying a used token after grace burns the whole session (theft detection).
// Proves: refresh-token rotation (each token single-use), the benign double-submit grace window, and that replaying a used token after grace burns the whole session (theft detection).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { hashPassword } from "../../shared/auth/password.js";
import { hashToken } from "../../shared/auth/tokens.js";

function rtCookie(cookies: string[]): string {
  const c = cookies.find((x) => x.startsWith("hs_rt="))!;
  return c.split(";")[0]!; // "hs_rt=<raw>"
}
async function loginAndGetCookies() {
  const res = await client().post("/api/auth/login").set("Host", HOST).send({ email: "a@acme.test", password: "password123" });
  return res.headers["set-cookie"] as unknown as string[];
}

beforeEach(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  await basePrisma.user.create({ data: { tenantId: t.id, email: "a@acme.test", name: "A", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: await hashPassword("password123") } });
});
afterAll(async () => { await resetDb(); });

describe("POST /api/auth/refresh", () => {
  it("rotates a fresh refresh token and issues new cookies", async () => {
    const cookies = await loginAndGetCookies();
    const res = await client().post("/api/auth/refresh").set("Host", HOST).set("Cookie", rtCookie(cookies)).send();
    expect(res.status).toBe(200);
    const newCookies = res.headers["set-cookie"] as unknown as string[];
    expect(newCookies.some((c) => c.startsWith("hs_rt="))).toBe(true);
  });

  it("replaying an OLD token within grace succeeds without revoking the family", async () => {
    const cookies = await loginAndGetCookies();
    const old = rtCookie(cookies);
    await client().post("/api/auth/refresh").set("Host", HOST).set("Cookie", old).send(); // first rotation
    const res = await client().post("/api/auth/refresh").set("Host", HOST).set("Cookie", old).send(); // replay within grace
    expect(res.status).toBe(200);
    const session = await basePrisma.session.findFirstOrThrow();
    expect(session.revokedAt).toBeNull();
  });

  it("replaying an OLD token OUTSIDE grace revokes the whole session family", async () => {
    const cookies = await loginAndGetCookies();
    const old = rtCookie(cookies);
    await client().post("/api/auth/refresh").set("Host", HOST).set("Cookie", old).send(); // rotate
    // Force the used token outside the grace window:
    const raw = old.replace("hs_rt=", "");
    await basePrisma.refreshToken.update({ where: { tokenHash: hashToken(raw) }, data: { usedAt: new Date(Date.now() - 60_000) } });
    const res = await client().post("/api/auth/refresh").set("Host", HOST).set("Cookie", old).send();
    expect(res.status).toBe(401);
    const session = await basePrisma.session.findFirstOrThrow();
    expect(session.revokedAt).not.toBeNull();
  });
});
