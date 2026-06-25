// Route table for /api/platform — the operator (platform-staff) surface. Right now its only
// job is the impersonation endpoint, which lets a platform admin act inside a tenant.
import { Router } from "express";
import { validateBody } from "../../shared/validation/validate.js";
import * as ctrl from "./platform.controller.js";

export const platformRoutes = Router();
platformRoutes.post("/impersonate", validateBody(ctrl.impersonateSchema), ctrl.impersonate);
