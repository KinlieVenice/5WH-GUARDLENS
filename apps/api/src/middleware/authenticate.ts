// Per-route guard for endpoints that need a logged-in user. It reads the access-token
// cookie, verifies the JWT, makes sure the token belongs to THIS tenant (so a token
// from acme can't be replayed against globex), then enriches the live request context
// with userId/role/sessionId/impersonatedBy. Any failure → 401.
import type { RequestHandler } from "express";
import { verifyAccessToken } from "../shared/auth/jwt.js";
import { ACCESS_COOKIE } from "../shared/auth/cookies.js";
import { AppError } from "../shared/errors/app-error.js";
import { getContext } from "../shared/context/request-context.js";

// Use on routes that require a logged-in user. Pre-auth routes (login/refresh/
// forgot/redeem) do NOT use this.
export const authenticate: RequestHandler = (req, res, next) => {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) return next(new AppError("UNAUTHORIZED", "Not authenticated", 401));
  try {
    const claims = verifyAccessToken(token);
    if (claims.tenantId !== res.locals.tenant.id) {
      return next(new AppError("UNAUTHORIZED", "Token/tenant mismatch", 401));
    }
    res.locals.claims = claims;
    // Enrich the SAME context object loadContext opened, so scoped queries and audit
    // logs made later in this request know who the user is (not just which tenant).
    const ctx = getContext();
    if (ctx) {
      ctx.userId = claims.userId;
      ctx.sessionId = claims.sessionId;
      ctx.role = claims.role;
      ctx.impersonatedBy = claims.impersonatedBy;
    }
    next();
  } catch {
    next(new AppError("UNAUTHORIZED", "Invalid or expired token", 401));
  }
};
