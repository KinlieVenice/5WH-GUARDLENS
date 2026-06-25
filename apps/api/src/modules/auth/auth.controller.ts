// HTTP layer for auth. These controllers stay thin: validate input, call auth.service for
// the real work, then translate the result into cookies + a JSON envelope. By the time any
// of these run, resolveTenant + loadContext have already put us inside the tenant's request
// context (so the scoped Prisma client is safe to use). The Zod schemas below are wired into
// the routes via validateBody, so req.body is already shape-checked when we get here.
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as authService from "./auth.service.js";
import { setAuthCookies, clearAuthCookies, REFRESH_COOKIE } from "../../shared/auth/cookies.js";
import { ok } from "../../shared/http/envelope.js";
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { audit } from "../audit/audit.js";

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
export const redeemSchema = z.object({ token: z.string().min(1), password: z.string().min(8) });
export const forgotSchema = z.object({ email: z.string().email() });

// POST /api/auth/login — verify credentials, then set the 3 auth cookies on success.
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tokens = await authService.login({
      tenantId: res.locals.tenant.id, email: req.body.email, password: req.body.password,
      userAgent: req.get("user-agent") ?? undefined, ip: req.ip,
    });
    setAuthCookies(res, tokens);
    ok(res, { ok: true });
  } catch (e) { next(e); }
}

// POST /api/auth/refresh — trade the refresh cookie for a fresh token pair. On any failure
// we clear the cookies so a bad/expired token can't linger in the browser.
export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) { clearAuthCookies(res); res.status(401).json({ error: { code: "UNAUTHORIZED", message: "No refresh token" } }); return; }
    const tokens = await authService.refresh({ rawToken: raw });
    setAuthCookies(res, tokens);
    ok(res, { ok: true });
  } catch (e) {
    clearAuthCookies(res);
    next(e);
  }
}

// POST /api/auth/logout — protected by authenticate + verifyCsrf. Ends the session and
// clears cookies. Impersonation tokens have no Session row, so we only audit + clear them.
export async function logout(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId, impersonatedBy } = res.locals.claims;
    if (impersonatedBy) {
      // Impersonation tokens are stateless (no Session row); just end them client-side.
      await audit.record({ action: "platform.impersonate.stop", entityType: "Tenant", entityId: res.locals.tenant.id });
      clearAuthCookies(res);
      ok(res, { ok: true });
      return;
    }
    await authService.revokeSession(sessionId as string);
    await audit.record({ action: "session.revoke", entityType: "Session", entityId: sessionId as string });
    clearAuthCookies(res);
    ok(res, { ok: true });
  } catch (e) { next(e); }
}

// GET /api/auth/me — who am I? Returns identity from the verified JWT claims. For normal
// sessions it also confirms the Session row still exists and isn't revoked (a cheap
// heartbeat so a logged-out/revoked session is rejected even while its 15-min JWT is valid).
export async function me(res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, role, tenantId, sessionId, impersonatedBy } = res.locals.claims;
    // Impersonation tokens are stateless (no Session row) and self-expire in <=15 min;
    // skip the session-revocation check for them. Normal sessions are heartbeat-checked.
    if (!impersonatedBy) {
      const session = await getScopedPrisma().session.findFirst({ where: { id: sessionId } });
      if (!session || session.revokedAt) { clearAuthCookies(res); res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Session ended" } }); return; }
    }
    ok(res, { userId, role, tenantId, impersonatedBy });
  } catch (e) { next(e); }
}

// POST /api/auth/forgot — start a password reset. Always returns {ok:true} regardless of
// whether the email exists, so it can't be used to probe which accounts are registered.
export async function forgot(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { await authService.startPasswordReset(req.body.email, res.locals.tenant.id); ok(res, { ok: true }); }
  catch (e) { next(e); }
}

// POST /api/auth/redeem — consume a one-time invite/reset token and set the new password.
export async function redeem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { await authService.redeemToken({ rawToken: req.body.token, password: req.body.password }); ok(res, { ok: true }); }
  catch (e) { next(e); }
}
