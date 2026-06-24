import supertest from "supertest";
import { createApp } from "../../app.js";

export function client() {
  return supertest(createApp());
}
// Helper to set the tenant Host header consistently.
export const HOST = "acme.lvh.me";
