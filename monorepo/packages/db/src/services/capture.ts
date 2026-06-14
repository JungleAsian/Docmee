import { z } from "zod";
import type { ClinicTx } from "../types.js";
import { setStatus, addTag } from "../dal/patients.js";
import { writeAudit } from "../dal/audit.js";

/**
 * Bot data-capture allowlist (Phase 1B gaps G14–G18). The bot writes patient data
 * ONLY through this fixed, validated allowlist of operations — never arbitrary SQL.
 * Each op is field-level, schema-validated, audited, and never deletes. Anything
 * not on the list is rejected.
 */
const PATIENT_STATUSES = ["lead", "active", "inactive"] as const;

const captureSchema = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("set_patient_name"),
    patientId: z.string().uuid(),
    name: z.string().min(1).max(120),
  }),
  z.object({
    tool: z.literal("add_patient_tag"),
    patientId: z.string().uuid(),
    tag: z.string().min(1).max(40),
  }),
  z.object({
    tool: z.literal("set_patient_status"),
    patientId: z.string().uuid(),
    status: z.enum(PATIENT_STATUSES),
  }),
]);

export type CaptureOp = z.infer<typeof captureSchema>;

/** The tool names the bot is permitted to call (for prompt/tool-spec generation). */
export const CAPTURE_TOOLS = [
  "set_patient_name",
  "add_patient_tag",
  "set_patient_status",
] as const;

export interface CaptureResult {
  ok: boolean;
  tool?: string;
  error?: string;
}

/**
 * Validate + apply a single bot-capture operation within the clinic transaction.
 * Returns a result rather than throwing on validation failure so the bot loop can
 * continue; genuinely unknown tools are rejected (never executed).
 */
export async function applyCapture(tx: ClinicTx, raw: unknown): Promise<CaptureResult> {
  const parsed = captureSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "rejected: not on capture allowlist or invalid args" };
  }
  const op = parsed.data;

  switch (op.tool) {
    case "set_patient_name":
      await tx.query(`UPDATE patients SET name = $2 WHERE id = $1`, [
        op.patientId,
        op.name,
      ]);
      break;
    case "add_patient_tag":
      await addTag(tx, op.patientId, op.tag);
      break;
    case "set_patient_status":
      await setStatus(tx, op.patientId, op.status);
      break;
  }

  await writeAudit(tx, {
    action: `bot.capture:${op.tool}`,
    target: op.patientId,
  });
  return { ok: true, tool: op.tool };
}
