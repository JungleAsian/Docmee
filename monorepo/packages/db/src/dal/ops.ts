import type { ClinicTx } from "../types.js";

// ── Quick replies (canned responses) ──────────────────────────────────────────
export interface QuickReply {
  id: string;
  shortcut: string;
  body: string;
}

export async function listQuickReplies(tx: ClinicTx): Promise<QuickReply[]> {
  const { rows } = await tx.query<QuickReply>(
    `SELECT id, shortcut, body FROM quick_replies ORDER BY shortcut`,
  );
  return rows;
}

export async function createQuickReply(
  tx: ClinicTx,
  q: { shortcut: string; body: string },
): Promise<QuickReply> {
  const { rows } = await tx.query<QuickReply>(
    `INSERT INTO quick_replies (clinic_id, shortcut, body)
     VALUES ($1, $2, $3) RETURNING id, shortcut, body`,
    [tx.clinicId, q.shortcut, q.body],
  );
  return rows[0]!;
}

export async function deleteQuickReply(tx: ClinicTx, id: string): Promise<void> {
  await tx.query(`DELETE FROM quick_replies WHERE id = $1`, [id]);
}

// ── Manual invoicing (Stripe deferred — FI5) ──────────────────────────────────
export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export interface Invoice {
  id: string;
  clinic_id: string;
  period_start: string;
  period_end: string;
  amount_cents: number;
  status: InvoiceStatus;
  created_at: string;
}

export async function listInvoices(tx: ClinicTx): Promise<Invoice[]> {
  const { rows } = await tx.query<Invoice>(
    `SELECT * FROM invoices ORDER BY period_start DESC`,
  );
  return rows;
}

export async function createInvoice(
  tx: ClinicTx,
  i: { periodStart: string; periodEnd: string; amountCents: number },
): Promise<Invoice> {
  const { rows } = await tx.query<Invoice>(
    `INSERT INTO invoices (clinic_id, period_start, period_end, amount_cents)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tx.clinicId, i.periodStart, i.periodEnd, i.amountCents],
  );
  return rows[0]!;
}

export async function setInvoiceStatus(
  tx: ClinicTx,
  id: string,
  status: InvoiceStatus,
): Promise<Invoice | null> {
  const { rows } = await tx.query<Invoice>(
    `UPDATE invoices SET status = $2 WHERE id = $1 RETURNING *`,
    [id, status],
  );
  return rows[0] ?? null;
}
