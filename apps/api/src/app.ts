import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { resolveTenant } from "./middleware/resolve-tenant.js";
import { loadContext } from "./middleware/load-context.js";
import { errorHandler } from "./shared/errors/handler.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { propertyRoutes } from "./modules/properties/properties.routes.js";

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

  app.use(errorHandler);
  return app;
}
