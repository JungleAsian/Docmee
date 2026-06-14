import type { ClinicTx } from "../types.js";

export type Priority = "P1" | "P2" | "P3" | "P4";

export interface NotificationView {
  id: string;
  priority: Priority;
  type: string;
  conversationId: string | null;
  patientId: string | null;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  priority: Priority;
  type: string;
  conversation_id: string | null;
  patient_id: string | null;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

const toView = (r: Row): NotificationView => ({
  id: r.id,
  priority: r.priority,
  type: r.type,
  conversationId: r.conversation_id,
  patientId: r.patient_id,
  body: r.body,
  readAt: r.read_at,
  createdAt: r.created_at,
});

export async function createNotification(
  tx: ClinicTx,
  n: {
    priority: Priority;
    type: string;
    conversationId?: string;
    patientId?: string;
    body?: string;
  },
): Promise<NotificationView> {
  const { rows } = await tx.query<Row>(
    `INSERT INTO notifications (clinic_id, priority, type, conversation_id, patient_id, body)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [tx.clinicId, n.priority, n.type, n.conversationId ?? null, n.patientId ?? null, n.body ?? null],
  );
  return toView(rows[0]!);
}

export async function listNotifications(
  tx: ClinicTx,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationView[]> {
  const { rows } = await tx.query<Row>(
    `SELECT * FROM notifications
     ${opts.unreadOnly ? "WHERE read_at IS NULL" : ""}
     ORDER BY created_at DESC LIMIT $1`,
    [Math.min(Math.max(opts.limit ?? 50, 1), 200)],
  );
  return rows.map(toView);
}

export async function markRead(tx: ClinicTx, id: string): Promise<void> {
  await tx.query(`UPDATE notifications SET read_at = now() WHERE id = $1`, [id]);
}
