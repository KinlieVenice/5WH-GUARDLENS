// The impersonation seam. Platform admins live in config (above any tenant) and can step
// into a tenant to support it. The key design choice: the issued token is STATELESS — it's a
// normal SUPER_ADMIN JWT stamped with `impersonatedBy`, but it creates NO Session/RefreshToken
// rows. That means it can't be refreshed, self-expires in <=15 min, and every use is audited.
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { findPlatformAdmin } from "../../config/platform-admins.js";
import { verifyPassword } from "../../shared/auth/password.js";
import { signAccessToken } from "../../shared/auth/jwt.js";
import { issueCsrf } from "../../shared/auth/csrf.js";
import { setAuthCookies } from "../../shared/auth/cookies.js";
import { generateToken } from "../../shared/auth/tokens.js";
import { ok } from "../../shared/http/envelope.js";
import { AppError } from "../../shared/errors/app-error.js";
import { audit } from "../audit/audit.js";

export const impersonateSchema = z.object({ platformId: z.string().min(1), password: z.string().min(1) });

// Mints a SUPER_ADMIN-level access token for the tenant on this host, stamped
// with impersonatedBy. Tenant is already resolved by resolveTenant (res.locals.tenant).
export async function impersonate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const admin = findPlatformAdmin(req.body.platformId);
    const fail = new AppError("UNAUTHORIZED", "Invalid platform credentials", 401);
    if (!admin || !(await verifyPassword(admin.passwordHash, req.body.password))) throw fail;

    const tenantId = res.locals.tenant.id;
    const accessToken = signAccessToken({
      tenantId, userId: `platform:${admin.id}`, sessionId: `impersonation:${generateToken().hash.slice(0, 12)}`,
      role: "SUPER_ADMIN", impersonatedBy: admin.id,
    });
    setAuthCookies(res, { accessToken, refreshToken: generateToken().raw, csrfToken: issueCsrf() });
    await audit.record({ action: "platform.impersonate.start", entityType: "Tenant", entityId: tenantId, metadata: { platformId: admin.id } });
    ok(res, { ok: true });
  } catch (e) { next(e); }
}
