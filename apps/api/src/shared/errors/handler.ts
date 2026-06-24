import type { ErrorRequestHandler } from "express";
import { AppError } from "./app-error.js";

export function toEnvelope(err: unknown): { status: number; body: { error: { code: string; message: string } } } {
  if (err instanceof AppError) return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  return { status: 500, body: { error: { code: "INTERNAL", message: "Internal error" } } };
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, body } = toEnvelope(err);
  if (status >= 500) console.error(err);
  res.status(status).json(body);
};
