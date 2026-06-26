import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { hashPassword } from "../../shared/auth/password.js";

const jar = (c: string[]) => c.map((x) => x.split(";")[0]).join("; ");
let adminId = "", tenantId = "";

beforeEach(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  tenantId = t.id;
  const pw = await hashPassword("password123");
  const a = await basePrisma.user.create({ data: { tenantId: t.id, email: "admin@acme.test", name: "A", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: pw } });
  adminId = a.id;
});
afterAll(async () => { await resetDb(); });

describe("audit.record writes the table", () => {
  it("a property create writes exactly one audit row with actor + tenant", async () => {
    const admin = (await client().post("/api/auth/login").set("Host", HOST).send({ email: "admin@acme.test", password: "password123" })).headers["set-cookie"] as unknown as string[];
    const res = await client().post("/api/properties").set("Host", HOST).set("Cookie", jar(admin)).send({ name: "HQ" });
    expect(res.status).toBe(200);
    const rows = await basePrisma.auditLog.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("property.create");
    expect(rows[0]!.entityType).toBe("Property");
    expect(rows[0]!.actorUserId).toBe(adminId);
    expect(rows[0]!.impersonatedBy).toBeNull();
  });

  it("an action performed while impersonating stamps impersonatedBy", async () => {
    // start impersonation → SUPER_ADMIN token stamped with impersonatedBy=<platform id>
    const imp = (await client().post("/api/platform/impersonate").set("Host", HOST).send({ platformId: "ops-1", password: "platformpass" })).headers["set-cookie"] as unknown as string[];
    const res = await client().post("/api/properties").set("Host", HOST).set("Cookie", jar(imp)).send({ name: "Imp HQ" });
    expect(res.status).toBe(200);
    const row = await basePrisma.auditLog.findFirstOrThrow({ where: { tenantId, action: "property.create" } });
    expect(row.impersonatedBy).toBe("ops-1");
    expect(row.actorUserId).toBe("platform:ops-1");
  });
});
