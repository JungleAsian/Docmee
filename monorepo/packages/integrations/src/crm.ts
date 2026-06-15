import { createHmac } from "node:crypto";

/**
 * CRM webhook + Google Sheets export (Phase 3C). Philosophy: Docmee is the source
 * of communication data; external tools are the DESTINATION (data flows outward).
 * CRM posts are HMAC-SHA256 signed; export requires written consent (SEC24),
 * enforced by the caller before invoking these.
 */

/** Compute the X-Docmee-Signature header value for a payload (pure, testable). */
export function signPayload(payload: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

export interface CrmWebhookConfig {
  url: string;
  secret: string;
  maxRetries?: number;
}

/** POST a signed payload to the clinic's CRM URL with bounded retries + backoff. */
export async function postToCrm(
  config: CrmWebhookConfig,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; status: number }> {
  const body = JSON.stringify(data);
  const signature = signPayload(body, config.secret);
  const retries = config.maxRetries ?? 3;
  let lastStatus = 0;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(config.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-docmee-signature": signature },
        body,
      });
      lastStatus = res.status;
      if (res.ok) return { ok: true, status: res.status };
    } catch {
      lastStatus = 0;
    }
  }
  return { ok: false, status: lastStatus };
}

export interface SheetsConfig {
  accessToken: string;
  spreadsheetId: string;
  range?: string;
  baseUrl?: string;
}

/** Append a row to a Google Sheet (export destination). Wired; gated on consent. */
export async function appendToSheet(
  config: SheetsConfig,
  row: (string | number)[],
): Promise<{ ok: boolean }> {
  const base = config.baseUrl ?? "https://sheets.googleapis.com/v4/spreadsheets";
  const range = config.range ?? "A1";
  const res = await fetch(
    `${base}/${config.spreadsheetId}/values/${range}:append?valueInputOption=RAW`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ values: [row] }),
    },
  );
  return { ok: res.ok };
}
