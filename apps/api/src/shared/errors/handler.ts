// The single, central error funnel. Registered LAST in app.ts, so any error thrown or
// `next(err)`-ed by a route lands here and becomes a consistent JSON shape.
import type { ErrorRequestHandler } from "express";
import { AppError } from "./app-error.js";

// Map any thrown value to { status, body }. Known AppErrors pass through their code/message;
// anything else (an unexpected bug) is flattened to a generic 500 so we never leak internals
// (stack traces, SQL, etc.) to the client.
export function toEnvelope(err: unknown): { status: number; body: { error: { code: string; message: string } } } {
  if (err instanceof AppError) return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  return { status: 500, body: { error: { code: "INTERNAL", message: "Internal error" } } };
}

// Express error middleware (note the 4 args). Logs real server errors (5xx) to the console
// but keeps the client response generic.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, body } = toEnvelope(err);
  if (status >= 500) console.error(err);
  res.status(status).json(body);
};
