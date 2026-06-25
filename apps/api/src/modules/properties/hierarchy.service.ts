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
  if (input.name) await assertUniqueProperty(input.name, id);
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
