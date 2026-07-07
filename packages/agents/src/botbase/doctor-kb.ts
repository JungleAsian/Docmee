// Per-doctor FAQ scoping for the clinic bot's knowledge base (Req 30).
//
// A clinic's knowledge documents are normally clinic-wide. A document MAY instead
// be scoped to a single doctor (its `doctorId` is set) so an FAQ that is true for
// one doctor but not another — "Does Dr. García offer video consultations?",
// "What languages does Dr. López speak?" — only surfaces when the patient is
// actually asking about THAT doctor.
//
// This module is pure (no DB / LLM / I/O), mirroring doctor-availability.ts: the
// worker loads the clinic's doctors + KB chunks and the bot's reply path applies
// the scoping deterministically (so it works under LLM_STUB and in tests).
//
// SEMANTICS:
//   - A clinic-wide chunk (doctorId null/undefined) is ALWAYS a retrieval candidate.
//   - A doctor-scoped chunk is a candidate ONLY when the patient's message names
//     that doctor; another doctor's chunks are excluded so one doctor's FAQ never
//     leaks into an answer about a different doctor.

/** A chunk that may be scoped to a single doctor. */
export interface DoctorScoped {
  doctorId?: string | null
}

/** Minimal doctor reference for name detection (id + display name). */
export interface DoctorRef {
  id: string
  name: string
}

/** True when at least one chunk is scoped to a specific doctor. */
export function hasDoctorScopedChunks(chunks: DoctorScoped[]): boolean {
  return chunks.some((c) => Boolean(c.doctorId))
}

/**
 * Detect which doctor (if any) a free-text message is about, by a case-insensitive
 * name mention. Matches the whole name or any single name token of length 3+
 * (e.g. "García"), mirroring calbot's matchProvider so booking and FAQ stay
 * consistent. Returns the first matching doctor's id, or null when none is named.
 */
export function detectDoctorId(message: string, doctors: DoctorRef[]): string | null {
  const lower = message.toLowerCase()
  for (const d of doctors) {
    const name = d.name.toLowerCase().trim()
    if (!name) continue
    if (lower.includes(name)) return d.id
    if (name.split(/\s+/).some((part) => part.length >= 3 && lower.includes(part))) return d.id
  }
  return null
}

/**
 * Keep clinic-wide chunks plus only the chunks for `activeDoctorId`, dropping every
 * other doctor's scoped chunks. With no active doctor (none named), only clinic-wide
 * chunks remain so a generic question never pulls in doctor-specific FAQs.
 */
export function scopeChunksToDoctor<T extends DoctorScoped>(
  chunks: T[],
  activeDoctorId: string | null,
): T[] {
  return chunks.filter((c) => !c.doctorId || c.doctorId === activeDoctorId)
}

/**
 * Convenience entry point: detect the doctor named in `message` and scope `chunks`
 * to it. When no chunk is doctor-scoped this is a no-op (returns the input as-is),
 * so clinics that never configure per-doctor FAQs pay no behavioural cost and the
 * doctor list need not even be loaded by the caller in that case.
 */
export function scopeKbToMessage<T extends DoctorScoped>(
  message: string,
  chunks: T[],
  doctors: DoctorRef[],
): T[] {
  if (!hasDoctorScopedChunks(chunks)) return chunks
  const activeDoctorId = detectDoctorId(message, doctors)
  return scopeChunksToDoctor(chunks, activeDoctorId)
}
