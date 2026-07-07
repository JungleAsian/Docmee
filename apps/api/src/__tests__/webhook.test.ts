import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'

const { add, statusAdd } = vi.hoisted(() => ({ add: vi.fn(), statusAdd: vi.fn() }))
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add },
  whatsappStatusQueue: { add: statusAdd },
}))

import { buildApp } from '../app.js'

const SECRET = 'webhook-secret'
const VERIFY = 'verify-token'

const validPayload = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550001111', phone_number_id: 'PHONE_ID' },
            contacts: [{ profile: { name: 'Ana' }, wa_id: '5215555555555' }],
            messages: [
              { from: '5215555555555', id: 'wamid.1', timestamp: '1700000000', type: 'text', text: { body: 'hola' } },
            ],
          },
        },
      ],
    },
  ],
})

const sign = (b: string) => `sha256=${createHmac('sha256', SECRET).update(Buffer.from(b)).digest('hex')}`
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('webhook routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['META_APP_SECRET'] = SECRET
    process.env['META_VERIFY_TOKEN'] = VERIFY
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    add.mockClear()
    statusAdd.mockClear()
  })

  it('GET verification with the correct token returns 200 + challenge', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=42`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('42')
  })

  it('GET verification with a wrong token returns 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42',
    })
    expect(res.statusCode).toBe(403)
  })

  it('POST always returns 200, even for an invalid payload', async () => {
    const body = '{"not":"whatsapp"}'
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) },
      payload: body,
    })
    await flush()
    expect(res.statusCode).toBe(200)
    expect(add).not.toHaveBeenCalled()
  })

  it('POST with an invalid HMAC returns 200 but does not enqueue', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' },
      payload: validPayload,
    })
    await flush()
    expect(res.statusCode).toBe(200)
    expect(add).not.toHaveBeenCalled()
  })

  it('POST with a valid payload + HMAC returns 200 and enqueues the message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(validPayload) },
      payload: validPayload,
    })
    await flush()
    expect(res.statusCode).toBe(200)
    expect(add).toHaveBeenCalledTimes(1)
    const [name, job] = add.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('inbound')
    expect(job['phoneNumberId']).toBe('PHONE_ID')
    expect(job['patientWaId']).toBe('5215555555555')
    expect(job['patientName']).toBe('Ana')
    expect(job['messageType']).toBe('text')
    expect(job['content']).toBe('hola')
    // A message-only change does not enqueue a delivery status.
    expect(statusAdd).not.toHaveBeenCalled()
  })

  it('POST with an inbound image enqueues with the media id, mime type and caption', async () => {
    const imagePayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15550001111', phone_number_id: 'PHONE_ID' },
                contacts: [{ profile: { name: 'Ana' }, wa_id: '5215555555555' }],
                messages: [
                  {
                    from: '5215555555555',
                    id: 'wamid.IMG1',
                    timestamp: '1700000300',
                    type: 'image',
                    image: { id: 'media-abc', mime_type: 'image/jpeg', caption: 'mi receta' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/webhook/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(imagePayload) },
      payload: imagePayload,
    })
    await flush()

    expect(res.statusCode).toBe(200)
    expect(add).toHaveBeenCalledTimes(1)
    const [, job] = add.mock.calls[0] as [string, Record<string, unknown>]
    expect(job['messageType']).toBe('image')
    expect(job['mediaId']).toBe('media-abc')
    expect(job['mimeType']).toBe('image/jpeg')
    expect(job['content']).toBe('mi receta')
    expect(statusAdd).not.toHaveBeenCalled()
  })

  it('POST with an interactive button reply enqueues the tapped title as content', async () => {
    const buttonReply = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15550001111', phone_number_id: 'PHONE_ID' },
                contacts: [{ profile: { name: 'Ana' }, wa_id: '5215555555555' }],
                messages: [
                  {
                    from: '5215555555555',
                    id: 'wamid.BTN1',
                    timestamp: '1700000400',
                    type: 'interactive',
                    interactive: {
                      type: 'button_reply',
                      button_reply: { id: 'confirm_yes', title: 'Sí, confirmar' },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/webhook/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(buttonReply) },
      payload: buttonReply,
    })
    await flush()

    expect(res.statusCode).toBe(200)
    expect(add).toHaveBeenCalledTimes(1)
    const [, job] = add.mock.calls[0] as [string, Record<string, unknown>]
    expect(job['messageType']).toBe('interactive')
    expect(job['content']).toBe('Sí, confirmar')
    expect(statusAdd).not.toHaveBeenCalled()
  })

  it('POST with an interactive list reply enqueues the chosen row title as content', async () => {
    const listReply = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15550001111', phone_number_id: 'PHONE_ID' },
                contacts: [{ profile: { name: 'Ana' }, wa_id: '5215555555555' }],
                messages: [
                  {
                    from: '5215555555555',
                    id: 'wamid.LIST1',
                    timestamp: '1700000500',
                    type: 'interactive',
                    interactive: {
                      type: 'list_reply',
                      list_reply: {
                        id: 'slot_0900',
                        title: '09:00',
                        description: 'Dr. García',
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/webhook/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(listReply) },
      payload: listReply,
    })
    await flush()

    expect(res.statusCode).toBe(200)
    expect(add).toHaveBeenCalledTimes(1)
    const [, job] = add.mock.calls[0] as [string, Record<string, unknown>]
    expect(job['messageType']).toBe('interactive')
    expect(job['content']).toBe('09:00')
    expect(statusAdd).not.toHaveBeenCalled()
  })

  it('POST with a legacy template quick-reply button enqueues the button text', async () => {
    const buttonPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15550001111', phone_number_id: 'PHONE_ID' },
                contacts: [{ profile: { name: 'Ana' }, wa_id: '5215555555555' }],
                messages: [
                  {
                    from: '5215555555555',
                    id: 'wamid.QR1',
                    timestamp: '1700000600',
                    type: 'button',
                    button: { text: 'Cancelar cita', payload: 'CANCEL_APPT' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/webhook/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(buttonPayload) },
      payload: buttonPayload,
    })
    await flush()

    expect(res.statusCode).toBe(200)
    expect(add).toHaveBeenCalledTimes(1)
    const [, job] = add.mock.calls[0] as [string, Record<string, unknown>]
    expect(job['messageType']).toBe('button')
    expect(job['content']).toBe('Cancelar cita')
    expect(statusAdd).not.toHaveBeenCalled()
  })

  it('POST with a delivery-status receipt enqueues to the status queue', async () => {
    const statusPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15550001111', phone_number_id: 'PHONE_ID' },
                statuses: [
                  {
                    id: 'wamid.OUT1',
                    status: 'delivered',
                    timestamp: '1700000100',
                    recipient_id: '5215555555555',
                  },
                  {
                    id: 'wamid.OUT2',
                    status: 'failed',
                    timestamp: '1700000200',
                    recipient_id: '5215555555555',
                    errors: [{ code: 131047, title: 'Re-engagement message' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    const res = await app.inject({
      method: 'POST',
      url: '/webhook/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(statusPayload) },
      payload: statusPayload,
    })
    await flush()

    expect(res.statusCode).toBe(200)
    // No inbound message in this payload.
    expect(add).not.toHaveBeenCalled()
    expect(statusAdd).toHaveBeenCalledTimes(2)

    const [name, delivered] = statusAdd.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('status')
    expect(delivered['phoneNumberId']).toBe('PHONE_ID')
    expect(delivered['channelMessageId']).toBe('wamid.OUT1')
    expect(delivered['status']).toBe('delivered')
    expect(delivered['recipientId']).toBe('5215555555555')

    const [, failed] = statusAdd.mock.calls[1] as [string, Record<string, unknown>]
    expect(failed['channelMessageId']).toBe('wamid.OUT2')
    expect(failed['status']).toBe('failed')
    expect(failed['errorTitle']).toBe('Re-engagement message')
    expect(failed['errorCode']).toBe(131047)
  })
})
