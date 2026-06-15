import {
  clinics,
  patients,
  type Database,
  type Keyring,
  type OutboundTransport,
} from "@docmee/db";
import { sendWhatsAppText, type FetchLike } from "@docmee/channels";

/**
 * Real outbound transport: resolves the clinic's (encrypted) WhatsApp credentials
 * and the patient's phone, then delivers via the WhatsApp Cloud API. If the clinic
 * has no credentials yet (pre-X7/X10) or the patient has no phone, it degrades to
 * logging and returns no provider id — the message is still persisted upstream by
 * the chokepoint, so nothing is lost.
 */
export interface WhatsAppTransportDeps {
  db: Database;
  keyring: Keyring;
  log?: (msg: string) => void;
  /** Injectable for tests. */
  fetchImpl?: FetchLike;
}

export function createWhatsAppTransport(deps: WhatsAppTransportDeps): OutboundTransport {
  return {
    send: async ({ clinicId, patientId, content }) => {
      const resolved = await deps.db.withClinicContext(clinicId, async (tx) => {
        const creds = await clinics.getWhatsappCreds(tx, deps.keyring);
        const patient = await patients.getPatientById(tx, deps.keyring, patientId);
        return { creds, phone: patient?.phone ?? null };
      });

      if (!resolved.creds || !resolved.phone) {
        deps.log?.(
          `outbound not delivered (clinic ${clinicId}): ${
            !resolved.creds ? "no WhatsApp credentials" : "no patient phone"
          }`,
        );
        return {};
      }

      return sendWhatsAppText(resolved.creds, resolved.phone, content, deps.fetchImpl);
    },
  };
}
