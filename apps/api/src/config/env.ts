// Loads and validates environment variables ONCE at startup. If a required var is
// missing or malformed, Zod throws here and the process refuses to boot — better a
// loud crash on boot than a subtle misconfig in production. Import `env` anywhere to
// get fully-typed, validated config.
import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  // NODE_ENV drives test-vs-prod behavior (e.g. secure cookies, which DB to use).
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_DOMAIN: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32), // signs access tokens; min 32 bytes enforced
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900), // 15 min (short-lived)
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().default(2592000), // 30 days
  REFRESH_GRACE_SECONDS: z.coerce.number().default(20), // benign-retry window on refresh
  LOGIN_MAX_FAILURES: z.coerce.number().default(5), // bad logins before lockout
  LOGIN_LOCK_SECONDS: z.coerce.number().default(900), // lockout duration
  PLATFORM_ADMINS: z.string().default("[]"), // JSON array of impersonation admins
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().default(5),       // attempts before dead-lettering to FAILED
  OUTBOX_BACKOFF_BASE_MS: z.coerce.number().default(1000), // exponential backoff base
  OUTBOX_BACKOFF_CAP_MS: z.coerce.number().default(300000),// backoff ceiling (5 min)
  OUTBOX_CLAIM_BATCH: z.coerce.number().default(10),       // rows claimed per relay tick
  OUTBOX_LOCK_MS: z.coerce.number().default(30000),        // lockedUntil lease window
});
// Parse once; `env` is the typed, validated config used everywhere.
export const env = schema.parse(process.env);
export const isTest = env.NODE_ENV === "test";
