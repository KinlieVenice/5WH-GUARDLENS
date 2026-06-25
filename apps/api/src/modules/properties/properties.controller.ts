// Properties (a tenant's hotels/sites). Demonstrates RBAC property-scoping layered on top of
// tenant isolation: the scoped Prisma client already limits rows to this tenant, and
// accessiblePropertyIds() narrows further to what THIS user may see ("ALL" for admins,
// an explicit id list for supervisors, none for guards).
import type { Request, Response, NextFunction } from "express";
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { accessiblePropertyIds } from "../../shared/auth/property-scope.js";
import { ok } from "../../shared/http/envelope.js";

// GET /api/properties — list the properties this user is allowed to see.
export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ids = await accessiblePropertyIds();
    const where = ids === "ALL" ? {} : { id: { in: ids } };
    const props = await getScopedPrisma().property.findMany({ where, orderBy: { createdAt: "asc" } });
    ok(res, props);
  } catch (e) { next(e); }
}
