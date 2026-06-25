// FIRST middleware in the chain. Turns the request's hostname (e.g. "acme.lvh.me")
// into a concrete tenant id and stashes it on res.locals for everyone downstream.
// This is the one place that legitimately reads the DB without a tenant context yet,
// so it goes through the allowlisted runSystem() gate.
import type { RequestHandler } from "express";
import { runSystem } from "../shared/prisma/system-client.js";
import { env } from "../config/env.js";
import { AppError } from "../shared/errors/app-error.js";

// Pull the subdomain "label" out of a host. "acme.lvh.me" + base "lvh.me" → "acme".
// Returns null (→ 404) for the bare base domain, foreign domains, or multi-level
// labels like "a.b.lvh.me". Strips any ":port" first. Pure function → unit-tested.
export function tenantSlugFromHost(host: string, baseDomain: string): string | null {
  const h = host.split(":")[0]?.toLowerCase() ?? "";
  if (h === baseDomain) return null;
  const suffix = `.${baseDomain}`;
  if (!h.endsWith(suffix)) return null;
  const label = h.slice(0, -suffix.length);
  return label.includes(".") || label.length === 0 ? null : label;
}

// Resolve host → tenant, then gate on existence + status. 404 for unknown host/tenant,
// 403 for a suspended/canceled tenant. On success, every later handler can trust
// res.locals.tenant.id.
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
