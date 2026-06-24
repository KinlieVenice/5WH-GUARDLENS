import { Router } from "express";
import { validateBody } from "../../shared/validation/validate.js";
import * as ctrl from "./auth.controller.js";

export const authRoutes = Router();
authRoutes.post("/login", validateBody(ctrl.loginSchema), ctrl.login);
