// The one error type the app throws on purpose. It pairs a machine-readable `code` with
// the HTTP `status` to return, so handlers can `throw new AppError(...)` anywhere and the
// central errorHandler (handler.ts) turns it into the right JSON response.
export type ErrorCode =
  | "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND"
  | "CONFLICT" | "RATE_LIMITED" | "INTERNAL";

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string, public status: number) {
    super(message);
    this.name = "AppError";
  }
}
