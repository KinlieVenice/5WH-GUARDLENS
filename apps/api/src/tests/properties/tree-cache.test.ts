// Proves: assembleTree nests active buildings→floors→zones (property-level zones separate), excludes archived nodes, returns null for an archived/absent property; and the Redis cache round-trips + invalidation deletes the key.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { resetDb } from "../helpers/test-db.js";
import { asTenant } from "../helpers/context.js";
import { redis } from "../../shared/redis/client.js";
import { assembleTree, getCachedTree, setCachedTree, invalidatePropertyTree, treeKey } from "../../modules/properties/tree-cache.js";

let tenantId = "", propertyId = "", floorId = "";
beforeEach(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "T", slug: "t" } });
  tenantId = t.id;
  const p = await basePrisma.property.create({ data: { tenantId, name: "Acme HQ", address: "1 St", timezone: "Asia/Manila" } });
  propertyId = p.id;
  const b = await basePrisma.building.create({ data: { tenantId, propertyId, name: "Tower" } });
  const f = await basePrisma.floor.create({ data: { tenantId, buildingId: b.id, name: "G", level: 0 } });
  floorId = f.id;
  await basePrisma.zone.create({ data: { tenantId, propertyId, floorId, name: "Lobby" } });
  await basePrisma.zone.create({ data: { tenantId, propertyId, name: "Perimeter" } });        // property-level
  await basePrisma.zone.create({ data: { tenantId, propertyId, name: "Old", archivedAt: new Date() } }); // archived
  await redis.del(treeKey(tenantId, propertyId));
});
afterAll(async () => { await resetDb(); });

describe("assembleTree", () => {
  it("nests active buildings→floors→zones and lists property-level zones, excludes archived", async () => {
    const tree = await asTenant(tenantId, () => assembleTree(propertyId));
    expect(tree).not.toBeNull();
    expect(tree!.name).toBe("Acme HQ");
    expect(tree!.buildings).toHaveLength(1);
    expect(tree!.buildings[0]!.floors[0]!.zones.map((z) => z.name)).toEqual(["Lobby"]);
    expect(tree!.zones.map((z) => z.name)).toEqual(["Perimeter"]);   // property-level only
  });
  it("returns null for an archived/absent property", async () => {
    await basePrisma.property.update({ where: { id: propertyId }, data: { archivedAt: new Date() } });
    const tree = await asTenant(tenantId, () => assembleTree(propertyId));
    expect(tree).toBeNull();
  });
});

describe("cache get/set/invalidate", () => {
  it("round-trips and invalidation deletes the key", async () => {
    const tree = await asTenant(tenantId, () => assembleTree(propertyId));
    await setCachedTree(tenantId, propertyId, tree!);
    expect(await getCachedTree(tenantId, propertyId)).toEqual(tree);
    await invalidatePropertyTree(tenantId, propertyId);
    expect(await getCachedTree(tenantId, propertyId)).toBeNull();
  });
});
