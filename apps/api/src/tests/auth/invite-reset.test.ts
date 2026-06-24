import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { generateToken, hashToken } from "../../shared/auth/tokens.js";

let tenantId = "";
beforeEach(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  tenantId = t.id;
});
afterAll(async () => { await resetDb(); });

async function makeInvite(email: string) {
  const u = await basePrisma.user.create({ data: { tenantId, email, name: "New", role: "SUPERVISOR", status: "INVITED" } });
  const { raw, hash } = generateToken();
  await basePrisma.authToken.create({ data: { tenantId, userId: u.id, purpose: "INVITE", tokenHash: hash, expiresAt: new Date(Date.now() + 6e8) } });
  return { userId: u.id, raw };
}

describe("invite + reset redemption", () => {
  it("redeeming an INVITE token sets a password and activates the user", async () => {
    const { userId, raw } = await makeInvite("new@acme.test");
    const res = await client().post("/api/auth/redeem").set("Host", HOST).send({ token: raw, password: "brandnewpass" });
    expect(res.status).toBe(200);
    const u = await basePrisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.status).toBe("ACTIVE");
    expect(u.passwordHash).not.toBeNull();
  });
  it("a token is single-use", async () => {
    const { raw } = await makeInvite("two@acme.test");
    await client().post("/api/auth/redeem").set("Host", HOST).send({ token: raw, password: "brandnewpass" });
    const res2 = await client().post("/api/auth/redeem").set("Host", HOST).send({ token: raw, password: "another1234" });
    expect(res2.status).toBe(400);
  });
  it("forgot-password always returns 200, even for an unknown email", async () => {
    const res = await client().post("/api/auth/forgot").set("Host", HOST).send({ email: "ghost@acme.test" });
    expect(res.status).toBe(200);
  });
});
