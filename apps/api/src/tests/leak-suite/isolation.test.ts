// LEAK SUITE (the big one): every model is auto-stamped with tenantId on writes and filtered on reads, so tenant A can never see or touch tenant B rows by any operation.
// LEAK SUITE (the big one): every model is auto-stamped with tenantId on writes and filtered on reads, so tenant A can never see or touch tenant B rows by any operation.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { resetDb } from "../helpers/test-db.js";
import { asTenant } from "../helpers/context.js";
import { seedTwoTenants, type TenantFixture } from "../helpers/factories.js";

// NOTE: the scoped client reads context at EXECUTION time, so every scoped DB
// call must be awaited WITHIN the tenant scope. Use the asTenant helper
// (which awaits fn inside runWithContext) — never `runWithContext(ctx, () => prisma.x.op())`,
// whose returned lazy PrismaPromise would otherwise execute after the scope exits.
//
// Reseed before EVERY test: destructive ops (delete/cascade) must not leak
// state between cases. Factories use passwordHash:"x" (no argon) so this is cheap.
const READ_MODELS = ["user", "session", "refreshToken", "authToken", "userPropertyAccess", "property", "building", "floor", "zone"] as const;
let A: TenantFixture, B: TenantFixture;
beforeEach(async () => { await resetDb(); const r = await seedTwoTenants(); A = r.a; B = r.b; });
afterAll(async () => { await resetDb(); });

describe("read isolation — every model, A never sees B", () => {
  for (const m of READ_MODELS) {
    it(`findMany/${m} returns only A's rows`, async () => {
      const rows = await asTenant(A.tenantId, () => (getScopedPrisma() as any)[m].findMany());
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r: { tenantId: string }) => r.tenantId === A.tenantId)).toBe(true);
    });
    it(`count/${m} excludes B (all=2, scoped=1)`, async () => {
      const all = await (basePrisma as any)[m].count();
      const scoped = await asTenant(A.tenantId, () => (getScopedPrisma() as any)[m].count());
      expect(all).toBe(2);
      expect(scoped).toBe(1);
    });
  }
});

// Property is cascade-safe (no child rows that would break sibling assertions),
// so it carries the per-write-op isolation checks — one for every risky op.
describe("write/aggregate isolation on Property (covers every risky op)", () => {
  it("create stamps the context tenant and OVERRIDES a caller-supplied foreign tenantId", async () => {
    const created = await asTenant(A.tenantId, () =>
      getScopedPrisma().property.create({ data: { name: "X", tenantId: B.tenantId } }), // attacker passes B
    );
    expect(created.tenantId).toBe(A.tenantId); // extension forces A, not B
  });
  it("createMany maps tenantId onto every row", async () => {
    await asTenant(A.tenantId, () =>
      getScopedPrisma().property.createMany({ data: [{ name: "a", tenantId: A.tenantId }, { name: "b", tenantId: A.tenantId }] }),
    );
    const aCount = await asTenant(A.tenantId, () => getScopedPrisma().property.count());
    const bCount = await asTenant(B.tenantId, () => getScopedPrisma().property.count());
    expect(aCount).toBe(3); // 1 seeded + 2
    expect(bCount).toBe(1);
  });
  it("updateMany cannot touch B", async () => {
    const r = await asTenant(A.tenantId, () => getScopedPrisma().property.updateMany({ data: { name: "renamed" } }));
    expect(r.count).toBe(1);
    const bProp = await basePrisma.property.findFirstOrThrow({ where: { tenantId: B.tenantId } });
    expect(bProp.name).toBe("P");
  });
  it("update by id cannot cross tenants", async () => {
    const bProp = await basePrisma.property.findFirstOrThrow({ where: { tenantId: B.tenantId } });
    await expect(
      asTenant(A.tenantId, () => getScopedPrisma().property.update({ where: { id: bProp.id }, data: { name: "hax" } })),
    ).rejects.toThrow();
  });
  it("deleteMany cannot delete B", async () => {
    await asTenant(A.tenantId, () => getScopedPrisma().property.deleteMany());
    const bCount = await asTenant(B.tenantId, () => getScopedPrisma().property.count());
    expect(bCount).toBe(1);
  });
  it("upsert stamps the context tenant", async () => {
    const created = await asTenant(A.tenantId, () =>
      getScopedPrisma().property.upsert({ where: { id: "nonexistent" }, create: { name: "u", tenantId: A.tenantId }, update: { name: "u2" } }),
    );
    expect(created.tenantId).toBe(A.tenantId);
  });
  it("aggregate/groupBy stay within A", async () => {
    const grouped = await asTenant(A.tenantId, () =>
      getScopedPrisma().property.groupBy({ by: ["tenantId"], _count: true }),
    );
    expect(grouped.every((g) => g.tenantId === A.tenantId)).toBe(true);
  });
});
