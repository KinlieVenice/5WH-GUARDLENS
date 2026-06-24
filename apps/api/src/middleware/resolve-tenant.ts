import type { RequestHandler } from "express";
import { runSystem } from "../shared/prisma/system-client.js";
import { env } from "../config/env.js";
import { AppError } from "../shared/errors/app-error.js";

export function tenantSlugFromHost(host: string, baseDomain: string): string | null {
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  if (h === baseDomain) return null;
  const suffix = `.${baseDomain}`;
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  return label.includes(".") || label.length === 0 ? null : label;
}

export const resolveTenant: RequestHandler = async (req, res, next) => {
  try {
    const slug = tenantSlugFromHost(req.headers.host ?? "", env.APP_BASE_DOMAIN);
    if (!slug) return next(new AppError("NOT_FOUND", "Unknown tenant host", 404));
    const tenant = await runSystem("resolveTenantBySubdomain", (db) =>
      db.tenant.findUnique({ where: { slug }, select: { id: true, status: true } }),
    );
    if (!tenant) return next(new AppError("NOT_FOUND", "Unknown tenant", 404));
    if (tenant.status !== "ACTIVE") return next(new AppError("FORBIDDEN", "Tenant is not active", 403));
    res.locals.tenant = { id: tenant.id };
    next();
  } catch (e) { next(e); }
};
