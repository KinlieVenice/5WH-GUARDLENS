import { getScopedPrisma } from "../../shared/prisma/index.js";
import { verifyPassword } from "../../shared/auth/password.js";
import { signAccessToken } from "../../shared/auth/jwt.js";
import { generateToken, hashToken } from "../../shared/auth/tokens.js";
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

async function rotateFrom(tokenId: string, sessionId: string, tenantId: string, role: Role, userId: string): Promise<IssuedTokens> {
  const db = getScopedPrisma();
  const next = generateToken();
  await db.$transaction(async (tx) => {
    const created = await (tx as typeof db).refreshToken.create({
      data: { tenantId, sessionId, tokenHash: next.hash, expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000) },
    });
    await (tx as typeof db).refreshToken.update({ where: { id: tokenId }, data: { usedAt: new Date(), replacedById: created.id } });
    await (tx as typeof db).session.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } });
  });
  const accessToken = signAccessToken({ tenantId, userId, sessionId, role });
  return { accessToken, refreshToken: next.raw, csrfToken: issueCsrf() };
}

async function revokeFamily(sessionId: string): Promise<void> {
  const db = getScopedPrisma();
  await db.$transaction([
    db.refreshToken.updateMany({ where: { sessionId, revokedAt: null }, data: { revokedAt: new Date() } }),
    db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } }),
  ]);
}

export async function refresh(input: { rawToken: string }): Promise<IssuedTokens> {
  const db = getScopedPrisma();
  const token = await db.refreshToken.findFirst({
    where: { tokenHash: hashToken(input.rawToken) },
    include: { session: { include: { user: true } } },
  });
  const unauthorized = new AppError("UNAUTHORIZED", "Invalid refresh token", 401);
  if (!token) throw unauthorized;
  if (token.revokedAt || token.expiresAt < new Date()) throw unauthorized;
  const role = token.session.user.role;
  const userId = token.session.userId;

  if (!token.usedAt) {
    return rotateFrom(token.id, token.sessionId, token.tenantId, role, userId);
  }
  // Already used — benign retry within grace, else theft.
  const ageSeconds = (Date.now() - token.usedAt.getTime()) / 1000;
  const successor = token.replacedById ? await db.refreshToken.findFirst({ where: { id: token.replacedById } }) : null;
  const benign = ageSeconds <= env.REFRESH_GRACE_SECONDS && successor && !successor.usedAt && !successor.revokedAt;
  if (benign && successor) {
    return rotateFrom(successor.id, token.sessionId, token.tenantId, role, userId);
  }
  await revokeFamily(token.sessionId);
  throw unauthorized;
}
