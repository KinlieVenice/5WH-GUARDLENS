import { describe, it, expect, afterAll } from "vitest";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { resetDb } from "../helpers/test-db.js";

afterAll(async () => { await resetDb(); });

describe("AuditLog append-only", () => {
  it("blocks direct UPDATE/DELETE, allows INSERT, and tenant-cascade clears rows", async () => {
    await resetDb();
    const t = await basePrisma.tenant.create({ data: { name: "T", slug: "t-audit" } });
    const row = await basePrisma.auditLog.create({ data: { tenantId: t.id, action: "x.create", entityType: "X", entityId: "1" } });
    await expect(basePrisma.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow();
    await expect(basePrisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(basePrisma.auditLog.deleteMany({ where: { id: row.id } })).rejects.toThrow();
    // FK cascade from Tenant does NOT fire the trigger, so this clears the row:
    await basePrisma.tenant.delete({ where: { id: t.id } });
    expect(await basePrisma.auditLog.count()).toBe(0);
  });

  it("records a correction as a new row linking to the original (correctsId)", async () => {
    await resetDb();
    const t = await basePrisma.tenant.create({ data: { name: "T2", slug: "t2-audit" } });
    const orig = await basePrisma.auditLog.create({ data: { tenantId: t.id, action: "a", entityType: "X", entityId: "1" } });
    const corr = await basePrisma.auditLog.create({ data: { tenantId: t.id, action: "a.correct", entityType: "X", entityId: "1", correctsId: orig.id } });
    const withRel = await basePrisma.auditLog.findUniqueOrThrow({ where: { id: corr.id }, include: { corrects: true } });
    expect(withRel.corrects?.id).toBe(orig.id);
    // original is untouched and still present
    expect(await basePrisma.auditLog.findUnique({ where: { id: orig.id } })).not.toBeNull();
  });
});
