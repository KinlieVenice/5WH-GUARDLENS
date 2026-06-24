import { Router } from "express";
import { validateBody } from "../../shared/validation/validate.js";
import * as ctrl from "./platform.controller.js";

export const platformRoutes = Router();
platformRoutes.post("/impersonate", validateBody(ctrl.impersonateSchema), ctrl.impersonate);
