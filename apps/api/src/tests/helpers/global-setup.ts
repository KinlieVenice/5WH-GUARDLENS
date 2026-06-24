import { execSync } from "node:child_process";
import "dotenv/config";

export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required to run tests");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, NODE_ENV: "test" },
  });
}
