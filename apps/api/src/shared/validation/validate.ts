import type { RequestHandler } from "express";
import { z, ZodTypeAny } from "zod";
import { AppError } from "../errors/app-error.js";

export function validateBody(schema: ZodTypeAny): RequestHandler {
  const strict = schema instanceof z.ZodObject ? schema.strict() : schema;
  return (req, _res, next) => {
    const r = strict.safeParse(req.body);
    if (!r.success) return next(new AppError("BAD_REQUEST", r.error.issues[0]?.message ?? "Invalid body", 400));
    req.body = r.data;
    next();
  };
}
