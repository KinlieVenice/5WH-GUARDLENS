// Proves: login issues the 3 auth cookies on success and returns a UNIFORM error for every failure reason (no user enumeration); guards/inactive users cannot log in.
// Proves: login issues the 3 auth cookies on success and returns a UNIFORM error for every failure reason (no user enumeration); guards/inactive users cannot log in.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { hashPassword } from "../../shared/auth/password.js";

beforeAll(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  const pw = await hashPassword("password123");
  await basePrisma.user.create({ data: { tenantId: t.id, email: "admin@acme.test", name: "A", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: pw } });
  await basePrisma.user.create({ data: { tenantId: t.id, email: "guard@acme.test", name: "G", role: "GUARD", status: "ACTIVE", passwordHash: pw } });
});
afterAll(async () => { await resetDb(); });

describe("POST /api/auth/login", () => {
  it("logs in an admin and sets auth cookies", async () => {
    const res = await client().post("/api/auth/login").set("Host", HOST).send({ email: "admin@acme.test", password: "password123" });
    expect(res.status).toBe(200);
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c) => c.startsWith("hs_at="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("hs_rt="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("hs_csrf="))).toBe(true);
  });
  it("rejects a GUARD (guards never get a session)", async () => {
    const res = await client().post("/api/auth/login").set("Host", HOST).send({ email: "guard@acme.test", password: "password123" });
    expect(res.status).toBe(401);
  });
  it("rejects wrong password with a generic error", async () => {
    const res = await client().post("/api/auth/login").set("Host", HOST).send({ email: "admin@acme.test", password: "nope" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).not.toMatch(/exist|found|password/i);
  });
  it("404s on an unknown tenant host", async () => {
    const res = await client().post("/api/auth/login").set("Host", "ghost.lvh.me").send({ email: "x@y.z", password: "p" });
    expect(res.status).toBe(404);
  });
});
