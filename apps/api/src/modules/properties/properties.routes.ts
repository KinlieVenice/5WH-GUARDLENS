// Route table for /api/properties. Reads need a logged-in user; writes are admin-only
// (HOTEL_ADMIN/SUPER_ADMIN). Nested creates (buildings, zones) live under their parent property.
import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole } from "../../shared/auth/rbac.js";
import { validateBody } from "../../shared/validation/validate.js";
import * as ctrl from "./properties.controller.js";

const admin = [authenticate, requireRole("HOTEL_ADMIN", "SUPER_ADMIN")];

export const propertyRoutes = Router();
propertyRoutes.get("/", authenticate, ctrl.list);
propertyRoutes.get("/:id/tree", authenticate, ctrl.getTree);
propertyRoutes.post("/", ...admin, validateBody(ctrl.createPropertySchema), ctrl.createProperty);
propertyRoutes.patch("/:id", ...admin, validateBody(ctrl.updatePropertySchema), ctrl.updateProperty);
propertyRoutes.patch("/:id/archive", ...admin, ctrl.archiveProperty);
propertyRoutes.post("/:id/buildings", ...admin, validateBody(ctrl.createBuildingSchema), ctrl.createBuilding);
propertyRoutes.post("/:id/zones", ...admin, validateBody(ctrl.createZoneSchema), ctrl.createZone);
