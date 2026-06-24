import { PrismaClient } from "@prisma/client";
import { env, isTest } from "../../config/env.js";

export const basePrisma = new PrismaClient({
  datasources: { db: { url: isTest && env.TEST_DATABASE_URL ? env.TEST_DATABASE_URL : env.DATABASE_URL } },
});
