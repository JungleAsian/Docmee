import { Client, EmbedBuilder, GatewayIntentBits } from 'discord.js'
import { loadConfig } from '../../cli/src/lib/config.js'
import { readJson, writeJson } from '../../cli/src/lib/json-store.js'

let client: Client | null = null

export type DiscordNotificationType = 'critical' | 'development' | 'approval' | 'stack'
type DiscordMessageLog = {
  timestamp: string
  source: DiscordNotificationType
  channelId?: string
  english: string
  spanish: string
  status: 'sent' | 'failed'
}

const channelEnvByType: Record<DiscordNotificationType, string> = {
  critical: 'DISCORD_CRITICAL_CHANNEL_ID',
  development: 'DISCORD_UPDATE_CHANNEL_ID',
  approval: 'DISCORD_APPROVAL_CHANNEL_ID',
  stack: 'DISCORD_STACK_CHANNEL_ID'
}

const labelByType: Record<DiscordNotificationType, string> = {
  critical: 'Critical/Important',
  development: 'Development Update',
  approval: 'Approval',
  stack: 'Stack Intelligence'
}

const spanishLabelByType: Record<DiscordNotificationType, string> = {
  critical: 'Critico/Importante',
  development: 'Actualizacion de desarrollo',
  approval: 'Aprobacion',
  stack: 'Inteligencia del stack'
}

export async function getDiscordClient() {
  loadConfig()
  const botToken = process.env.DISCORD_MESSAGING_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN
  if (!botToken) return null
  if (client?.isReady()) return client
  client = new Client({ intents: [GatewayIntentBits.Guilds] })
  await client.login(botToken)
  return client
}

export async function closeDiscordClient() {
  if (!client) return
  client.destroy()
  client = null
}

function channelIdForType(type: DiscordNotificationType) {
  return process.env[channelEnvByType[type]] || process.env.DISCORD_CHANNEL_ID
}

function translateLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return line

  const exact: Record<string, string> = {
    'Automated build complete': 'Compilacion automatizada completada',
    'Automated build watcher starting': 'Monitor de compilacion automatizada iniciado',
    'Claude limit refreshed; resuming build': 'El limite de Claude se actualizo; reanudando la compilacion',
    'Claude limit refreshed; resuming automatically': 'El limite de Claude se actualizo; DevTools reanudara automaticamente',
    'Claude session limit reached': 'Se alcanzo el limite de sesion de Claude',
    'Docmee application is ready for local checking.': 'La aplicacion Docmee esta lista para revision local.',
    'App URL: http://127.0.0.1:3000': 'URL de la aplicacion: http://127.0.0.1:3000',
    'API Health: http://127.0.0.1:3001/health': 'Estado de la API: http://127.0.0.1:3001/health',
    'Demo login email: admin@demo-a.test': 'Correo demo: admin@demo-a.test',
    'Demo password: demo1234': 'Contrasena demo: demo1234',
    'Post-deployment functionality check completed.': 'Comprobacion de funcionalidades post-despliegue completada.',
    'Findings:': 'Hallazgos:',
    'Note: This is local to the DevTools computer. Use VPS/domain after deployment for external access.': 'Nota: Esto es local en la computadora de DevTools. Usa el VPS/dominio despues del despliegue para acceso externo.',
    'DevTools Ready - start automated build from /build-control.': 'DevTools esta listo: inicia la compilacion automatizada desde /build-control.',
    'Submit to Meta for WhatsApp approval now. Do not wait for P19.': 'Envia ahora a Meta para la aprobacion de WhatsApp. No esperes hasta P19.'
  }
  if (exact[trimmed]) return exact[trimmed]

  const patterns: Array<[RegExp, (...match: string[]) => string]> = [
    [/^Docmee DevTools test notification - (.+)$/i, (_full, date) => `Notificacion de prueba de Docmee DevTools - ${date}`],
    [/^Cost alert - Daily spend \$(.+) exceeded threshold \$(.+)$/i, (_full, spend, threshold) => `Alerta de costo: el gasto diario $${spend} supero el limite $${threshold}`],
    [/^Gate (.+) passed - (.+)$/i, (_full, gate, phase) => `Control ${gate} aprobado - ${phase}`],
    [/^Gate (.+) FAILED - (.+)$/i, (_full, gate, phase) => `Control ${gate} FALLO - ${phase}`],
    [/^Phase (.+) complete - (.+)$/i, (_full, phase, name) => `Fase ${phase} completada - ${name}`],
    [/^(P\d+) Claude Code build started\.$/i, (_full, phase) => `${phase} compilacion con Claude Code iniciada.`],
    [/^(P\d+) Claude Code build starting$/i, (_full, phase) => `${phase} iniciando compilacion con Claude Code`],
    [/^(P\d+) Claude Code is working$/i, (_full, phase) => `${phase} Claude Code esta trabajando`],
    [/^(P\d+) Claude Code process finished$/i, (_full, phase) => `${phase} proceso de Claude Code finalizado`],
    [/^(P\d+) Claude Code failed: (.+)\. Fix Claude Code, then resume from (P\d+)\.$/i, (_full, phase, failure, resume) => `${phase} Claude Code fallo: ${failure}. Corrige Claude Code y luego reanuda desde ${resume}.`],
    [/^(P\d+) gates failed after Claude Code build\.$/i, (_full, phase) => `${phase} los controles fallaron despues de la compilacion con Claude Code.`],
    [/^(P\d+) gates failed after output copied\.$/i, (_full, phase) => `${phase} los controles fallaron despues de copiar el resultado.`],
    [/^(P\d+) git status failed\. Build stopped before marking phase done\.$/i, (_full, phase) => `${phase} fallo la revision de estado de Git. La compilacion se detuvo antes de marcar la fase como terminada.`],
    [/^(P\d+) git add failed\. Build stopped before marking phase done\.$/i, (_full, phase) => `${phase} fallo al preparar cambios en Git. La compilacion se detuvo antes de marcar la fase como terminada.`],
    [/^(P\d+) git commit failed\. Build stopped before marking phase done\.$/i, (_full, phase) => `${phase} fallo el commit de Git. La compilacion se detuvo antes de marcar la fase como terminada.`],
    [/^(P\d+) git push failed for origin (.+)\. Build stopped before marking phase done\.$/i, (_full, phase, branch) => `${phase} fallo el envio a GitHub para origin ${branch}. La compilacion se detuvo antes de marcar la fase como terminada.`],
    [/^(P\d+) pushed to GitHub - commit (.+)$/i, (_full, phase, hash) => `${phase} enviado a GitHub - commit ${hash}`],
    [/^(P\d+) complete; advancing to next phase$/i, (_full, phase) => `${phase} completada; avanzando a la siguiente fase`],
    [/^(P\d+) complete$/i, (_full, phase) => `${phase} completada`],
    [/^(P\d+) paused: (.+)\. Resume at (.+)$/i, (_full, phase, reason, resumeAt) => `${phase} en pausa: ${translateLine(reason)}. Reanuda en ${resumeAt}`],
    [/^(P\d+) Claude limit refreshed\. DevTools is resuming automatically\.$/i, (_full, phase) => `${phase} el limite de Claude se actualizo. DevTools se esta reanudando automaticamente.`],
    [/^Claude usage is (.+)%, at or above the (.+)% pause guard$/i, (_full, usage, threshold) => `El uso de Claude esta en ${usage}%, igual o por encima del limite preventivo de ${threshold}%`],
    [/^Ready Check passed\. Claude Pro, Notion, GitHub, prompts, and Discord are usable\.$/i, () => 'La verificacion Ready Check aprobo. Claude Pro, Notion, GitHub, prompts y Discord estan disponibles.'],
    [/^DevTools NOT Ready - (.+) critical issue\(s\)\.$/i, (_full, count) => `DevTools NO esta listo - ${count} problema(s) critico(s).`],
    [/^Result: (.+) passed, (.+) warnings, (.+) issues\.$/i, (_full, pass, warnings, issues) => `Resultado: ${pass} aprobados, ${warnings} advertencias, ${issues} problemas.`],
    [/^Run time: (.+)$/i, (_full, time) => `Hora de ejecucion: ${time}`],
    [/^- PASS: (.+) - (.+)$/i, (_full, name, message) => `- APROBADO: ${name} - ${translateLine(message)}`],
    [/^- WARNING: (.+) - (.+)$/i, (_full, name, message) => `- ADVERTENCIA: ${name} - ${translateLine(message)}`],
    [/^- ISSUE: (.+) - (.+)$/i, (_full, name, message) => `- PROBLEMA: ${name} - ${translateLine(message)}`]
  ]

  for (const [pattern, translate] of patterns) {
    const match = trimmed.match(pattern)
    if (match) return translate(...match)
  }

  return trimmed
}

