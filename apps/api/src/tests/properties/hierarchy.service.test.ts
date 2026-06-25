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

describe("building + floor mutations", () => {
  it("creates building→floor and they appear in the tree", async () => {
    const { id: pid } = await asContext(adminCtx(), () => svc.createProperty({ name: "HQ" }));
    const { id: bid } = await asContext(adminCtx(), () => svc.createBuilding(pid, { name: "Tower" }));
    await asContext(adminCtx(), () => svc.createFloor(bid, { name: "G", level: 0 }));
    const tree = await asContext(adminCtx(), () => svc.getPropertyTree(pid));
    expect(tree.buildings[0]!.name).toBe("Tower");
    expect(tree.buildings[0]!.floors[0]!.name).toBe("G");
  });
  it("rejects a building under an archived property (409)", async () => {
    const { id: pid } = await asContext(adminCtx(), () => svc.createProperty({ name: "HQ" }));
    await asContext(adminCtx(), () => svc.archiveProperty(pid));
    await expect(asContext(adminCtx(), () => svc.createBuilding(pid, { name: "X" }))).rejects.toMatchObject({ status: 409 });
  });
});
