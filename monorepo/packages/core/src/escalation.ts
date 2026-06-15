/**
 * Notification escalation policy (architecture §11). Pure functions — the worker
 * applies them on a timer. Escalation chain for unacknowledged urgent alerts:
 *   10 min → assigned secretary · 20 → all secretaries · 30 → clinic admin ·
 *   60 → IA Studio admin. Deduplication: same type + same conversation within
 *   5 minutes is suppressed. Quiet hours apply to P3/P4 only.
 */
export type EscalationTarget =
  | "assigned_secretary"
  | "all_secretaries"
  | "clinic_admin"
  | "ia_studio_admin";

export type Priority = "P1" | "P2" | "P3" | "P4";

const MIN = 60_000;
const STEPS: { afterMs: number; target: EscalationTarget }[] = [
  { afterMs: 0, target: "assigned_secretary" },
  { afterMs: 10 * MIN, target: "all_secretaries" },
  { afterMs: 20 * MIN, target: "clinic_admin" },
  { afterMs: 60 * MIN, target: "ia_studio_admin" },
];

/** The set of targets that should be notified given how long an alert is unacked. */
export function escalationTargets(elapsedMs: number): EscalationTarget[] {
  return STEPS.filter((s) => elapsedMs >= s.afterMs).map((s) => s.target);
}

/** The current (highest) escalation target for an unacknowledged alert. */
export function currentEscalationTarget(elapsedMs: number): EscalationTarget {
  const reached = escalationTargets(elapsedMs);
  return reached[reached.length - 1] ?? "assigned_secretary";
}

const DEDUP_WINDOW_MS = 5 * MIN;

/** Suppress a duplicate: same type + conversation within the dedup window. */
export function isDuplicate(
  incoming: { type: string; conversationId?: string | null; atMs: number },
  recent: { type: string; conversationId?: string | null; atMs: number }[],
): boolean {
  return recent.some(
    (r) =>
      r.type === incoming.type &&
      (r.conversationId ?? null) === (incoming.conversationId ?? null) &&
      incoming.atMs - r.atMs < DEDUP_WINDOW_MS,
  );
}

/** Quiet hours suppress only P3/P4 (P1/P2 always go through). */
export function isQuietHoursSuppressed(priority: Priority, inQuietHours: boolean): boolean {
  return inQuietHours && (priority === "P3" || priority === "P4");
}
