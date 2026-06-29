// The shape of a report form's fields, stored as JSON in ReportTypeVersion.schema.
// Used to validate catalog writes (1.4) and later to interpret incident fieldValues (1.5).
import { z } from "zod";

// One field on a form. `options` is required for (and only allowed on) dropdowns.
export const fieldSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(["text", "dropdown", "photo", "yesno"]),
    required: z.boolean(),
    options: z.array(z.string().min(1)).min(1).optional(),
  })
  .superRefine((f, ctx) => {
    if (f.type === "dropdown" && !f.options)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dropdown requires options", path: ["options"] });
    if (f.type !== "dropdown" && f.options)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "options only allowed on dropdown", path: ["options"] });
  });

// A whole form: a list of fields with unique keys.
export const formSchema = z.array(fieldSchema).superRefine((fields, ctx) => {
  const keys = fields.map((f) => f.key);
  if (new Set(keys).size !== keys.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "field keys must be unique within a form" });
});

export type Field = z.infer<typeof fieldSchema>;
export type FormSchema = z.infer<typeof formSchema>;
