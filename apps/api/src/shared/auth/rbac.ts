import type { RequestHandler } from "express";
import type { Role } from "@prisma/client";
import { AppError } from "../errors/app-error.js";

export function requireRole(...roles: Role[]): RequestHandler {
  return (_req, res, next) => {
    const role = res.locals.claims?.role as Role | undefined;
    if (!role || !roles.includes(role)) return next(new AppError("FORBIDDEN", "Insufficient role", 403));
    next();
  };
}
