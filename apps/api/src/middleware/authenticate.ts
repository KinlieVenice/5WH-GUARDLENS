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
