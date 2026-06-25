// The brain of authentication. Controllers stay thin and call into here for the actual
// session/token logic: logging in, issuing sessions, rotating refresh tokens (with theft
// detection), revoking sessions, and the invite/password-reset token lifecycle. Everything
// here uses the SCOPED prisma client, so it's automatically locked to the current tenant.
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { verifyPassword, hashPassword } from "../../shared/auth/password.js";
import { signAccessToken } from "../../shared/auth/jwt.js";
import { generateToken, hashToken } from "../../shared/auth/tokens.js";
import { issueCsrf } from "../../shared/auth/csrf.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { recordFailure, failureCount, clearFailures } from "../../shared/rate-limit/limiter.js";
import type { Role, AuthTokenPurpose } from "@prisma/client";

// The bundle of secrets handed to the browser as cookies after auth succeeds.
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

// Email+password login. Order matters: check the lockout first, then look up the user,
// then verify the password. Note the deliberately UNIFORM "Invalid credentials" error for
// every failure reason (no such user / guard / inactive / wrong password) so an attacker
// can't tell which emails exist. Every failure bumps the lockout counter.
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

// Refresh-token ROTATION. Every time a refresh token is used, we mint a brand-new one and
// retire the old one (single-use tokens). In one transaction: create the successor, mark
// the old token used + point it at its successor (`replacedById`), and bump the session's
// lastSeenAt. The replacedById chain is what lets `refresh` later tell a benign retry from
// theft. Returns a fresh access token + the new refresh token.
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

// Kill an entire session "family": revoke every refresh token in the session AND the
// session row itself. Used both for normal logout and as the panic button when token
// theft is detected (below). Atomic so a half-revoked state can't linger.
async function revokeFamily(sessionId: string): Promise<void> {
  const db = getScopedPrisma();
  await db.$transaction([
    db.refreshToken.updateMany({ where: { sessionId, revokedAt: null }, data: { revokedAt: new Date() } }),
    db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } }),
  ]);
}

// Exchange a refresh token for a new token pair. This is the security-critical bit:
//  1. Token unknown / revoked / expired → 401.
//  2. Token NEVER used yet → normal rotation (the happy path).
//  3. Token already used → either a benign double-submit (the client retried within a
//     short grace window and a valid successor exists) which we forgive by rotating from
//     the successor, OR a replay/theft, which trips revokeFamily() and forces re-login.
// This catches the classic stolen-refresh-token attack: the moment a used token is
// replayed after the grace window, the whole session is burned.
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

// Public wrapper used by logout to end one session.
export async function revokeSession(sessionId: string): Promise<void> {
  await revokeFamily(sessionId);
}

// Create a one-time AuthToken (INVITE or PASSWORD_RESET) and return the RAW token to send
// to the user. Only the hash is stored — the raw value lives only in the email link.
export async function issueAuthToken(userId: string, tenantId: string, purpose: AuthTokenPurpose, ttlSeconds: number): Promise<string> {
  const db = getScopedPrisma();
  const { raw, hash } = generateToken();
  await db.authToken.create({ data: { tenantId, userId, purpose, tokenHash: hash, expiresAt: new Date(Date.now() + ttlSeconds * 1000) } });
  return raw; // caller emails this; we only store the hash
}

export async function redeemToken(input: { rawToken: string; password: string }): Promise<void> {
  const db = getScopedPrisma();
  const invalid = new AppError("BAD_REQUEST", "Invalid or expired token", 400);
  // Hash the password BEFORE opening the transaction so argon2 (~100ms) doesn't hold the row lock.
  const passwordHash = await hashPassword(input.password);
  await db.$transaction(async (tx) => {
    const txdb = tx as typeof db;
    const token = await txdb.authToken.findFirst({ where: { tokenHash: hashToken(input.rawToken) } });
    if (!token || token.expiresAt < new Date()) throw invalid;
    // Atomically CLAIM the token: the conditional updateMany is the single-use guard.
    // Concurrent redeemers race here — only one update matches usedAt:null (count===1); the rest get 0.
    const claimed = await txdb.authToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw invalid;
    await txdb.user.update({ where: { id: token.userId }, data: { passwordHash, status: "ACTIVE" } });
  });
}

export async function startPasswordReset(email: string, tenantId: string): Promise<void> {
  const db = getScopedPrisma();
  const user = await db.user.findFirst({ where: { email } });
  if (!user || user.role === "GUARD") return; // silently no-op; never reveal existence
  const raw = await issueAuthToken(user.id, tenantId, "PASSWORD_RESET", 3600);
  console.info("[email] password reset link token (dev):", raw); // real email adapter is Stage 2
}
