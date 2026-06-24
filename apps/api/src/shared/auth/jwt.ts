import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../../config/env.js";

export type AccessClaims = {
  tenantId: string; userId: string; sessionId: string; role: Role; impersonatedBy?: string;
};
export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL_SECONDS });
}
export function verifyAccessToken(token: string): AccessClaims {
  const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  return {
    tenantId: String(decoded.tenantId), userId: String(decoded.userId),
    sessionId: String(decoded.sessionId), role: decoded.role as Role,
    impersonatedBy: decoded.impersonatedBy ? String(decoded.impersonatedBy) : undefined,
  };
}
