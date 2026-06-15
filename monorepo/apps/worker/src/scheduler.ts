import {
  iastudio,
  analytics,
  type Database,
  type Keyring,
  type OutboundTransport,
} from "@docmee/db";
import { autoCompleteAppointments, processDueAutomations } from "@docmee/agents";

/**
 * Scheduled jobs (architecture §12). The worker iterates clinics (via the audited
 * admin carve-out) and runs per-clinic, RLS-scoped jobs: appointment
 * auto-completion (+ post-visit automation) and due-automation processing through
 * the six gates. Daily metric rollups run on their own cadence.
 */
export interface SchedulerDeps {
  db: Database;
  keyring: Keyring;
  transport: OutboundTransport;
}

export interface TickSummary {
  clinics: number;
  completed: number;
  automationsSent: number;
  automationsSkipped: number;
}

async function activeClinics(db: Database): Promise<{ id: string }[]> {
  const clinics = await db.withAdminContext("ia_studio_read", "scheduled_jobs", (tx) =>
    iastudio.listClinics(tx),
  );
  return clinics.filter((c) => c.status === "active");
}

/** One scheduler tick (run every ~30 min). Returns a summary for observability. */
export async function runScheduledTick(deps: SchedulerDeps): Promise<TickSummary> {
  const clinics = await activeClinics(deps.db);
  let completed = 0;
  let automationsSent = 0;
  let automationsSkipped = 0;

  for (const clinic of clinics) {
    const ac = await autoCompleteAppointments({ db: deps.db }, clinic.id);
    completed += ac.completed;

    const outcomes = await processDueAutomations(
      { db: deps.db, keyring: deps.keyring, transport: deps.transport },
      clinic.id,
    );
    for (const o of outcomes) {
      if (o.status === "sent") automationsSent++;
      else automationsSkipped++;
    }
  }

  return { clinics: clinics.length, completed, automationsSent, automationsSkipped };
}

/** Daily metric pre-aggregation across all clinics for `day` (YYYY-MM-DD). */
export async function runDailyRollups(deps: { db: Database }, day: string): Promise<number> {
  const clinics = await activeClinics(deps.db);
  for (const clinic of clinics) {
    await deps.db.withClinicContext(clinic.id, (tx) => analytics.computeDailyRollup(tx, day));
  }
  return clinics.length;
}
