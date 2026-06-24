import type { Request, Response, NextFunction } from "express";
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { accessiblePropertyIds } from "../../shared/auth/property-scope.js";
import { ok } from "../../shared/http/envelope.js";

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ids = await accessiblePropertyIds();
    const where = ids === "ALL" ? {} : { id: { in: ids } };
    const props = await getScopedPrisma().property.findMany({ where, orderBy: { createdAt: "asc" } });
    ok(res, props);
  } catch (e) { next(e); }
}
