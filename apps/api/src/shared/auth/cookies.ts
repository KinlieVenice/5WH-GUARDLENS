import type { Response } from "express";
import { isTest } from "../../config/env.js";

export const ACCESS_COOKIE = "hs_at";
export const REFRESH_COOKIE = "hs_rt";
export const CSRF_COOKIE = "hs_csrf";
const REFRESH_PATH = "/api/auth/refresh";

const base = { httpOnly: true, secure: !isTest, sameSite: "strict" as const };

export function setAuthCookies(res: Response, t: { accessToken: string; refreshToken: string; csrfToken: string }): void {
  res.cookie(ACCESS_COOKIE, t.accessToken, { ...base });
  res.cookie(REFRESH_COOKIE, t.refreshToken, { ...base, path: REFRESH_PATH });
  res.cookie(CSRF_COOKIE, t.csrfToken, { httpOnly: false, secure: !isTest, sameSite: "strict" });
}
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE);
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  res.clearCookie(CSRF_COOKIE);
}
