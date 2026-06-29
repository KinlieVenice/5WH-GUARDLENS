// Report catalog service. Editing a type's fields appends a NEW immutable version row;
// type metadata (name/lane/isActive) is patched in place. All access is tenant-scoped via
// getScopedPrisma(); key + isSystem are never mutated here (isSystem is set only by the seeder).
import type { ReportLane, ReportType, ReportTypeVersion } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { getScopedPrisma } from "../../shared/prisma/index.js";
import { requireContext } from "../../shared/context/request-context.js";
import { AppError } from "../../shared/errors/app-error.js";
import { formSchema, type FormSchema } from "../../shared/report-schema.js";

// Validate fields and return them as a Prisma JSON value.
function toJson(fields: FormSchema): Prisma.InputJsonValue {
  return formSchema.parse(fields) as unknown as Prisma.InputJsonValue;
}

// Create a new catalog entry plus its v1, atomically. Duplicate [tenantId,key] → 409.
export async function createType(
  input: { key: string; name: string; lane: ReportLane },
  fields: FormSchema,
): Promise<{ type: ReportType; version: ReportTypeVersion }> {
  const ctx = requireContext();
  const schema = toJson(fields);
  const db = getScopedPrisma();
  try {
    return await db.$transaction(async (tx) => {
      const type = await tx.reportType.create({ data: { key: input.key, name: input.name, lane: input.lane } });
      const version = await tx.reportTypeVersion.create({
        data: { reportTypeId: type.id, version: 1, schema, createdById: ctx.userId ?? "system" },
      });
      return { type, version };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw new AppError("CONFLICT", "A report type with that key already exists", 409);
    throw e;
  }
}

// Append a new version (version = current max + 1). Old version rows are never touched.
export async function addVersion(reportTypeId: string, fields: FormSchema): Promise<ReportTypeVersion> {
  const ctx = requireContext();
  const schema = toJson(fields);
  const db = getScopedPrisma();
  const type = await db.reportType.findUnique({ where: { id: reportTypeId } });
  if (!type) throw new AppError("NOT_FOUND", "Report type not found", 404);
  const last = await db.reportTypeVersion.findFirst({
    where: { reportTypeId }, orderBy: { version: "desc" },
  });
  const next = (last?.version ?? 0) + 1;
  try {
    return await db.reportTypeVersion.create({
      data: { reportTypeId, version: next, schema, createdById: ctx.userId ?? "system" },
    });
  } catch (e) {
    // Two concurrent addVersion calls can compute the same `next`; the unique
    // [reportTypeId,version] constraint makes the loser throw P2002 → surface as 409, not 500.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw new AppError("CONFLICT", "Version conflict, retry", 409);
    throw e;
  }
}

// Patch type metadata in place. key + isSystem are not accepted (immutable).
export async function updateTypeMeta(
  reportTypeId: string,
  patch: { name?: string; lane?: ReportLane; isActive?: boolean },
): Promise<ReportType> {
  const db = getScopedPrisma();
  const type = await db.reportType.findUnique({ where: { id: reportTypeId } });
  if (!type) throw new AppError("NOT_FOUND", "Report type not found", 404);
  // Allowlist fields explicitly: TS types erase at runtime, so destructure to stop a
  // raw patch (e.g. req.body) from smuggling key/isSystem into the update.
  const { name, lane, isActive } = patch;
  return db.reportType.update({ where: { id: reportTypeId }, data: { name, lane, isActive } });
}

export async function listTypes(opts?: { lane?: ReportLane; activeOnly?: boolean }): Promise<ReportType[]> {
  return getScopedPrisma().reportType.findMany({
    where: { ...(opts?.lane ? { lane: opts.lane } : {}), ...(opts?.activeOnly ? { isActive: true } : {}) },
    orderBy: { createdAt: "asc" },
  });
}

export async function getType(reportTypeId: string): Promise<ReportType & { versions: ReportTypeVersion[] }> {
  const type = await getScopedPrisma().reportType.findUnique({
    where: { id: reportTypeId }, include: { versions: { orderBy: { version: "asc" } } },
  });
  if (!type) throw new AppError("NOT_FOUND", "Report type not found", 404);
  return type;
}

export async function getVersion(reportTypeId: string, version: number): Promise<ReportTypeVersion> {
  const row = await getScopedPrisma().reportTypeVersion.findFirst({ where: { reportTypeId, version } });
  if (!row) throw new AppError("NOT_FOUND", "Report type version not found", 404);
  return row;
}
