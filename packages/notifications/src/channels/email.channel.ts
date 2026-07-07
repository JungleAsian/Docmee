// Only file permitted to import resend (enforced by the no-direct-resend convention).
// Every other module must send email through sendEmail().
import { Resend } from 'resend'

export interface SendEmailParams {
  to: string
  subject: string
  html: string
  from?: string
}

export type SendEmailFn = (params: SendEmailParams) => Promise<void>

let client: Resend | null = null

function getClient(): Resend {
  // Lazily construct so importing the module never requires RESEND_API_KEY to be
  // set (tests run with LLM_STUB=true and never reach here).
  if (!client) client = new Resend(process.env['RESEND_API_KEY'])
  return client
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  if (process.env['LLM_STUB'] === 'true') return // skip real delivery in tests

  await getClient().emails.send({
    from: params.from ?? process.env['EMAIL_FROM'] ?? 'notifications@docmee.app',
    to: params.to,
    subject: params.subject,
    html: params.html,
  })
}
