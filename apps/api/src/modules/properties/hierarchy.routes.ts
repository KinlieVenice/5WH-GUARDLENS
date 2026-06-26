// Route tables for /api/buildings, /api/floors, /api/zones — the edit/archive + nested-create
// surface for the lower hierarchy levels. All writes are admin-only.
import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole } from "../../shared/auth/rbac.js";
import { validateBody } from "../../shared/validation/validate.js";
import * as ctrl from "./properties.controller.js";

// Reused guard: must be logged in (authenticate) AND a tenant admin (requireRole). Spread onto
// every write route below so a supervisor/guard token gets a 403 before the handler runs.
const admin = [authenticate, requireRole("HOTEL_ADMIN", "SUPER_ADMIN")];

export const buildingRoutes = Router();
buildingRoutes.patch("/:id", ...admin, validateBody(ctrl.updateBuildingSchema), ctrl.updateBuilding);
buildingRoutes.patch("/:id/archive", ...admin, ctrl.archiveBuilding);
buildingRoutes.post("/:id/floors", ...admin, validateBody(ctrl.createFloorSchema), ctrl.createFloor);

export const floorRoutes = Router();
floorRoutes.patch("/:id", ...admin, validateBody(ctrl.updateFloorSchema), ctrl.updateFloor);
floorRoutes.patch("/:id/archive", ...admin, ctrl.archiveFloor);

export const zoneRoutes = Router();
zoneRoutes.patch("/:id", ...admin, validateBody(ctrl.updateZoneSchema), ctrl.updateZone);
zoneRoutes.patch("/:id/archive", ...admin, ctrl.archiveZone);
