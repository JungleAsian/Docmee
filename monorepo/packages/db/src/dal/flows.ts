import type { ClinicTx } from "../types.js";
import type { FlowDefinition, Rule } from "@docmee/core";

export interface FlowRow {
  id: string;
  name: string;
  definition: FlowDefinition;
  enabled: boolean;
}

export async function createFlow(
  tx: ClinicTx,
  f: { name: string; definition: FlowDefinition },
): Promise<{ id: string }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO flows (clinic_id, name, definition) VALUES ($1, $2, $3) RETURNING id`,
    [tx.clinicId, f.name, JSON.stringify(f.definition)],
  );
  return rows[0]!;
}

export async function listFlows(tx: ClinicTx): Promise<FlowRow[]> {
  const { rows } = await tx.query<FlowRow>(
    `SELECT id, name, definition, enabled FROM flows ORDER BY name`,
  );
  return rows;
}

// ── Clinic rules ──────────────────────────────────────────────────────────────
export interface RuleRow {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
}

export async function createRule(
  tx: ClinicTx,
  r: { name: string; definition: Omit<Rule, "id" | "priority">; priority?: number },
): Promise<{ id: string }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO clinic_rules (clinic_id, name, definition, priority)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tx.clinicId, r.name, JSON.stringify(r.definition), r.priority ?? 0],
  );
  return rows[0]!;
}

/** Load enabled rules as engine-ready Rule[] (id + priority merged in). */
export async function loadEnabledRules(tx: ClinicTx): Promise<Rule[]> {
  const { rows } = await tx.query<{
    id: string;
    priority: number;
    definition: { when: Rule["when"]; then: Rule["then"] };
  }>(`SELECT id, priority, definition FROM clinic_rules WHERE enabled = true`);
  return rows.map((r) => ({
    id: r.id,
    priority: r.priority,
    when: r.definition.when,
    then: r.definition.then,
  }));
}
