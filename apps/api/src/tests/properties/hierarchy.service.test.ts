// Proves the service invariants: create/read tree, active-sibling name uniqueness (409) with reuse after archive, parent-must-be-active (404 missing / 409 archived) for building/floor/zone, archive cascade (building archive leaves property-level zones), and the A9 zone↔floor↔property rule (400) on create and re-parent.
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
  it("rejects a floor under an archived building (409)", async () => {
    const { id: pid } = await asContext(adminCtx(), () => svc.createProperty({ name: "HQ" }));
    const { id: bid } = await asContext(adminCtx(), () => svc.createBuilding(pid, { name: "Tower" }));
    await asContext(adminCtx(), () => svc.archiveBuilding(bid));
    await expect(asContext(adminCtx(), () => svc.createFloor(bid, { name: "G" }))).rejects.toMatchObject({ status: 409 });
  });
  it("archiving a building archives its floors but leaves property-level zones", async () => {
    const { id: pid } = await asContext(adminCtx(), () => svc.createProperty({ name: "HQ" }));
    const { id: bid } = await asContext(adminCtx(), () => svc.createBuilding(pid, { name: "Tower" }));
    await asContext(adminCtx(), () => svc.createFloor(bid, { name: "G", level: 0 }));
    await asContext(adminCtx(), () => svc.createZone(pid, { name: "Perimeter" })); // property-level
    await asContext(adminCtx(), () => svc.archiveBuilding(bid));
    const tree = await asContext(adminCtx(), () => svc.getPropertyTree(pid));
    expect(tree.buildings).toEqual([]);
    expect(tree.zones.map((z) => z.name)).toEqual(["Perimeter"]);
  });
});

describe("zone mutations + A9 consistency", () => {
  it("creates a floor-level zone and a property-level zone", async () => {
    const { id: pid } = await asContext(adminCtx(), () => svc.createProperty({ name: "HQ" }));
    const { id: bid } = await asContext(adminCtx(), () => svc.createBuilding(pid, { name: "Tower" }));
    const { id: fid } = await asContext(adminCtx(), () => svc.createFloor(bid, { name: "G", level: 0 }));
    await asContext(adminCtx(), () => svc.createZone(pid, { name: "Lobby", floorId: fid }));
    await asContext(adminCtx(), () => svc.createZone(pid, { name: "Perimeter" }));
    const tree = await asContext(adminCtx(), () => svc.getPropertyTree(pid));
    expect(tree.buildings[0]!.floors[0]!.zones.map((z) => z.name)).toEqual(["Lobby"]);
    expect(tree.zones.map((z) => z.name)).toEqual(["Perimeter"]);
  });
  it("rejects a zone whose floorId belongs to a different property (A9, 400)", async () => {
    const { id: p1 } = await asContext(adminCtx(), () => svc.createProperty({ name: "P1" }));
    const { id: p2 } = await asContext(adminCtx(), () => svc.createProperty({ name: "P2" }));
    const { id: b2 } = await asContext(adminCtx(), () => svc.createBuilding(p2, { name: "B2" }));
    const { id: f2 } = await asContext(adminCtx(), () => svc.createFloor(b2, { name: "G", level: 0 }));
    await expect(asContext(adminCtx(), () => svc.createZone(p1, { name: "Bad", floorId: f2 })))
      .rejects.toMatchObject({ status: 400 });
  });
  it("rejects a zone under an archived property (409)", async () => {
    const { id: pid } = await asContext(adminCtx(), () => svc.createProperty({ name: "HQ" }));
    await asContext(adminCtx(), () => svc.archiveProperty(pid));
    await expect(asContext(adminCtx(), () => svc.createZone(pid, { name: "Z" }))).rejects.toMatchObject({ status: 409 });
  });
  it("updateZone rejects re-parenting to a floor in another property (A9, 400)", async () => {
    const { id: p1 } = await asContext(adminCtx(), () => svc.createProperty({ name: "P1" }));
    const { id: p2 } = await asContext(adminCtx(), () => svc.createProperty({ name: "P2" }));
    const { id: b2 } = await asContext(adminCtx(), () => svc.createBuilding(p2, { name: "B2" }));
    const { id: f2 } = await asContext(adminCtx(), () => svc.createFloor(b2, { name: "G", level: 0 }));
    const { id: zid } = await asContext(adminCtx(), () => svc.createZone(p1, { name: "Z" }));
    await expect(asContext(adminCtx(), () => svc.updateZone(zid, { floorId: f2 }))).rejects.toMatchObject({ status: 400 });
  });
});
