// HTTP test helper: wraps the real Express app in supertest so tests can fire real requests
// without opening a port. HOST is the tenant Host header that resolveTenant maps to "acme".
import supertest from "supertest";
import { createApp } from "../../app.js";

export function client() {
  return supertest(createApp());
}
// Helper to set the tenant Host header consistently.
export const HOST = "acme.lvh.me";
