// Route table for /api/report-types. Reads need a logged-in user; writes are admin-only
// (HOTEL_ADMIN/SUPER_ADMIN). No DELETE — types are retired via PATCH { isActive: false }.
import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole } from "../../shared/auth/rbac.js";
import { validateBody } from "../../shared/validation/validate.js";
import * as ctrl from "./report-types.controller.js";

const admin = [authenticate, requireRole("HOTEL_ADMIN", "SUPER_ADMIN")];

export const reportTypeRoutes = Router();
reportTypeRoutes.get("/", authenticate, ctrl.list);
reportTypeRoutes.get("/:id", authenticate, ctrl.detail);
reportTypeRoutes.post("/", ...admin, validateBody(ctrl.createTypeSchema), ctrl.createType);
reportTypeRoutes.post("/:id/versions", ...admin, validateBody(ctrl.addVersionSchema), ctrl.addVersion);
reportTypeRoutes.patch("/:id", ...admin, validateBody(ctrl.updateTypeSchema), ctrl.updateType);
