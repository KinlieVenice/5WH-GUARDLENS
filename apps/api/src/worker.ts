import { cleanupExpiredTokens } from "./jobs/token-cleanup.js";

const HOUR = 3600_000;
async function tick(): Promise<void> {
  const r = await cleanupExpiredTokens();
  console.log("[worker] token cleanup", r);
}
tick().catch(console.error);
// Catch rejections on every interval tick too — an unhandled rejection (e.g. DB
// outage during a scheduled run) would otherwise crash the long-running worker.
setInterval(() => { tick().catch(console.error); }, HOUR);
console.log("worker started: hourly token cleanup");
