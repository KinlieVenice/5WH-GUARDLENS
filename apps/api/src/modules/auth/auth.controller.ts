import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as authService from "./auth.service.js";
import { setAuthCookies, clearAuthCookies, REFRESH_COOKIE } from "../../shared/auth/cookies.js";
import { ok } from "../../shared/http/envelope.js";

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

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
