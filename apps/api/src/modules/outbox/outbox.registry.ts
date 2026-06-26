// Maps an event type to the handler that reacts to it. Decoupled from the relay so future
// consumers (logbook, notifications) register without touching relay code. An unknown type has
// no handler, which the relay treats as a delivery failure (so a missing consumer is visible).
export type OutboxEventView = { id: string; tenantId: string; type: string; payload: unknown };
export type OutboxHandler = (event: OutboxEventView) => Promise<void>;

const handlers = new Map<string, OutboxHandler>();
export function register(type: string, handler: OutboxHandler): void { handlers.set(type, handler); }
export function getHandler(type: string): OutboxHandler | undefined { return handlers.get(type); }
export function clearHandlers(): void { handlers.clear(); } // test hygiene
