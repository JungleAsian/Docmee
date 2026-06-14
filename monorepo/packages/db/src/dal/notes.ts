import type { ClinicTx } from "../types.js";

export interface NoteView {
  id: string;
  body: string;
  authorId: string | null;
  createdAt: string;
}

interface NoteRow {
  id: string;
  body: string;
  author_id: string | null;
  created_at: string;
}

const toView = (r: NoteRow): NoteView => ({
  id: r.id,
  body: r.body,
  authorId: r.author_id,
  createdAt: r.created_at,
});

export async function addPatientNote(
  tx: ClinicTx,
  n: { patientId: string; authorId?: string; body: string },
): Promise<NoteView> {
  const { rows } = await tx.query<NoteRow>(
    `INSERT INTO patient_notes (clinic_id, patient_id, author_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, body, author_id, created_at`,
    [tx.clinicId, n.patientId, n.authorId ?? null, n.body],
  );
  return toView(rows[0]!);
}

export async function listPatientNotes(
  tx: ClinicTx,
  patientId: string,
): Promise<NoteView[]> {
  const { rows } = await tx.query<NoteRow>(
    `SELECT id, body, author_id, created_at FROM patient_notes
     WHERE patient_id = $1 ORDER BY created_at DESC`,
    [patientId],
  );
  return rows.map(toView);
}

export async function addConversationNote(
  tx: ClinicTx,
  n: { conversationId: string; authorId?: string; body: string },
): Promise<NoteView> {
  const { rows } = await tx.query<NoteRow>(
    `INSERT INTO conversation_notes (clinic_id, conversation_id, author_id, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, body, author_id, created_at`,
    [tx.clinicId, n.conversationId, n.authorId ?? null, n.body],
  );
  return toView(rows[0]!);
}
