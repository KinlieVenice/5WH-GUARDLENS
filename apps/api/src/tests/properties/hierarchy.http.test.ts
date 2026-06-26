// Proves end-to-end over HTTP: an admin builds property→building→floor→zone and reads the tree; a non-admin (supervisor) write is 403; the tree of an un-granted property is 404 for a supervisor (200 for a granted one); a cross-property floorId zone is 400; and archiving a zone drops it from the next tree read (cache busted).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { hashPassword } from "../../shared/auth/password.js";
import { redis } from "../../shared/redis/client.js";

const jar = (c: string[]) => c.map((x) => x.split(";")[0]).join("; ");
let admin: string[] = [], supe: string[] = [], grantedPropertyId = "";

beforeAll(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  const pw = await hashPassword("password123");
  await basePrisma.user.create({ data: { tenantId: t.id, email: "admin@acme.test", name: "A", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: pw } });
  const s = await basePrisma.user.create({ data: { tenantId: t.id, email: "supe@acme.test", name: "S", role: "SUPERVISOR", status: "ACTIVE", passwordHash: pw } });
  const granted = await basePrisma.property.create({ data: { tenantId: t.id, name: "Granted" } });
  grantedPropertyId = granted.id;
  await basePrisma.userPropertyAccess.create({ data: { tenantId: t.id, userId: s.id, propertyId: granted.id } });
  admin = (await client().post("/api/auth/login").set("Host", HOST).send({ email: "admin@acme.test", password: "password123" })).headers["set-cookie"] as unknown as string[];
  supe = (await client().post("/api/auth/login").set("Host", HOST).send({ email: "supe@acme.test", password: "password123" })).headers["set-cookie"] as unknown as string[];
});
afterAll(async () => { await resetDb(); });

// redis imported to share the same connection lifecycle as the app
void redis;

describe("hierarchy HTTP", () => {
  it("admin builds property→building→floor→zone and reads the tree", async () => {
    const p = await client().post("/api/properties").set("Host", HOST).set("Cookie", jar(admin)).send({ name: "HQ" });
    expect(p.status).toBe(200);
    const pid = p.body.data.id;
    const b = await client().post(`/api/properties/${pid}/buildings`).set("Host", HOST).set("Cookie", jar(admin)).send({ name: "Tower" });
    expect(b.status).toBe(200);
    const f = await client().post(`/api/buildings/${b.body.data.id}/floors`).set("Host", HOST).set("Cookie", jar(admin)).send({ name: "G", level: 0 });
    expect(f.status).toBe(200);
    const z = await client().post(`/api/properties/${pid}/zones`).set("Host", HOST).set("Cookie", jar(admin)).send({ name: "Lobby", floorId: f.body.data.id });
    expect(z.status).toBe(200);
    const tree = await client().get(`/api/properties/${pid}/tree`).set("Host", HOST).set("Cookie", jar(admin));
    expect(tree.body.data.buildings[0].floors[0].zones[0].name).toBe("Lobby");
  });

  it("non-admin (supervisor) cannot write (403)", async () => {
    const r = await client().post("/api/properties").set("Host", HOST).set("Cookie", jar(supe)).send({ name: "Nope" });
    expect(r.status).toBe(403);
  });

  it("tree of an un-granted property 404s for a supervisor", async () => {
    const p = await client().post("/api/properties").set("Host", HOST).set("Cookie", jar(admin)).send({ name: "Secret" });
    const r = await client().get(`/api/properties/${p.body.data.id}/tree`).set("Host", HOST).set("Cookie", jar(supe));
    expect(r.status).toBe(404);
    const okRes = await client().get(`/api/properties/${grantedPropertyId}/tree`).set("Host", HOST).set("Cookie", jar(supe));
    expect(okRes.status).toBe(200);
  });

  it("rejects a zone whose floorId is in another property (400)", async () => {
    const p1 = (await client().post("/api/properties").set("Host", HOST).set("Cookie", jar(admin)).send({ name: "PA" })).body.data.id;
    const p2 = (await client().post("/api/properties").set("Host", HOST).set("Cookie", jar(admin)).send({ name: "PB" })).body.data.id;
    const b2 = (await client().post(`/api/properties/${p2}/buildings`).set("Host", HOST).set("Cookie", jar(admin)).send({ name: "B" })).body.data.id;
    const f2 = (await client().post(`/api/buildings/${b2}/floors`).set("Host", HOST).set("Cookie", jar(admin)).send({ name: "G" })).body.data.id;
    const r = await client().post(`/api/properties/${p1}/zones`).set("Host", HOST).set("Cookie", jar(admin)).send({ name: "Bad", floorId: f2 });
    expect(r.status).toBe(400);
  });

  it("archive drops a zone from the tree and busts the cache", async () => {
    const pid = (await client().post("/api/properties").set("Host", HOST).set("Cookie", jar(admin)).send({ name: "Cache" })).body.data.id;
    const z = (await client().post(`/api/properties/${pid}/zones`).set("Host", HOST).set("Cookie", jar(admin)).send({ name: "Temp" })).body.data.id;
    await client().get(`/api/properties/${pid}/tree`).set("Host", HOST).set("Cookie", jar(admin)); // populate cache
    await client().patch(`/api/zones/${z}`).set("Host", HOST).set("Cookie", jar(admin)).send({}); // no-op patch keeps cache
    const r1 = await client().patch(`/api/zones/${z}/archive`).set("Host", HOST).set("Cookie", jar(admin));
    expect(r1.status).toBe(200);
    const tree = await client().get(`/api/properties/${pid}/tree`).set("Host", HOST).set("Cookie", jar(admin));
    expect(tree.body.data.zones.find((x: { name: string }) => x.name === "Temp")).toBeUndefined();
  });
});
