import { getScopedPrisma } from "../../shared/prisma/index.js";
import { issueAuthToken } from "../auth/auth.service.js";
import type { Role } from "@prisma/client";

// Admin creates an invited user and gets a one-time INVITE token (to email).
export async function createInvite(input: { tenantId: string; email: string; name: string; role: Role }): Promise<{ userId: string; token: string }> {
  const db = getScopedPrisma();
  const user = await db.user.create({ data: { tenantId: input.tenantId, email: input.email, name: input.name, role: input.role, status: "INVITED" } });
  const token = await issueAuthToken(user.id, input.tenantId, "INVITE", 7 * 24 * 3600);
  return { userId: user.id, token };
}
