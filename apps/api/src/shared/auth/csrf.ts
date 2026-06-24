import type { RequestHandler } from "express";
import { randomBytes } from "node:crypto";
import { CSRF_COOKIE } from "./cookies.js";
import { AppError } from "../errors/app-error.js";

export function issueCsrf(): string {
  return randomBytes(24).toString("hex");
}
// Double-submit check for state-changing authenticated routes.
export const verifyCsrf: RequestHandler = (req, _res, next) => {
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get("x-csrf-token");
  if (!cookie || !header || cookie !== header) {
    return next(new AppError("FORBIDDEN", "CSRF check failed", 403));
  }
  next();
};
