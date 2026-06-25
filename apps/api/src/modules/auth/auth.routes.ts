// Route table for /api/auth. Public routes (login/refresh/forgot/redeem) need no logged-in
// user; logout and me sit behind `authenticate`. logout additionally requires `verifyCsrf`
// because it's a state-changing POST driven by a cookie (double-submit CSRF protection).
import { Router } from "express";
import { validateBody } from "../../shared/validation/validate.js";
import * as ctrl from "./auth.controller.js";
import { authenticate } from "../../middleware/authenticate.js";
import { verifyCsrf } from "../../shared/auth/csrf.js";

export const authRoutes = Router();
authRoutes.post("/login", validateBody(ctrl.loginSchema), ctrl.login);
authRoutes.post("/refresh", ctrl.refresh);
authRoutes.post("/forgot", validateBody(ctrl.forgotSchema), ctrl.forgot);
authRoutes.post("/redeem", validateBody(ctrl.redeemSchema), ctrl.redeem);
authRoutes.post("/logout", authenticate, verifyCsrf, ctrl.logout);
authRoutes.get("/me", authenticate, (req, res, next) => ctrl.me(res, next));
