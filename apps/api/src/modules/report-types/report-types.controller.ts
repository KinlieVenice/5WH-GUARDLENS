// HTTP layer for the report catalog. Thin: route-level validateBody parses the body,
// then we call the service, audit the write, and envelope the result. Reads are auth-only;
// writes are admin-gated in the routes.
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as svc from "./report-types.service.js";
import { formSchema } from "../../shared/report-schema.js";
import { ok } from "../../shared/http/envelope.js";
import { audit } from "../audit/audit.js";

const lane = z.enum(["SECURITY", "SAFETY"]);

export const createTypeSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  lane,
  fields: formSchema,
});
export const addVersionSchema = z.object({ fields: formSchema });
export const updateTypeSchema = z.object({
  name: z.string().min(1).optional(),
  lane: lane.optional(),
  isActive: z.boolean().optional(),
});

// GET /api/report-types — list (optional ?lane= & ?activeOnly=true)
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const laneQ = req.query["lane"];
    const parsedLane = laneQ === "SECURITY" || laneQ === "SAFETY" ? laneQ : undefined;
    const activeOnly = req.query["activeOnly"] === "true";
    ok(res, await svc.listTypes({ lane: parsedLane, activeOnly }));
  } catch (e) { next(e); }
}

// GET /api/report-types/:id — type with its versions (ascending)
export async function detail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    ok(res, await svc.getType(req.params["id"] as string));
  } catch (e) { next(e); }
}

// POST /api/report-types — create a type + v1
export async function createType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { key, name, lane: l, fields } = req.body;
    const r = await svc.createType({ key, name, lane: l }, fields);
    await audit.record({ action: "report_type.create", entityType: "ReportType", entityId: r.type.id });
    ok(res, r);
  } catch (e) { next(e); }
}

// POST /api/report-types/:id/versions — append a new immutable version
export async function addVersion(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    const r = await svc.addVersion(id, req.body.fields);
    await audit.record({ action: "report_type.version.create", entityType: "ReportType", entityId: id, metadata: { version: r.version } });
    ok(res, r);
  } catch (e) { next(e); }
}

// PATCH /api/report-types/:id — patch metadata (name/lane/isActive) in place
export async function updateType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params["id"] as string;
    const r = await svc.updateTypeMeta(id, req.body);
    await audit.record({ action: "report_type.update", entityType: "ReportType", entityId: id });
    ok(res, r);
  } catch (e) { next(e); }
}
