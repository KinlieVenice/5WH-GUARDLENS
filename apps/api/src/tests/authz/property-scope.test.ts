import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runWithContext } from "../../shared/context/request-context.js";
import { accessiblePropertyIds } from "../../shared/auth/property-scope.js";
import { resetDb } from "../helpers/test-db.js";
import { basePrisma } from "../../shared/prisma/base-client.js";

let tenantId = "", p1 = "", p2 = "", supeId = "";
beforeAll(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "T", slug: "t" } });
  tenantId = t.id;
  const pa = await basePrisma.property.create({ data: { tenantId, name: "P1" } });
  const pb = await basePrisma.property.create({ data: { tenantId, name: "P2" } });
  p1 = pa.id; p2 = pb.id;
  const supe = await basePrisma.user.create({ data: { tenantId, email: "s@t", name: "S", role: "SUPERVISOR", status: "ACTIVE", passwordHash: "x" } });
  supeId = supe.id;
  await basePrisma.userPropertyAccess.create({ data: { tenantId, userId: supeId, propertyId: p1 } });
});
afterAll(async () => { await resetDb(); });

describe("property scope (B8)", () => {
  it("admin is tenant-wide (ALL)", async () => {
    const r = await runWithContext({ tenantId, userId: "x", role: "HOTEL_ADMIN" }, () => accessiblePropertyIds());
    expect(r).toBe("ALL");
  });
  it("supervisor sees only assigned properties", async () => {
    const r = await runWithContext({ tenantId, userId: supeId, role: "SUPERVISOR" }, () => accessiblePropertyIds());
    expect(r).toEqual([p1]);
  });
  it("supervisor with no access rows sees nothing", async () => {
    const r = await runWithContext({ tenantId, userId: "nobody", role: "SUPERVISOR" }, () => accessiblePropertyIds());
    expect(r).toEqual([]);
  });
});
