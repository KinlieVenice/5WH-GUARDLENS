// Request-body validation middleware. Give it a Zod schema; it parses req.body, rejects
// bad input with a 400 (never letting unvalidated data reach a handler), and replaces
// req.body with the typed, parsed result.
import type { RequestHandler } from "express";
import { z } from "zod";
import type { ZodTypeAny } from "zod";
import { AppError } from "../errors/app-error.js";

// `.strict()` on object schemas means unknown/extra fields are rejected, not silently
// dropped — so clients can't smuggle in fields the handler didn't expect.
export function validateBody(schema: ZodTypeAny): RequestHandler {
  const strict = schema instanceof z.ZodObject ? schema.strict() : schema;
  return (req, _res, next) => {
    const r = strict.safeParse(req.body);
    if (!r.success) return next(new AppError("BAD_REQUEST", r.error.issues[0]?.message ?? "Invalid body", 400));
    req.body = r.data;
    next();
  };
}
