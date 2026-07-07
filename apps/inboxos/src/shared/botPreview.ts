// Screen 8 (Bot tone & clinic rules) — pure data + helpers for the live tone
// PREVIEW and the non-removable SAFETY RULE list.
//
// The preview shows a sample patient/bot exchange so an admin can feel how the
// selected tone reads BEFORE saving. The sample is keyed by the bot's configured
// language (not the panel language), because the bot can be forced to ES/EN
// independently of the operator's UI; on 'auto' the caller previews in the panel
// language and notes that the bot mirrors the patient.
//
// Every sample reply deliberately routes to booking and never gives medical
// advice — the preview itself reinforces the safety posture below.
import type { BotTone } from './types'

export type PreviewLanguage = 'es' | 'en'

export interface TonePreview {
  patient: string
  bot: string
}

const SAMPLES: Record<PreviewLanguage, { patient: string; bot: Record<BotTone, string> }> = {
  es: {
    patient: '¿Atienden hoy? Me duele la garganta.',
    bot: {
      professional:
        'Buenas tardes. Sí, atendemos hoy hasta las 18:00. ¿Desea que le agende una cita de valoración?',
      friendly:
        '¡Hola! 😊 Claro que sí, hoy estamos hasta las 18:00. ¿Te busco un hueco para que te revisen?',
      brief: 'Sí, abrimos hasta las 18:00. ¿Le agendo una cita?',
    },
  },
  en: {
    patient: 'Are you open today? My throat hurts.',
    bot: {
      professional:
        'Good afternoon. Yes, we’re open today until 6:00 pm. Would you like me to schedule an assessment?',
      friendly: 'Hi! 😊 Yes, we’re open today until 6 pm. Want me to find you a slot to get that checked?',
      brief: 'Yes, open until 6 pm. Shall I book you in?',
    },
  },
}

export function tonePreview(tone: BotTone, language: PreviewLanguage): TonePreview {
  const pack = SAMPLES[language]
  return { patient: pack.patient, bot: pack.bot[tone] }
}

// The non-removable safety rules, mirroring what the agents layer actually enforces
// (clinic-bot system prompt + the outbound medical-safety screen in
// packages/agents/.../medical-safety.ts). These are presented read-only: they apply
// on top of any clinic rules and cannot be edited or removed from the panel. The
// values are i18n keys, resolved by the caller in the panel language.
export const SAFETY_RULE_KEYS = [
  'bot.safety.diagnosis',
  'bot.safety.medication',
  'bot.safety.emergency',
  'bot.safety.handoff',
] as const

export type SafetyRuleKey = (typeof SAFETY_RULE_KEYS)[number]
