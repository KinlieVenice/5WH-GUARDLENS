// Business logic for the physical hierarchy (Property → Building → Floor → Zone). Runs on the
// tenant-scoped Prisma client, so tenant isolation is automatic; this file owns the WITHIN-tenant
// rules: parent-must-be-active, zone↔floor↔property consistency (A9), active-sibling name
// uniqueness, and archive-cascade. Every write busts the affected property's cached tree.
//
// House style for this file: controllers stay thin and call these functions. Each exported
// function reads the tenant from the request context (requireContext), does its checks, writes
// via the scoped client, then invalidates the cache. "Archive" never deletes a row — it stamps
// `archivedAt`, and all reads/uniqueness checks ignore archived rows.
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { requireContext } from "../../shared/context/request-context.js";
import { AppError } from "../../shared/errors/app-error.js";
import { assembleTree, getCachedTree, setCachedTree, invalidatePropertyTree, type PropertyTree } from "./tree-cache.js";

// Two tiny error factories so every function returns the same shape/status for the same reason.
const notFound = () => new AppError("NOT_FOUND", "Not found", 404);
const conflict = (m: string) => new AppError("CONFLICT", m, 409);

// Load an ACTIVE property (scoped) or 404. Used where we operate ON a property (update/archive).
async function activeProperty(id: string) {
  const p = await getScopedPrisma().property.findFirst({ where: { id, archivedAt: null } });
  if (!p) throw notFound();
  return p;
}

