import type { Response } from "express";
export function ok<T>(res: Response, data: T, meta?: unknown): void {
  res.json(meta === undefined ? { data } : { data, meta });
}
export function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}
