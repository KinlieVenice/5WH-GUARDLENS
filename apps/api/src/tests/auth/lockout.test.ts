import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { client, HOST } from "../helpers/http.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { hashPassword } from "../../shared/auth/password.js";
import { redis } from "../../shared/redis/client.js";

beforeAll(async () => {
  await resetDb(); await redis.flushdb();
  const t = await basePrisma.tenant.create({ data: { name: "Acme", slug: "acme" } });
  await basePrisma.user.create({ data: { tenantId: t.id, email: "a@acme.test", name: "A", role: "HOTEL_ADMIN", status: "ACTIVE", passwordHash: await hashPassword("password123") } });
});
afterAll(async () => { await resetDb(); await redis.quit(); });

describe("login lockout", () => {
  it("locks the account after LOGIN_MAX_FAILURES bad attempts", async () => {
    for (let i = 0; i < 5; i++) {
      await client().post("/api/auth/login").set("Host", HOST).send({ email: "a@acme.test", password: "wrong" });
    }
    const res = await client().post("/api/auth/login").set("Host", HOST).send({ email: "a@acme.test", password: "password123" });
    expect(res.status).toBe(429);
  });
});
