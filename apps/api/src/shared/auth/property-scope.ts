import { requireContext } from "../context/request-context.js";
import { getScopedPrisma } from "../prisma/index.js";

const TENANT_WIDE = new Set(["HOTEL_ADMIN", "SUPER_ADMIN"]);

export async function accessiblePropertyIds(): Promise<string[] | "ALL"> {
  const ctx = requireContext();
  if (ctx.role && TENANT_WIDE.has(ctx.role)) return "ALL";
  if (!ctx.userId) return [];
  const rows = await getScopedPrisma().userPropertyAccess.findMany({
    where: { userId: ctx.userId }, select: { propertyId: true },
  });
  return rows.map((r) => r.propertyId);
}
