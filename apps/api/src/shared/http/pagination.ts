import { z } from "zod";
export const cursorPageSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});
export type CursorPage = z.infer<typeof cursorPageSchema>;
