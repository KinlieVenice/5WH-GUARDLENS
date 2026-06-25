// Shared cursor-pagination query schema (?cursor=...&limit=...). Not heavily used in
// Stage 0 (lists are small) but defined here so list endpoints page consistently later.
import { z } from "zod";
export const cursorPageSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});
export type CursorPage = z.infer<typeof cursorPageSchema>;
