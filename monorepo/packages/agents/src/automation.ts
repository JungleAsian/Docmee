import {
  automation,
  conversations,
  appointments,
  sendOutbound,
  type Database,
  type Keyring,
  type OutboundTransport,
} from "@docmee/db";
import { evaluateSixGate, type SixGateResult } from "@docmee/core";

export interface AutomationDeps {
  db: Database;
  keyring: Keyring;
  transport: OutboundTransport;
}

export type AutomationOutcome =
  | { status: "sent"; messageId: string }
  | { status: "skipped"; gate: string }
  | { status: "skipped"; gate: "no_conversation" };

type Job = automation.AutomationJob;

/**
 * Run one queued automation through the SIX GATES (deterministic). Allowed →
 * deliver via the outbound chokepoint and mark sent; blocked → mark skipped with
 * the gate that stopped it. This is the proactive-messaging safety boundary.
 */
export async function runAutomationJob(
  deps: AutomationDeps,
  clinicId: string,
  job: Job,
): Promise<AutomationOutcome> {
  const { db, keyring, transport } = deps;

  if (!job.conversation_id) {
    await db.withClinicContext(clinicId, (tx) =>
      automation.markAutomation(tx, job.id, "skipped", "no_conversation"),
    );
    return { status: "skipped", gate: "no_conversation" };
  }

  const { gate, content } = await db.withClinicContext(clinicId, async (tx) => {
    const patient = await tx.query<{ opted_out: boolean }>(
      `SELECT opted_out FROM patients WHERE id = $1`,
      [job.patient_id],
    );
    const apptCancelled = job.appointment_id
      ? (await tx.query<{ status: string }>(`SELECT status FROM appointments WHERE id = $1`, [
          job.appointment_id,
        ])).rows[0]?.status === "cancelled"
      : false;

    const result: SixGateResult = evaluateSixGate({
      optedOut: patient.rows[0]?.opted_out ?? true,
      automationEnabled: await automation.isAutomationEnabled(tx, job.type),
      appointmentCancelled: apptCancelled,
      hasConsent: await automation.hasConsent(tx, job.patient_id),
      sentWithin48h: await automation.sentWithin48h(tx, job.patient_id, job.type),
      within24hWindow: await conversations.isWindowOpen(tx, job.conversation_id!),
      hasApprovedTemplate: job.template_name
        ? await automation.hasApprovedTemplate(tx, job.template_name)
        : false,
    });

    let body = `[${job.type}]`;
    if (job.template_name) {
      const t = await tx.query<{ body: string }>(
        `SELECT body FROM meta_templates WHERE name = $1 AND status = 'approved' LIMIT 1`,
        [job.template_name],
      );
      if (t.rows[0]) body = t.rows[0].body;
    }
    return { gate: result, content: body };
  });

  if (!gate.allowed) {
    await db.withClinicContext(clinicId, (tx) =>
      automation.markAutomation(tx, job.id, "skipped", gate.blockedBy),
    );
    return { status: "skipped", gate: gate.blockedBy! };
  }

  const sent = await sendOutbound(db, keyring, transport, {
    clinicId,
    conversationId: job.conversation_id,
    patientId: job.patient_id,
    author: "bot",
    content,
  });
  if (sent.status === "suppressed") {
    await db.withClinicContext(clinicId, (tx) =>
      automation.markAutomation(tx, job.id, "skipped", "opted_out"),
    );
    return { status: "skipped", gate: "opted_out" };
  }
  await db.withClinicContext(clinicId, (tx) =>
    automation.markAutomation(tx, job.id, "sent"),
  );
  return { status: "sent", messageId: sent.messageId };
}

/** Process all due automations for a clinic (worker scheduled job). */
export async function processDueAutomations(
  deps: AutomationDeps,
  clinicId: string,
): Promise<AutomationOutcome[]> {
  const due = await deps.db.withClinicContext(clinicId, (tx) =>
    automation.listDueAutomations(tx),
  );
  const out: AutomationOutcome[] = [];
  for (const job of due) out.push(await runAutomationJob(deps, clinicId, job));
  return out;
}

/**
 * Auto-completion job (architecture §9): mark appointments complete 30+ min after
 * end time and enqueue the post-consultation automation (idempotently). Returns
 * how many were completed.
 */
export async function autoCompleteAppointments(
  deps: { db: Database },
  clinicId: string,
): Promise<{ completed: number }> {
  return deps.db.withClinicContext(clinicId, async (tx) => {
    const due = await appointments.findDueForCompletion(tx);
    let completed = 0;
    for (const appt of due) {
      await appointments.transitionStatus(tx, appt.id, "completed");
      await automation.enqueueAutomation(tx, {
        patientId: appt.patient_id,
        appointmentId: appt.id,
        type: "post_consultation",
      });
      completed++;
    }
    return { completed };
  });
}

/** Cancellation cascade: when an appointment is cancelled, drop its automations. */
export async function cancelAppointmentAutomations(
  deps: AutomationDeps,
  clinicId: string,
  appointmentId: string,
): Promise<number> {
  return deps.db.withClinicContext(clinicId, (tx) =>
    appointments
      .transitionStatus(tx, appointmentId, "cancelled")
      .then(() => automation.cancelAutomationsForAppointment(tx, appointmentId)),
  );
}
