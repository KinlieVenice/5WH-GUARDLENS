import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { basePrisma } from "../../shared/prisma/base-client.js";
import { resetDb } from "../helpers/test-db.js";
import { asContext } from "../helpers/context.js";
import * as svc from "../../modules/properties/hierarchy.service.js";

let tenantId = "";
const adminCtx = () => ({ tenantId, userId: "admin", role: "HOTEL_ADMIN" as const });
beforeEach(async () => {
  await resetDb();
  const t = await basePrisma.tenant.create({ data: { name: "T", slug: "t" } });
  tenantId = t.id;
});
afterAll(async () => { await resetDb(); });

describe("property mutations", () => {
  it("creates a property and reads it back as a tree", async () => {
    const { id } = await asContext(adminCtx(), () => svc.createProperty({ name: "HQ" }));
    const tree = await asContext(adminCtx(), () => svc.getPropertyTree(id));
    expect(tree.name).toBe("HQ");
    expect(tree.buildings).toEqual([]);
  });
  it("rejects a duplicate active property name (409)", async () => {
    await asContext(adminCtx(), () => svc.createProperty({ name: "HQ" }));
    await expect(asContext(adminCtx(), () => svc.createProperty({ name: "HQ" }))).rejects.toMatchObject({ status: 409 });
  });
  it("getPropertyTree on an archived property throws 404", async () => {
    const { id } = await asContext(adminCtx(), () => svc.createProperty({ name: "HQ" }));
    await asContext(adminCtx(), () => svc.archiveProperty(id));
    await expect(asContext(adminCtx(), () => svc.getPropertyTree(id))).rejects.toMatchObject({ status: 404 });
  });
  it("archived name can be reused", async () => {
    const { id } = await asContext(adminCtx(), () => svc.createProperty({ name: "HQ" }));
    await asContext(adminCtx(), () => svc.archiveProperty(id));
    const again = await asContext(adminCtx(), () => svc.createProperty({ name: "HQ" }));
    expect(again.id).not.toBe(id);
  });
});
