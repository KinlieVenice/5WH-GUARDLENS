import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { hashPassword } from "../../shared/auth/password.js";
import { redis } from "../../shared/redis/client.js";

const jar = (c: string[]) => c.map((x) => x.split(";")[0]).join("; ");
let admin: string[] = [], supe: string[] = [], tenantId = "";
const v1 = [{ key: "location", label: "Location", type: "text", required: true }];
const v2 = [
  { key: "location", label: "Location", type: "text", required: true },
  { key: "value", label: "Value", type: "text", required: false },
];

beforeAll(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  tenantId = t.id;
  const pw = await hashPassword("password123");
  await basePrisma.user.create({ data: { tenantId: t.id, email: "admin@acme.test", name: "A", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: pw } });
  await basePrisma.user.create({ data: { tenantId: t.id, email: "supe@acme.test", name: "S", role: "SUPERVISOR", status: "ACTIVE", passwordHash: pw } });
  admin = (await client().post("/api/auth/login").set("Host", HOST).send({ email: "admin@acme.test", password: "password123" })).headers["set-cookie"] as unknown as string[];
  supe = (await client().post("/api/auth/login").set("Host", HOST).send({ email: "supe@acme.test", password: "password123" })).headers["set-cookie"] as unknown as string[];
});
afterAll(async () => { await resetDb(); });
void redis;

describe("report-types HTTP", () => {
  it("admin creates a type, edits it (v2), and v1 still resolves", async () => {
    const c = await client().post("/api/report-types").set("Host", HOST).set("Cookie", jar(admin)).send({ key: "theft", name: "Theft", lane: "SECURITY", fields: v1 });
    expect(c.status).toBe(200);
    const id = c.body.data.type.id;

    const e = await client().post(`/api/report-types/${id}/versions`).set("Host", HOST).set("Cookie", jar(admin)).send({ fields: v2 });
    expect(e.status).toBe(200);
    expect(e.body.data.version).toBe(2);

    const d = await client().get(`/api/report-types/${id}`).set("Host", HOST).set("Cookie", jar(admin));
    expect(d.body.data.versions).toHaveLength(2);
    expect(d.body.data.versions[0].version).toBe(1);
    expect(d.body.data.versions[0].schema).toEqual(v1); // v1 intact
  });

  it("a create writes an audit row", async () => {
    await client().post("/api/report-types").set("Host", HOST).set("Cookie", jar(admin)).send({ key: "haz", name: "Haz", lane: "SAFETY", fields: v1 });
    const row = await basePrisma.auditLog.findFirst({ where: { tenantId, action: "report_type.create" } });
    expect(row).not.toBeNull();
  });

  it("non-admin cannot create (403)", async () => {
    const r = await client().post("/api/report-types").set("Host", HOST).set("Cookie", jar(supe)).send({ key: "x", name: "X", lane: "SECURITY", fields: v1 });
    expect(r.status).toBe(403);
  });

  it("an invalid field schema is rejected (400)", async () => {
    const r = await client().post("/api/report-types").set("Host", HOST).set("Cookie", jar(admin)).send({ key: "bad", name: "Bad", lane: "SECURITY", fields: [{ key: "d", label: "D", type: "dropdown", required: true }] });
    expect(r.status).toBe(400);
  });

  it("retire via PATCH isActive:false", async () => {
    const c = await client().post("/api/report-types").set("Host", HOST).set("Cookie", jar(admin)).send({ key: "lost", name: "Lost", lane: "SECURITY", fields: v1 });
    const id = c.body.data.type.id;
    const p = await client().patch(`/api/report-types/${id}`).set("Host", HOST).set("Cookie", jar(admin)).send({ isActive: false });
    expect(p.status).toBe(200);
    const list = await client().get("/api/report-types?activeOnly=true").set("Host", HOST).set("Cookie", jar(admin));
    expect(list.body.data.find((t: { key: string }) => t.key === "lost")).toBeUndefined();
  });

  it("PATCH cannot change immutable key or isSystem (.strict rejects)", async () => {
    const c = await client().post("/api/report-types").set("Host", HOST).set("Cookie", jar(admin)).send({ key: "immut", name: "Immut", lane: "SECURITY", fields: v1 });
    const id = c.body.data.type.id;
    const r1 = await client().patch(`/api/report-types/${id}`).set("Host", HOST).set("Cookie", jar(admin)).send({ key: "hacked" });
    expect(r1.status).toBe(400);
    const r2 = await client().patch(`/api/report-types/${id}`).set("Host", HOST).set("Cookie", jar(admin)).send({ isSystem: true });
    expect(r2.status).toBe(400);
  });
});
