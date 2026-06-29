// The six prebuilt report types every tenant ships with. Defined in code (not a SQL seed)
// because the rows are per-tenant. seedSystemReportTypes() is idempotent: it upserts each
// type by [tenantId,key] and inserts a v1 only if the type has none. Runs outside a request
// context (provisioning / dev seed), so it uses basePrisma with an explicit tenantId — its
// import is sanctioned in the base-client-boundary leak test.
import type { ReportLane } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { basePrisma } from "../../shared/prisma/base-client.js";
import type { FormSchema } from "../../shared/report-schema.js";

const text = (key: string, label: string, required = false) => ({ key, label, type: "text" as const, required });
const yesno = (key: string, label: string, required = false) => ({ key, label, type: "yesno" as const, required });
const dropdown = (key: string, label: string, options: string[], required = false) => ({ key, label, type: "dropdown" as const, required, options });

export const SYSTEM_REPORT_TYPES: ReadonlyArray<{ key: string; name: string; lane: ReportLane; fields: FormSchema }> = [
  { key: "theft", name: "Theft", lane: "SECURITY", fields: [text("location", "Location", true), text("item", "Item taken", true), text("estimated_value", "Estimated value"), text("witness", "Witness")] },
  { key: "trespass", name: "Trespass", lane: "SECURITY", fields: [text("location", "Location", true), text("description", "Description", true), yesno("police_called", "Police called?")] },
  { key: "guest_dispute", name: "Guest Dispute", lane: "SECURITY", fields: [text("location", "Location", true), text("parties", "Parties involved", true), text("resolution", "Resolution")] },
  { key: "medical", name: "Medical", lane: "SAFETY", fields: [text("location", "Location", true), dropdown("person_type", "Person type", ["Guest", "Staff", "Visitor"]), yesno("ambulance_called", "Ambulance called?", true)] },
  { key: "hazard", name: "Hazard", lane: "SAFETY", fields: [text("location", "Location", true), dropdown("hazard_type", "Hazard type", ["Spill", "Fire", "Structural", "Other"]), dropdown("severity", "Severity", ["Low", "Medium", "High"], true)] },
  { key: "lost_item", name: "Lost Item", lane: "SECURITY", fields: [text("location", "Last seen", true), text("item", "Item", true), text("owner_contact", "Owner contact")] },
];

// Idempotent: upsert each type by [tenantId,key]; insert v1 only if the type has none.
export async function seedSystemReportTypes(tenantId: string): Promise<void> {
  for (const entry of SYSTEM_REPORT_TYPES) {
    const type = await basePrisma.reportType.upsert({
      where: { tenantId_key: { tenantId, key: entry.key } },
      update: {},
      create: { tenantId, key: entry.key, name: entry.name, lane: entry.lane, isSystem: true },
    });
    const existing = await basePrisma.reportTypeVersion.count({ where: { reportTypeId: type.id } });
    if (existing === 0) {
      await basePrisma.reportTypeVersion.create({
        data: { tenantId, reportTypeId: type.id, version: 1, schema: entry.fields as unknown as Prisma.InputJsonValue, createdById: "system" },
      });
    }
  }
}