function translateToSpanish(message: string) {
  const lines = message.split(/\r?\n/)
  let inCodeBlock = false
  return lines.map((line) => {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      return line
    }
    return inCodeBlock ? line : translateLine(line)
  }).join('\n')
}

function bilingualContent(message: string, type: DiscordNotificationType) {
  return [
    `**${labelByType[type]}**`,
    message
  ].join('\n')
}

function spanishEmbed(message: string, type: DiscordNotificationType) {
  return new EmbedBuilder()
    .setTitle(spanishLabelByType[type])
    .setDescription(translateToSpanish(message).slice(0, 4096))
    .setColor(0x22c55e)
}

function appendDiscordMessageLog(entry: DiscordMessageLog) {
  const rows = readJson<DiscordMessageLog[]>('discord-messages.json', [])
  rows.push(entry)
  writeJson('discord-messages.json', rows.slice(-1000))
}

export async function sendNotification(message: string, type: DiscordNotificationType = 'development') {
  const spanish = translateToSpanish(message)
  let channelId: string | undefined
  try {
    const activeClient = await getDiscordClient()
    channelId = channelIdForType(type)
    if (!activeClient || !channelId) {
      appendDiscordMessageLog({ timestamp: new Date().toISOString(), source: type, channelId, english: message, spanish, status: 'failed' })
      return false
    }
    const channel = await activeClient.channels.fetch(channelId)
    if (!channel?.isTextBased() || !('send' in channel)) {
      appendDiscordMessageLog({ timestamp: new Date().toISOString(), source: type, channelId, english: message, spanish, status: 'failed' })
      return false
    }
    await channel.send({
      content: bilingualContent(message, type),
      embeds: [spanishEmbed(message, type)]
    })
    appendDiscordMessageLog({ timestamp: new Date().toISOString(), source: type, channelId, english: message, spanish, status: 'sent' })
    return true
  } catch {
    // DevTools notifications must never block local commands.
    appendDiscordMessageLog({ timestamp: new Date().toISOString(), source: type, channelId, english: message, spanish, status: 'failed' })
    return false
  }
}
