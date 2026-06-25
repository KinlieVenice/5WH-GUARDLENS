// Business logic for the physical hierarchy (Property → Building → Floor → Zone). Runs on the
// tenant-scoped Prisma client, so tenant isolation is automatic; this file owns the WITHIN-tenant
// rules: parent-must-be-active, zone↔floor↔property consistency (A9), active-sibling name
// uniqueness, and archive-cascade. Every write busts the affected property's cached tree.
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { requireContext } from "../../shared/context/request-context.js";
import { AppError } from "../../shared/errors/app-error.js";
import { assembleTree, getCachedTree, setCachedTree, invalidatePropertyTree, type PropertyTree } from "./tree-cache.js";

const notFound = () => new AppError("NOT_FOUND", "Not found", 404);
const conflict = (m: string) => new AppError("CONFLICT", m, 409);

// Load an ACTIVE property (scoped) or 404. Used as the parent check for buildings/zones.
async function activeProperty(id: string) {
  const p = await getScopedPrisma().property.findFirst({ where: { id, archivedAt: null } });
  if (!p) throw notFound();
  return p;
}

// Reject a name already used by a non-archived sibling in the same scope.
async function assertUniqueProperty(name: string, exceptId?: string): Promise<void> {
  const dup = await getScopedPrisma().property.findFirst({ where: { name, archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw conflict("Name already in use");
}

export async function createProperty(input: { name: string; address?: string; timezone?: string }): Promise<{ id: string }> {
  const { tenantId } = requireContext();
  await assertUniqueProperty(input.name);
  const p = await getScopedPrisma().property.create({
    data: { tenantId, name: input.name, address: input.address ?? null, ...(input.timezone ? { timezone: input.timezone } : {}) },
  });
  return { id: p.id };
}

export async function updateProperty(id: string, input: { name?: string; address?: string; timezone?: string }): Promise<void> {
  const { tenantId } = requireContext();
  await activeProperty(id);
  if (input.name !== undefined) await assertUniqueProperty(input.name, id);
  await getScopedPrisma().property.update({ where: { id }, data: input });
  await invalidatePropertyTree(tenantId, id);
}

// Archive the property AND its whole subtree in one transaction (rows retained).
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
async function activeBuilding(id: string) {
  const b = await getScopedPrisma().building.findFirst({ where: { id, archivedAt: null } });
  if (!b) throw notFound();
  return b;
}
async function assertUniqueBuilding(propertyId: string, name: string, exceptId?: string): Promise<void> {
  const dup = await getScopedPrisma().building.findFirst({ where: { propertyId, name, archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw conflict("Name already in use");
}

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
export async function updateBuilding(id: string, input: { name?: string }): Promise<void> {
  const { tenantId } = requireContext();
  const b = await activeBuilding(id);
  if (input.name !== undefined) await assertUniqueBuilding(b.propertyId, input.name, id);
  await getScopedPrisma().building.update({ where: { id }, data: input });
  await invalidatePropertyTree(tenantId, b.propertyId);
}
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
async function activeFloor(id: string) {
  const f = await getScopedPrisma().floor.findFirst({ where: { id, archivedAt: null }, include: { building: true } });
  if (!f) throw notFound();
  return f;
}
async function assertUniqueFloor(buildingId: string, name: string, exceptId?: string): Promise<void> {
  const dup = await getScopedPrisma().floor.findFirst({ where: { buildingId, name, archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw conflict("Name already in use");
}

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
export async function updateFloor(id: string, input: { name?: string; level?: number }): Promise<void> {
  const { tenantId } = requireContext();
  const f = await activeFloor(id);
  if (input.name !== undefined) await assertUniqueFloor(f.buildingId, input.name, id);
  await getScopedPrisma().floor.update({ where: { id }, data: input });
  await invalidatePropertyTree(tenantId, f.building.propertyId);
}
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
async function activeZone(id: string) {
  const z = await getScopedPrisma().zone.findFirst({ where: { id, archivedAt: null } });
  if (!z) throw notFound();
  return z;
}
async function assertUniqueZone(propertyId: string, name: string, exceptId?: string): Promise<void> {
  const dup = await getScopedPrisma().zone.findFirst({ where: { propertyId, name, archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw conflict("Name already in use");
}
// A9: if a zone names a floor, that floor's building must belong to the zone's property.
async function assertFloorInProperty(floorId: string, propertyId: string): Promise<void> {
  const f = await activeFloor(floorId);
  if (f.building.propertyId !== propertyId) throw new AppError("BAD_REQUEST", "Floor belongs to a different property", 400);
}

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
export async function updateZone(id: string, input: { name?: string; floorId?: string | null }): Promise<void> {
  const { tenantId } = requireContext();
  const z = await activeZone(id);
  if (input.name !== undefined) await assertUniqueZone(z.propertyId, input.name, id);
  if (input.floorId) await assertFloorInProperty(input.floorId, z.propertyId);
  await getScopedPrisma().zone.update({ where: { id }, data: input });
  await invalidatePropertyTree(tenantId, z.propertyId);
}
export async function archiveZone(id: string): Promise<void> {
  const { tenantId } = requireContext();
  const z = await activeZone(id);
  await getScopedPrisma().zone.update({ where: { id }, data: { archivedAt: new Date() } });
  await invalidatePropertyTree(tenantId, z.propertyId);
}

// Cache-aware read: serve from Redis, else assemble + cache. 404 if missing/archived.
export async function getPropertyTree(propertyId: string): Promise<PropertyTree> {
  const { tenantId } = requireContext();
  const cached = await getCachedTree(tenantId, propertyId);
  if (cached) return cached;
  const tree = await assembleTree(propertyId);
  if (!tree) throw notFound();
  await setCachedTree(tenantId, propertyId, tree);
  return tree;
}
