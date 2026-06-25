// The access token = a short-lived, signed JWT that proves "this request is user X, of
// tenant T, with role R". It's self-contained (no DB lookup needed to trust it), which is
// why it's deliberately short-lived (15 min) and refreshed via the rotating refresh token.
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../../config/env.js";

// Everything baked into a token. `impersonatedBy` is present only for support sessions.
export type AccessClaims = {
  tenantId: string; userId: string; sessionId: string; role: Role; impersonatedBy?: string;
};
// Sign claims into a token that auto-expires after ACCESS_TOKEN_TTL_SECONDS.
export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL_SECONDS });
}
// Verify signature + expiry, then return the typed claims. We explicitly reject tokens
// missing required claims so a malformed/forged token can't slip through as "undefined"
// values (a real bug this guard was added to fix).
export function verifyAccessToken(token: string): AccessClaims {
  const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  if (!decoded.tenantId || !decoded.userId || !decoded.sessionId || !decoded.role) {
    throw new Error("token missing required claims");
  }
  return {
    tenantId: String(decoded.tenantId), userId: String(decoded.userId),
    sessionId: String(decoded.sessionId), role: decoded.role as Role,
    impersonatedBy: decoded.impersonatedBy ? String(decoded.impersonatedBy) : undefined,
  };
}
