// Single shared Redis connection for the whole process (rate limits, login lockout).
// `maxRetriesPerRequest: null` lets commands wait through brief reconnects instead of
// throwing. Note: import the NAMED { Redis } export so it type-checks under NodeNext.
import { Redis } from "ioredis";
import { env } from "../../config/env.js";
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
