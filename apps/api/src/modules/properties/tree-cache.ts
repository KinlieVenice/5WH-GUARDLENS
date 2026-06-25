// The cached property tree. A property's physical layout (buildings→floors→zones) barely
// changes, so we assemble it once and remember it in Redis, busting the single key on any
// write within that property. Only ACTIVE (archivedAt === null) nodes are ever included.
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { redis } from "../../shared/redis/client.js";

export type ZoneNode = { id: string; name: string; floorId: string | null };
export type FloorNode = { id: string; name: string; level: number; zones: ZoneNode[] };
export type BuildingNode = { id: string; name: string; floors: FloorNode[] };
export type PropertyTree = {
  id: string; name: string; address: string | null; timezone: string;
  buildings: BuildingNode[];
  zones: ZoneNode[]; // property-level zones (floorId === null)
};

const TTL_SECONDS = 3600; // backstop only; correctness comes from explicit invalidation

export function treeKey(tenantId: string, propertyId: string): string {
  return `tenant:${tenantId}:proptree:${propertyId}`;
}

// Read the active subtree straight from the (tenant-scoped) DB. Returns null if the property
// is missing or archived. One query per level, stitched in memory — no N+1.
export async function assembleTree(propertyId: string): Promise<PropertyTree | null> {
  const db = getScopedPrisma();
  const property = await db.property.findFirst({ where: { id: propertyId, archivedAt: null } });
  if (!property) return null;

  const [buildings, floors, zones] = await Promise.all([
    db.building.findMany({ where: { propertyId, archivedAt: null }, orderBy: { name: "asc" } }),
    db.floor.findMany({ where: { archivedAt: null, building: { propertyId } }, orderBy: { level: "asc" } }),
    db.zone.findMany({ where: { propertyId, archivedAt: null }, orderBy: { name: "asc" } }),
  ]);

  const zonesByFloor = new Map<string, ZoneNode[]>();
  const propertyZones: ZoneNode[] = [];
  for (const z of zones) {
    const node: ZoneNode = { id: z.id, name: z.name, floorId: z.floorId };
    if (z.floorId) (zonesByFloor.get(z.floorId) ?? zonesByFloor.set(z.floorId, []).get(z.floorId)!).push(node);
    else propertyZones.push(node);
  }
  const floorsByBuilding = new Map<string, FloorNode[]>();
  for (const f of floors) {
    const node: FloorNode = { id: f.id, name: f.name, level: f.level, zones: zonesByFloor.get(f.id) ?? [] };
    (floorsByBuilding.get(f.buildingId) ?? floorsByBuilding.set(f.buildingId, []).get(f.buildingId)!).push(node);
  }
  return {
    id: property.id, name: property.name, address: property.address, timezone: property.timezone,
    buildings: buildings.map((b) => ({ id: b.id, name: b.name, floors: floorsByBuilding.get(b.id) ?? [] })),
    zones: propertyZones,
  };
}

export async function getCachedTree(tenantId: string, propertyId: string): Promise<PropertyTree | null> {
  const raw = await redis.get(treeKey(tenantId, propertyId));
  return raw ? (JSON.parse(raw) as PropertyTree) : null;
}

export async function setCachedTree(tenantId: string, propertyId: string, tree: PropertyTree): Promise<void> {
  await redis.set(treeKey(tenantId, propertyId), JSON.stringify(tree), "EX", TTL_SECONDS);
}

export async function invalidatePropertyTree(tenantId: string, propertyId: string): Promise<void> {
  await redis.del(treeKey(tenantId, propertyId));
}
