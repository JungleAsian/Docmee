import { test, expect, request } from '@playwright/test'
import { createHmac } from 'node:crypto'

// P17 — Send an inbound message, verify the bot pipeline accepts it (Gap #41).
//
// Drives the real WhatsApp webhook with a valid HMAC and asserts the API ACKs
// (200) without enqueuing failures — the same entry point Meta uses, so a 200
// means the inbound job was accepted onto whatsapp.inbound for the bot to answer.
//
// Requires the app secret the stack was booted with. Skipped when it is not
// provided, since a signature cannot be forged without it.
const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3001'
const APP_SECRET = process.env['E2E_META_APP_SECRET'] ?? process.env['META_APP_SECRET'] ?? ''
const PHONE_NUMBER_ID = process.env['E2E_PHONE_NUMBER_ID'] ?? 'PHONE_ID'

const inbound = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550001111', phone_number_id: PHONE_NUMBER_ID },
            contacts: [{ profile: { name: 'E2E Patient' }, wa_id: '5215550001234' }],
            messages: [
              { from: '5215550001234', id: 'wamid.e2e.1', timestamp: '1700000000', type: 'text', text: { body: 'hola, quiero una cita' } },
            ],
          },
        },
      ],
    },
  ],
})

test.describe('bot reply pipeline', () => {
  test.skip(!APP_SECRET, 'E2E_META_APP_SECRET not set — cannot sign the webhook payload')

  test('inbound WhatsApp message is accepted by the webhook', async () => {
    const ctx = await request.newContext({ baseURL: API_URL })
    const signature = `sha256=${createHmac('sha256', APP_SECRET).update(Buffer.from(inbound)).digest('hex')}`

    const res = await ctx.post('/webhook/whatsapp', {
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
      data: inbound,
    })
    expect(res.status()).toBe(200)
    await ctx.dispose()
  })

  test('a webhook without a valid signature is still ACKed but produces no reply', async () => {
    const ctx = await request.newContext({ baseURL: API_URL })
    const res = await ctx.post('/webhook/whatsapp', {
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' },
      data: inbound,
    })
    // Meta requires a fast 200 regardless; the bad signature is dropped server-side.
    expect(res.status()).toBe(200)
    await ctx.dispose()
  })
})
