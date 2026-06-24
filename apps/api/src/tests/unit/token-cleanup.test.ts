import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { resetDb } from "../helpers/test-db.js";
import { cleanupExpiredTokens } from "../../jobs/token-cleanup.js";

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await resetDb(); });

describe("cleanupExpiredTokens", () => {
  it("deletes expired refresh and auth tokens, keeps live ones", async () => {
    const t = await basePrisma.tenant.create({ data: { name: "T", slug: "t" } });
    const u = await basePrisma.user.create({ data: { tenantId: t.id, email: "u@t", name: "U", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: "x" } });
    const s = await basePrisma.session.create({ data: { tenantId: t.id, userId: u.id, expiresAt: new Date(Date.now() + 1e6) } });
    await basePrisma.refreshToken.create({ data: { tenantId: t.id, sessionId: s.id, tokenHash: "live", expiresAt: new Date(Date.now() + 1e6) } });
    await basePrisma.refreshToken.create({ data: { tenantId: t.id, sessionId: s.id, tokenHash: "dead", expiresAt: new Date(Date.now() - 1e6) } });
    await basePrisma.authToken.create({ data: { tenantId: t.id, userId: u.id, purpose: "INVITE", tokenHash: "deadat", expiresAt: new Date(Date.now() - 1e6) } });
    const r = await cleanupExpiredTokens();
    expect(r).toEqual({ refresh: 1, auth: 1 });
    expect(await basePrisma.refreshToken.count()).toBe(1);
    expect(await basePrisma.authToken.count()).toBe(0);
  });
});
