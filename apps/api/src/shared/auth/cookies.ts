// Defines the three auth cookies and how they're set/cleared. We use cookies (not
// Authorization headers) so the access/refresh tokens can be httpOnly — invisible to
// JavaScript, which blunts XSS token theft. The CSRF cookie is the deliberate exception.
import type { Response } from "express";
import { isTest } from "../../config/env.js";

export const ACCESS_COOKIE = "hs_at"; // short-lived JWT, sent on every API call
export const REFRESH_COOKIE = "hs_rt"; // long-lived rotating token
export const CSRF_COOKIE = "hs_csrf"; // readable by JS for the double-submit check
// Refresh cookie is scoped to just the refresh endpoint, so it isn't sent (or leaked)
// on every other request.
const REFRESH_PATH = "/api/auth/refresh";

// httpOnly = JS can't read it; secure = HTTPS-only (off in tests); sameSite=strict = not
// sent on cross-site requests (CSRF defense-in-depth).
const base = { httpOnly: true, secure: !isTest, sameSite: "strict" as const };

// Set all three cookies after a successful login/refresh/impersonate.
export function setAuthCookies(res: Response, t: { accessToken: string; refreshToken: string; csrfToken: string }): void {
  res.cookie(ACCESS_COOKIE, t.accessToken, { ...base });
  res.cookie(REFRESH_COOKIE, t.refreshToken, { ...base, path: REFRESH_PATH });
  // CSRF cookie is intentionally NOT httpOnly: the browser JS reads it and echoes it
  // back in the x-csrf-token header so verifyCsrf can compare the two (double-submit).
  res.cookie(CSRF_COOKIE, t.csrfToken, { httpOnly: false, secure: !isTest, sameSite: "strict" });
}
// Delete all three on logout (path must match how the refresh cookie was set).
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE);
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  res.clearCookie(CSRF_COOKIE);
}
