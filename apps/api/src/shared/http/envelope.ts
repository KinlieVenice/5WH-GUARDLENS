// Consistent JSON response shape. Every success is `{ data, meta? }` and every error is
// `{ error: { code, message } }`. Keeping one shape means clients (and tests) parse
// responses the same way everywhere.
import type { Response } from "express";
// Success: `ok(res, payload)` → 200 { data: payload }. Optional `meta` for things like
// pagination cursors.
export function ok<T>(res: Response, data: T, meta?: unknown): void {
  res.json(meta === undefined ? { data } : { data, meta });
}
// Manual error response. Rarely used directly — most errors throw AppError and flow
// through the central errorHandler instead.
export function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}
