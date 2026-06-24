import { cleanupExpiredTokens } from "./jobs/token-cleanup.js";

const HOUR = 3600_000;
async function tick(): Promise<void> {
  const r = await cleanupExpiredTokens();
  console.log("[worker] token cleanup", r);
}
tick().catch(console.error);
setInterval(() => { void tick(); }, HOUR);
console.log("worker started: hourly token cleanup");
