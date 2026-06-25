// HTTP layer for the property hierarchy. Thin: validate (via route-level validateBody) → call
// hierarchy.service → audit → envelope. By the time these run, resolveTenant+loadContext+authenticate
// have put us in the tenant context; write routes are additionally gated to admins by requireRole.
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as svc from "./hierarchy.service.js";
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { accessiblePropertyIds } from "../../shared/auth/property-scope.js";
import { ok } from "../../shared/http/envelope.js";
import { AppError } from "../../shared/errors/app-error.js";
import { audit } from "../audit/audit.js";

export const createPropertySchema = z.object({ name: z.string().min(1), address: z.string().optional(), timezone: z.string().optional() });
export const updatePropertySchema = z.object({ name: z.string().min(1).optional(), address: z.string().optional(), timezone: z.string().optional() });
export const createBuildingSchema = z.object({ name: z.string().min(1) });
export const updateBuildingSchema = z.object({ name: z.string().min(1).optional() });
export const createFloorSchema = z.object({ name: z.string().min(1), level: z.number().int().optional() });
export const updateFloorSchema = z.object({ name: z.string().min(1).optional(), level: z.number().int().optional() });
export const createZoneSchema = z.object({ name: z.string().min(1), floorId: z.string().optional() });
export const updateZoneSchema = z.object({ name: z.string().min(1).optional(), floorId: z.string().nullable().optional() });

// GET /api/properties — active properties this user may see.
export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ids = await accessiblePropertyIds();
    const where = ids === "ALL" ? { archivedAt: null } : { archivedAt: null, id: { in: ids } };
    const props = await getScopedPrisma().property.findMany({ where, orderBy: { createdAt: "asc" } });
    ok(res, props);
  } catch (e) { next(e); }
}

// GET /api/properties/:id/tree — cached tree; 404 if not in the caller's accessible set.
export async function getTree(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    const ids = await accessiblePropertyIds();
    if (ids !== "ALL" && !ids.includes(id)) throw new AppError("NOT_FOUND", "Not found", 404);
    ok(res, await svc.getPropertyTree(id));
  } catch (e) { next(e); }
}

export async function createProperty(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const r = await svc.createProperty(req.body);
    await audit.record({ action: "property.create", entityType: "Property", entityId: r.id });
    ok(res, r);
  } catch (e) { next(e); }
}
export async function updateProperty(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    await svc.updateProperty(id, req.body);
    await audit.record({ action: "property.update", entityType: "Property", entityId: id });
    ok(res, { ok: true });
  } catch (e) { next(e); }
}
export async function archiveProperty(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    await svc.archiveProperty(id);
    await audit.record({ action: "property.archive", entityType: "Property", entityId: id });
    ok(res, { ok: true });
  } catch (e) { next(e); }
}

export async function createBuilding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    const r = await svc.createBuilding(id, req.body);
    await audit.record({ action: "building.create", entityType: "Building", entityId: r.id });
    ok(res, r);
  } catch (e) { next(e); }
}
export async function updateBuilding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    await svc.updateBuilding(id, req.body);
    await audit.record({ action: "building.update", entityType: "Building", entityId: id });
    ok(res, { ok: true });
  } catch (e) { next(e); }
}
export async function archiveBuilding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    await svc.archiveBuilding(id);
    await audit.record({ action: "building.archive", entityType: "Building", entityId: id });
    ok(res, { ok: true });
  } catch (e) { next(e); }
}

export async function createFloor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    const r = await svc.createFloor(id, req.body);
    await audit.record({ action: "floor.create", entityType: "Floor", entityId: r.id });
    ok(res, r);
  } catch (e) { next(e); }
}
export async function updateFloor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    await svc.updateFloor(id, req.body);
    await audit.record({ action: "floor.update", entityType: "Floor", entityId: id });
    ok(res, { ok: true });
  } catch (e) { next(e); }
}
export async function archiveFloor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    await svc.archiveFloor(id);
    await audit.record({ action: "floor.archive", entityType: "Floor", entityId: id });
    ok(res, { ok: true });
  } catch (e) { next(e); }
}

export async function createZone(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    const r = await svc.createZone(id, req.body);
    await audit.record({ action: "zone.create", entityType: "Zone", entityId: r.id });
    ok(res, r);
  } catch (e) { next(e); }
}
export async function updateZone(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    await svc.updateZone(id, req.body);
    await audit.record({ action: "zone.update", entityType: "Zone", entityId: id });
    ok(res, { ok: true });
  } catch (e) { next(e); }
}
export async function archiveZone(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    await svc.archiveZone(id);
    await audit.record({ action: "zone.archive", entityType: "Zone", entityId: id });
    ok(res, { ok: true });
  } catch (e) { next(e); }
}
