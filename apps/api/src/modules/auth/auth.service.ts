import { getScopedPrisma } from "../../shared/prisma/index.js";
import { verifyPassword } from "../../shared/auth/password.js";
import { signAccessToken } from "../../shared/auth/jwt.js";
import { generateToken } from "../../shared/auth/tokens.js";
import { issueCsrf } from "../../shared/auth/csrf.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { recordFailure, failureCount, clearFailures } from "../../shared/rate-limit/limiter.js";
import type { Role } from "@prisma/client";

export type IssuedTokens = { accessToken: string; refreshToken: string; csrfToken: string };

// Creates a Session + first RefreshToken, returns cookie token bundle.
export async function issueSession(input: { userId: string; role: Role; tenantId: string; userAgent?: string; ip?: string }): Promise<IssuedTokens> {
  const db = getScopedPrisma();
  const session = await db.session.create({
    data: { tenantId: input.tenantId, userId: input.userId, userAgent: input.userAgent, ipAddress: input.ip,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000) },
  });
  const rt = generateToken();
  await db.refreshToken.create({
    data: { tenantId: input.tenantId, sessionId: session.id, tokenHash: rt.hash,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000) },
  });
  const accessToken = signAccessToken({ tenantId: input.tenantId, userId: input.userId, sessionId: session.id, role: input.role });
  return { accessToken, refreshToken: rt.raw, csrfToken: issueCsrf() };
}

export async function login(input: { tenantId: string; email: string; password: string; userAgent?: string; ip?: string }): Promise<IssuedTokens> {
  const lockKey = `${input.tenantId}:${input.email}`;
  if ((await failureCount(lockKey)) >= env.LOGIN_MAX_FAILURES) {
    throw new AppError("RATE_LIMITED", "Too many attempts. Try again later.", 429);
  }
  const db = getScopedPrisma();
  const user = await db.user.findFirst({ where: { email: input.email } });
  const genericFail = new AppError("UNAUTHORIZED", "Invalid credentials", 401);
  // Guards never get a session; inactive users can't log in. Same generic error.
  if (!user || user.role === "GUARD" || user.status !== "ACTIVE" || !user.passwordHash) {
    await recordFailure(lockKey); throw genericFail;
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    await recordFailure(lockKey); throw genericFail;
  }
  await clearFailures(lockKey);
  return issueSession({ userId: user.id, role: user.role, tenantId: input.tenantId, userAgent: input.userAgent, ip: input.ip });
}
