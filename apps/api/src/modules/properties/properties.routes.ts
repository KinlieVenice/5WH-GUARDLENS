// Route table for /api/properties. Every route requires a logged-in user (authenticate).
import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import * as ctrl from "./properties.controller.js";

export const propertyRoutes = Router();
propertyRoutes.get("/", authenticate, ctrl.list);
