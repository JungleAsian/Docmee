
import net from 'node:net'
import tls from 'node:tls'

export type EmailDeliveryProvider = 'google' | 'outlook' | 'other'

export interface EmailDeliveryPublicSettings {
  enabled?: boolean
  provider?: EmailDeliveryProvider
  fromName?: string
  fromEmail?: string
  replyTo?: string
  smtpHost?: string
  smtpPort?: number
  smtpSecure?: boolean
  smtpUser?: string
  smtpPasswordSet?: boolean
  notes?: string
  lastTestAt?: string
  lastTestTo?: string
}

export interface EmailDeliveryStoredSettings extends EmailDeliveryPublicSettings {
  smtpPasswordEnc?: string
}

export interface SendEmailInput {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  fromName: string
  fromEmail: string
  replyTo?: string
  to: string
  subject: string
  text: string
}

function readLine(socket: net.Socket | tls.TLSSocket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => cleanup(new Error('SMTP response timed out')), timeoutMs)
    const cleanup = (error?: Error) => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      if (error) reject(error)
      else resolve(buffer)
    }
    const onError = (error: Error) => cleanup(error)
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/).filter(Boolean)
      if (!lines.length) return
      const last = lines[lines.length - 1] ?? ''
      if (/^\d{3} /.test(last)) cleanup()
    }
    socket.on('data', onData)
    socket.on('error', onError)
  })
}

async function expect(socket: net.Socket | tls.TLSSocket, timeoutMs: number, codes: number[]): Promise<string> {
  const response = await readLine(socket, timeoutMs)
  const code = Number(response.slice(0, 3))
  if (!codes.includes(code)) {
    throw new Error(`SMTP rejected command: ${response.replace(/\s+/g, ' ').trim()}`)
  }
  return response
}

function write(socket: net.Socket | tls.TLSSocket, command: string): void {
  socket.write(`${command}\r\n`)
}

function connectPlain(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('SMTP connection timed out'))
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function connectTls(host: string, port: number, timeoutMs: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('SMTP TLS connection timed out'))
    }, timeoutMs)
    socket.once('secureConnect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function upgradeToTls(socket: net.Socket, host: string, timeoutMs: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host })
    const timer = setTimeout(() => {
      secureSocket.destroy()
      reject(new Error('SMTP STARTTLS timed out'))
    }, timeoutMs)
    secureSocket.once('secureConnect', () => {
      clearTimeout(timer)
      resolve(secureSocket)
    })
    secureSocket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function encodedSubject(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function mailbox(name: string, email: string): string {
  const safeName = headerValue(name).replace(/"/g, '\\"')
  return safeName ? `"${safeName}" <${email}>` : `<${email}>`
}

function dotEscape(body: string): string {
  return body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')
}

export async function sendSmtpEmail(input: SendEmailInput): Promise<void> {
  const timeoutMs = 20_000
  let socket: net.Socket | tls.TLSSocket | null = input.secure
    ? await connectTls(input.host, input.port, timeoutMs)
    : await connectPlain(input.host, input.port, timeoutMs)

  try {
    await expect(socket, timeoutMs, [220])
    write(socket, 'EHLO docmee.local')
    await expect(socket, timeoutMs, [250])

    if (!input.secure) {
      write(socket, 'STARTTLS')
      await expect(socket, timeoutMs, [220])
      socket = await upgradeToTls(socket as net.Socket, input.host, timeoutMs)
      write(socket, 'EHLO docmee.local')
      await expect(socket, timeoutMs, [250])
    }

    write(socket, 'AUTH LOGIN')
    await expect(socket, timeoutMs, [334])
    write(socket, Buffer.from(input.username, 'utf8').toString('base64'))
    await expect(socket, timeoutMs, [334])
    write(socket, Buffer.from(input.password, 'utf8').toString('base64'))
    await expect(socket, timeoutMs, [235])

    write(socket, `MAIL FROM:<${input.fromEmail}>`)
    await expect(socket, timeoutMs, [250])
    write(socket, `RCPT TO:<${input.to}>`)
    await expect(socket, timeoutMs, [250, 251])
    write(socket, 'DATA')
    await expect(socket, timeoutMs, [354])

    const headers = [
      `From: ${mailbox(input.fromName, input.fromEmail)}`,
      `To: <${input.to}>`,
      `Subject: ${encodedSubject(input.subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      input.replyTo ? `Reply-To: <${input.replyTo}>` : null,
    ].filter(Boolean)
    socket.write(`${headers.join('\r\n')}\r\n\r\n${dotEscape(input.text)}\r\n.\r\n`)
    await expect(socket, timeoutMs, [250])
    write(socket, 'QUIT')
  } finally {
    socket?.end()
  }
}

export function providerDefaults(provider: EmailDeliveryProvider): Pick<EmailDeliveryStoredSettings, 'smtpHost' | 'smtpPort' | 'smtpSecure'> {
  if (provider === 'google') return { smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpSecure: false }
  if (provider === 'outlook') return { smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false }
  return { smtpHost: '', smtpPort: 587, smtpSecure: false }
}

export function publicEmailSettings(settings: EmailDeliveryStoredSettings | undefined): EmailDeliveryPublicSettings {
  if (!settings) return {}
  const { smtpPasswordEnc, ...rest } = settings
  return { ...rest, smtpPasswordSet: Boolean(smtpPasswordEnc || rest.smtpPasswordSet) }
}
