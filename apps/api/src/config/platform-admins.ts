import { z } from "zod";
import { env } from "./env.js";

const schema = z.array(z.object({ id: z.string(), label: z.string(), passwordHash: z.string() }));
const admins = schema.parse(JSON.parse(env.PLATFORM_ADMINS));

export function findPlatformAdmin(id: string): { id: string; label: string; passwordHash: string } | undefined {
  return admins.find((a) => a.id === id);
}
