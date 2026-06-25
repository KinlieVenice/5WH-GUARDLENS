import { describe, it, expect, afterAll } from "vitest";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { resetDb } from "../helpers/test-db.js";

afterAll(async () => { await resetDb(); });

describe("hierarchy schema", () => {
  it("can create property → building → floor → zone with archivedAt", async () => {
    await resetDb();
    const t = await basePrisma.tenant.create({ data: { name: "T", slug: "t" } });
    const p = await basePrisma.property.create({ data: { tenantId: t.id, name: "P" } });
    const b = await basePrisma.building.create({ data: { tenantId: t.id, propertyId: p.id, name: "B" } });
    const f = await basePrisma.floor.create({ data: { tenantId: t.id, buildingId: b.id, name: "F", level: 0 } });
    const z = await basePrisma.zone.create({ data: { tenantId: t.id, propertyId: p.id, floorId: f.id, name: "Z" } });
    expect(z.floorId).toBe(f.id);
    expect(p.archivedAt).toBeNull();
  });
});
