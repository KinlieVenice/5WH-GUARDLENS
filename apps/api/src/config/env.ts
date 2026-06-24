import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_DOMAIN: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().default(2592000),
  REFRESH_GRACE_SECONDS: z.coerce.number().default(20),
  LOGIN_MAX_FAILURES: z.coerce.number().default(5),
  LOGIN_LOCK_SECONDS: z.coerce.number().default(900),
  PLATFORM_ADMINS: z.string().default("[]"),
});
export const env = schema.parse(process.env);
export const isTest = env.NODE_ENV === "test";
