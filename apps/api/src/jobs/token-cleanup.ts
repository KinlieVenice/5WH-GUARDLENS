import { basePrisma } from "../shared/prisma/base-client.js";

// Cross-tenant maintenance: prune expired auth artifacts so hot-path tables
// don't bloat. Deletes strictly by time; touches no business data.
export async function cleanupExpiredTokens(): Promise<{ refresh: number; auth: number }> {
  const now = new Date();
  const refresh = await basePrisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } });
  const auth = await basePrisma.authToken.deleteMany({ where: { expiresAt: { lt: now } } });
  return { refresh: refresh.count, auth: auth.count };
}