// Reject a name already used by a non-archived sibling in the same scope. `exceptId` lets an
// update keep its own name (we exclude the row being edited from the duplicate search).
async function assertUniqueProperty(name: string, exceptId?: string): Promise<void> {
  const dup = await getScopedPrisma().property.findFirst({ where: { name, archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw conflict("Name already in use");
}

// Create a property. tenantId comes from context (never the caller), so it lands in this tenant.
export async function createProperty(input: { name: string; address?: string; timezone?: string }): Promise<{ id: string }> {
  const { tenantId } = requireContext();
  await assertUniqueProperty(input.name);
  const p = await getScopedPrisma().property.create({
    data: { tenantId, name: input.name, address: input.address ?? null, ...(input.timezone ? { timezone: input.timezone } : {}) },
  });
  return { id: p.id };
}

// Edit a property's fields (name/address/timezone). Re-checks name uniqueness (excluding itself)
// and busts the cached tree so the next read reflects the change.
export async function updateProperty(id: string, input: { name?: string; address?: string; timezone?: string }): Promise<void> {
  const { tenantId } = requireContext();
  await activeProperty(id);
  if (input.name !== undefined) await assertUniqueProperty(input.name, id);
  await getScopedPrisma().property.update({ where: { id }, data: input });
  await invalidatePropertyTree(tenantId, id);
}

// Archive the property AND its whole subtree in one transaction (rows retained, never deleted).
// Order is bottom-up (zones, floors, buildings, then the property) so nothing is briefly orphaned.
export async function archiveProperty(id: string): Promise<void> {
  const { tenantId } = requireContext();
  await activeProperty(id);
  const db = getScopedPrisma();
  const now = new Date();
  await db.$transaction([
    db.zone.updateMany({ where: { propertyId: id, archivedAt: null }, data: { archivedAt: now } }),
    db.floor.updateMany({ where: { archivedAt: null, building: { propertyId: id } }, data: { archivedAt: now } }),
    db.building.updateMany({ where: { propertyId: id, archivedAt: null }, data: { archivedAt: now } }),
    db.property.update({ where: { id }, data: { archivedAt: now } }),
  ]);
  await invalidatePropertyTree(tenantId, id);
}

// --- Building ---
// Load an ACTIVE building (scoped) or 404. Used where we operate ON a building (update/archive).
async function activeBuilding(id: string) {
  const b = await getScopedPrisma().building.findFirst({ where: { id, archivedAt: null } });
  if (!b) throw notFound();
  return b;
}
// Building name must be unique among active buildings of the SAME property.
async function assertUniqueBuilding(propertyId: string, name: string, exceptId?: string): Promise<void> {
  const dup = await getScopedPrisma().building.findFirst({ where: { propertyId, name, archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw conflict("Name already in use");
}

// Create a building under a property. Parent-check rule (shared by createFloor/createZone):
// missing/cross-tenant parent → 404, archived parent → 409 (you can't add to an archived parent).
export async function createBuilding(propertyId: string, input: { name: string }): Promise<{ id: string }> {
  const { tenantId } = requireContext();
  // 404 if property does not exist at all; 409 if it exists but is archived (parent-must-be-active rule)
  const p = await getScopedPrisma().property.findFirst({ where: { id: propertyId } });
  if (!p) throw notFound();
  if (p.archivedAt) throw conflict("Property is archived");
  await assertUniqueBuilding(propertyId, input.name);
  const b = await getScopedPrisma().building.create({ data: { tenantId, propertyId, name: input.name } });
  await invalidatePropertyTree(tenantId, propertyId);
  return { id: b.id };
}
// Rename a building (the only editable field). Busts the parent property's tree.
export async function updateBuilding(id: string, input: { name?: string }): Promise<void> {
  const { tenantId } = requireContext();
  const b = await activeBuilding(id);
  if (input.name !== undefined) await assertUniqueBuilding(b.propertyId, input.name, id);
  await getScopedPrisma().building.update({ where: { id }, data: input });
  await invalidatePropertyTree(tenantId, b.propertyId);
}
// Archive a building + its floors + the zones ON those floors (zones reached via floor:{buildingId}).
// Property-level zones (no floor) are intentionally left active — they don't belong to a building.
export async function archiveBuilding(id: string): Promise<void> {
  const { tenantId } = requireContext();
  const b = await activeBuilding(id);
  const db = getScopedPrisma();
  const now = new Date();
  await db.$transaction([
    db.zone.updateMany({ where: { archivedAt: null, floor: { buildingId: id } }, data: { archivedAt: now } }),
    db.floor.updateMany({ where: { buildingId: id, archivedAt: null }, data: { archivedAt: now } }),
    db.building.update({ where: { id }, data: { archivedAt: now } }),
  ]);
  await invalidatePropertyTree(tenantId, b.propertyId);
}

// --- Floor ---
// Load an ACTIVE floor or 404, WITH its building joined in (we need building.propertyId for the
// A9 check and for cache invalidation, since a floor doesn't carry propertyId directly).
async function activeFloor(id: string) {
  const f = await getScopedPrisma().floor.findFirst({ where: { id, archivedAt: null }, include: { building: true } });
  if (!f) throw notFound();
  return f;
}
// Floor name must be unique among active floors of the SAME building.
async function assertUniqueFloor(buildingId: string, name: string, exceptId?: string): Promise<void> {
  const dup = await getScopedPrisma().floor.findFirst({ where: { buildingId, name, archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw conflict("Name already in use");
}

// Create a floor under a building. Same parent-check rule (404 missing / 409 archived). `level` is
// numeric so floors sort (basement = -1, ground = 0, …) regardless of name.
export async function createFloor(buildingId: string, input: { name: string; level?: number }): Promise<{ id: string }> {
  const { tenantId } = requireContext();
  // 404 if building does not exist at all; 409 if it exists but is archived (parent-must-be-active rule)
  const b = await getScopedPrisma().building.findFirst({ where: { id: buildingId } });
  if (!b) throw notFound();
  if (b.archivedAt) throw conflict("Building is archived");
  await assertUniqueFloor(buildingId, input.name);
  const f = await getScopedPrisma().floor.create({ data: { tenantId, buildingId, name: input.name, level: input.level ?? 0 } });
  await invalidatePropertyTree(tenantId, b.propertyId);
  return { id: f.id };
}
// Edit a floor (name and/or level). Invalidates via the floor's building.propertyId.
export async function updateFloor(id: string, input: { name?: string; level?: number }): Promise<void> {
  const { tenantId } = requireContext();
  const f = await activeFloor(id);
  if (input.name !== undefined) await assertUniqueFloor(f.buildingId, input.name, id);
  await getScopedPrisma().floor.update({ where: { id }, data: input });
  await invalidatePropertyTree(tenantId, f.building.propertyId);
}
// Archive a floor + the zones on it, in one transaction. (Does not touch other floors/buildings.)
export async function archiveFloor(id: string): Promise<void> {
  const { tenantId } = requireContext();
  const f = await activeFloor(id);
  const db = getScopedPrisma();
  const now = new Date();
  await db.$transaction([
    db.zone.updateMany({ where: { floorId: id, archivedAt: null }, data: { archivedAt: now } }),
    db.floor.update({ where: { id }, data: { archivedAt: now } }),
  ]);
  await invalidatePropertyTree(tenantId, f.building.propertyId);
}

// --- Zone ---
// Load an ACTIVE zone or 404. Zones carry propertyId directly, so no join is needed here.
async function activeZone(id: string) {
  const z = await getScopedPrisma().zone.findFirst({ where: { id, archivedAt: null } });
  if (!z) throw notFound();
  return z;
}
// Zone name must be unique among active zones of the SAME property.
async function assertUniqueZone(propertyId: string, name: string, exceptId?: string): Promise<void> {
  const dup = await getScopedPrisma().zone.findFirst({ where: { propertyId, name, archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw conflict("Name already in use");
}
// A9 (the cross-entity consistency rule): if a zone names a floor, that floor's building must
// belong to the zone's property — otherwise a "Lobby" zone could point at a floor in another
// hotel. Missing/archived floor → 404 (via activeFloor); wrong property → 400. Incident/shift
// records will later attach to zones, so this rule keeps that future data coherent.
async function assertFloorInProperty(floorId: string, propertyId: string): Promise<void> {
  const f = await activeFloor(floorId);
  if (f.building.propertyId !== propertyId) throw new AppError("BAD_REQUEST", "Floor belongs to a different property", 400);
}

// Create a zone under a property. Optional `floorId` makes it a floor-level zone (else it's
// property-wide). Runs the parent check (404/409) and the A9 floor check when a floor is given.
export async function createZone(propertyId: string, input: { name: string; floorId?: string }): Promise<{ id: string }> {
  const { tenantId } = requireContext();
  // 404 if property does not exist at all; 409 if it exists but is archived (parent-must-be-active rule)
  const p = await getScopedPrisma().property.findFirst({ where: { id: propertyId } });
  if (!p) throw notFound();
  if (p.archivedAt) throw conflict("Property is archived");
  await assertUniqueZone(propertyId, input.name);
  if (input.floorId) await assertFloorInProperty(input.floorId, propertyId);
  const z = await getScopedPrisma().zone.create({ data: { tenantId, propertyId, name: input.name, floorId: input.floorId ?? null } });
  await invalidatePropertyTree(tenantId, propertyId);
  return { id: z.id };
}
// Edit a zone: rename and/or re-parent. Setting floorId re-runs A9 (re-parent must stay in the
// same property); the truthy `if (input.floorId)` is deliberate — floorId:null clears the floor
// (zone becomes property-level) and correctly skips the A9 check.
export async function updateZone(id: string, input: { name?: string; floorId?: string | null }): Promise<void> {
  const { tenantId } = requireContext();
  const z = await activeZone(id);
  if (input.name !== undefined) await assertUniqueZone(z.propertyId, input.name, id);
  if (input.floorId) await assertFloorInProperty(input.floorId, z.propertyId);
  await getScopedPrisma().zone.update({ where: { id }, data: input });
  await invalidatePropertyTree(tenantId, z.propertyId);
}
// Archive a single zone (no children to cascade).
export async function archiveZone(id: string): Promise<void> {
  const { tenantId } = requireContext();
  const z = await activeZone(id);
  await getScopedPrisma().zone.update({ where: { id }, data: { archivedAt: new Date() } });
  await invalidatePropertyTree(tenantId, z.propertyId);
}

// Cache-aware read: serve the assembled tree from Redis if present, else build it from the DB,
// cache it, and return it. 404 if the property is missing/archived. This is the read path the
// GET /:id/tree endpoint uses.
export async function getPropertyTree(propertyId: string): Promise<PropertyTree> {
  const { tenantId } = requireContext();
  const cached = await getCachedTree(tenantId, propertyId);
  if (cached) return cached;
  const tree = await assembleTree(propertyId);
  if (!tree) throw notFound();
  await setCachedTree(tenantId, propertyId, tree);
  return tree;
}
