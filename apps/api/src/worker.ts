// Standalone background process (separate from the HTTP server). Runs the token-cleanup job
// once at startup and then hourly forever. Kept deliberately tiny — it's just a scheduler.
import { cleanupExpiredTokens } from "./jobs/token-cleanup.js";
import { runRelayOnce } from "./modules/outbox/outbox.relay.js";

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

const OUTBOX_POLL_MS = 2000;
// Drain the outbox every couple of seconds. Catch rejections per tick so a transient DB blip
// can't crash the long-running worker (same discipline as the cleanup tick).
async function relayTick(): Promise<void> {
  const r = await runRelayOnce();
  if (r.processed || r.failed) console.log("[worker] outbox relay", r);
}
relayTick().catch(console.error);
setInterval(() => { relayTick().catch(console.error); }, OUTBOX_POLL_MS);
console.log("worker started: outbox relay every 2s");
