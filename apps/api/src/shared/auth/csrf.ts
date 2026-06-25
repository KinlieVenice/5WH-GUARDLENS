// CSRF protection via the "double-submit cookie" pattern. On login we hand the client a
// random CSRF token in a JS-readable cookie; for state-changing requests the client must
// copy it into the x-csrf-token header. An attacker's cross-site form can ride the user's
// cookies but CANNOT read the cookie value to forge the matching header → request rejected.
import type { RequestHandler } from "express";
import { randomBytes } from "node:crypto";
import { CSRF_COOKIE } from "./cookies.js";
import { AppError } from "../errors/app-error.js";

// Generate a fresh random CSRF token (issued at login alongside the auth cookies).
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
