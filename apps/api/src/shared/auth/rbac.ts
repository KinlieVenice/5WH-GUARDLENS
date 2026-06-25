// Role-based access control. `requireRole(...)` builds a middleware you drop onto a route
// to restrict it to specific roles. Runs after `authenticate` (which populates the claims).
import type { RequestHandler } from "express";
import type { Role } from "@prisma/client";
import { AppError } from "../errors/app-error.js";

// Usage: app.post("/admin-thing", authenticate, requireRole("HOTEL_ADMIN"), handler).
// 403s if the verified token's role isn't in the allowed set.
export function requireRole(...roles: Role[]): RequestHandler {
  return (_req, res, next) => {
    const role = res.locals.claims?.role as Role | undefined;
    if (!role || !roles.includes(role)) return next(new AppError("FORBIDDEN", "Insufficient role", 403));
    next();
  };
}
