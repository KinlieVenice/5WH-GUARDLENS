// Builds the Express app and wires the global middleware ORDER, which is load-bearing:
//   helmet/json/cookies  → parse the request safely
//   resolveTenant        → figure out which tenant this host belongs to (sets res.locals.tenant)
//   loadContext          → enter the AsyncLocalStorage request context for that tenant
//   <route handlers>     → run inside the context, so getScopedPrisma() is tenant-locked
//   errorHandler         → last, converts thrown AppErrors into clean JSON envelopes
// createApp() returns the app without listening, so tests can drive it via supertest.
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { resolveTenant } from "./middleware/resolve-tenant.js";
import { loadContext } from "./middleware/load-context.js";
import { errorHandler } from "./shared/errors/handler.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { propertyRoutes } from "./modules/properties/properties.routes.js";
import { buildingRoutes, floorRoutes, zoneRoutes } from "./modules/properties/hierarchy.routes.js";
import { platformRoutes } from "./modules/platform/platform.routes.js";
import { reportTypeRoutes } from "./modules/report-types/report-types.routes.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(express.json());
  app.use(cookieParser());
  app.set("trust proxy", true);

  // All /api routes resolve tenant from host, then run inside request context.
  app.use("/api", resolveTenant, loadContext);
  app.use("/api/auth", authRoutes);
  app.use("/api/properties", propertyRoutes);
  app.use("/api/report-types", reportTypeRoutes);
  app.use("/api/buildings", buildingRoutes);
  app.use("/api/floors", floorRoutes);
  app.use("/api/zones", zoneRoutes);
  app.use("/api/platform", platformRoutes);

  app.use(errorHandler);
  return app;
}
