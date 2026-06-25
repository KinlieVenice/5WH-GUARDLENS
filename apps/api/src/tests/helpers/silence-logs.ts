import { vi } from "vitest";

// Silence dev-seam console.info (audit, email) so test output is pristine.
// console.error/warn/log are left untouched so real failures still surface.
vi.spyOn(console, "info").mockImplementation(() => {});
