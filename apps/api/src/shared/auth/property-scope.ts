// The second authorization layer (after tenant isolation): WITHIN a tenant, which hotel
// properties can this user touch? Admins see everything; lower roles see only the
// properties they've been explicitly granted.
import { requireContext } from "../context/request-context.js";
import { getScopedPrisma } from "../prisma/index.js";

// Roles that implicitly see every property in their tenant.
const TENANT_WIDE = new Set(["HOTEL_ADMIN", "SUPER_ADMIN"]);

// Returns "ALL" for admins (no property filter), or the explicit list of allowed
// propertyIds for everyone else. No grants → empty list → they see nothing (fail-closed).
// Controllers turn this into a `where` filter.
export async function accessiblePropertyIds(): Promise<string[] | "ALL"> {
  const ctx = requireContext();
  if (ctx.role && TENANT_WIDE.has(ctx.role)) return "ALL";
  if (!ctx.userId) return [];
  const rows = await getScopedPrisma().userPropertyAccess.findMany({
    where: { userId: ctx.userId }, select: { propertyId: true },
  });
  return rows.map((r) => r.propertyId);
}
