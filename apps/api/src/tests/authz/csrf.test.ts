import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { hashPassword } from "../../shared/auth/password.js";

let adminCookies: string[] = [], supeCookies: string[] = [];
function jar(cookies: string[]): string { return cookies.map((c) => c.split(";")[0]).join("; "); }
function csrfValue(cookies: string[]): string { return cookies.find((c) => c.startsWith("hs_csrf="))!.split(";")[0]!.replace("hs_csrf=", ""); }

beforeAll(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  const pw = await hashPassword("password123");
  await basePrisma.user.create({ data: { tenantId: t.id, email: "admin@acme.test", name: "A", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: pw } });
  const p1 = await basePrisma.property.create({ data: { tenantId: t.id, name: "P1" } });
  await basePrisma.property.create({ data: { tenantId: t.id, name: "P2" } });
  const supe = await basePrisma.user.create({ data: { tenantId: t.id, email: "supe@acme.test", name: "S", role: "SUPERVISOR", status: "ACTIVE", passwordHash: pw } });
  await basePrisma.userPropertyAccess.create({ data: { tenantId: t.id, userId: supe.id, propertyId: p1.id } });
  adminCookies = (await client().post("/api/auth/login").set("Host", HOST).send({ email: "admin@acme.test", password: "password123" })).headers["set-cookie"] as unknown as string[];
  supeCookies = (await client().post("/api/auth/login").set("Host", HOST).send({ email: "supe@acme.test", password: "password123" })).headers["set-cookie"] as unknown as string[];
});
afterAll(async () => { await resetDb(); });

describe("GET /api/properties (B8) + CSRF", () => {
  it("admin sees all tenant properties", async () => {
    const res = await client().get("/api/properties").set("Host", HOST).set("Cookie", jar(adminCookies));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
  it("supervisor sees only assigned properties", async () => {
    const res = await client().get("/api/properties").set("Host", HOST).set("Cookie", jar(supeCookies));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
  it("logout without CSRF header is rejected (403)", async () => {
    const res = await client().post("/api/auth/logout").set("Host", HOST).set("Cookie", jar(adminCookies));
    expect(res.status).toBe(403);
  });
  it("logout with the CSRF header succeeds", async () => {
    const res = await client().post("/api/auth/logout").set("Host", HOST).set("Cookie", jar(adminCookies)).set("x-csrf-token", csrfValue(adminCookies));
    expect(res.status).toBe(200);
  });
});
