'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarBlank,
  ChatCircleDots,
  GearSix,
  Lifebuoy,
  Megaphone,
  Sparkle,
  Users,
  X,
  type Icon,
} from '@phosphor-icons/react'
import { useAuthStore } from '@/shared/store/auth'
import type { PanelLanguage, PanelRole } from '@/shared/types'

const STORAGE_VERSION = 'v1'
const OPEN_EVENT = 'docmee:tutorial-open'

type TutorialStep = {
  icon: Icon
  href?: string
  title: Record<PanelLanguage, string>
  body: Record<PanelLanguage, string>
  cta?: Record<PanelLanguage, string>
}

const copy = {
  intro: {
    es: 'Recorrido de Docmee',
    en: 'Docmee walkthrough',
  },
  subtitle: {
    es: 'Una guía rápida para entender dónde vive cada flujo importante.',
    en: 'A quick guide to where the important workflows live.',
  },
  later: { es: 'Omitir', en: 'Skip' },
  back: { es: 'Atrás', en: 'Back' },
  next: { es: 'Siguiente', en: 'Next' },
  finish: { es: 'Finalizar', en: 'Finish' },
  open: { es: 'Abrir esta página', en: 'Open this page' },
  replayHint: {
    es: 'Puedes repetir este recorrido desde el botón Tutorial en el menú lateral.',
    en: 'You can replay this walkthrough from the Tutorial button in the side rail.',
  },
} satisfies Record<string, Record<PanelLanguage, string>>

function stepSet(role: PanelRole | undefined): TutorialStep[] {
  const isAdmin = role === 'ia_studio_admin' || role === 'clinic_admin'
  const isSuperuser = role === 'ia_studio_admin'

  const steps: TutorialStep[] = [
    {
      icon: ChatCircleDots,
      href: '/inbox',
      title: { es: 'Bandeja de conversaciones', en: 'Conversation inbox' },
      body: {
        es: 'Aquí respondes pacientes, revisas mensajes abiertos, asignaciones, etiquetas y el historial de cada conversación.',
        en: 'This is where you answer patients, review open messages, assignments, tags, and each conversation history.',
      },
      cta: { es: 'Ir a Bandeja', en: 'Go to Inbox' },
    },
    {
      icon: Sparkle,
      title: { es: 'J.zel, tu asistente', en: 'J.zel, your assistant' },
      body: {
        es: 'El avatar flotante ayuda con dudas de uso, triage, agenda y operaciones. Puedes moverlo, redimensionarlo o abrirlo cuando necesites ayuda.',
        en: 'The floating avatar helps with usage questions, triage, scheduling, and operations. You can move, resize, or open it when you need help.',
      },
    },
    {
      icon: CalendarBlank,
      href: '/calendar',
      title: { es: 'Agenda y reservas', en: 'Calendar and bookings' },
      body: {
        es: 'La agenda muestra citas, disponibilidad, estados y cambios. Úsala para confirmar, reprogramar o revisar el flujo del día.',
        en: 'The calendar shows appointments, availability, status, and changes. Use it to confirm, reschedule, or review the day flow.',
      },
      cta: { es: 'Ver Agenda', en: 'View Calendar' },
    },
    {
      icon: Lifebuoy,
      href: '/help',
      title: { es: 'Centro de ayuda', en: 'Help Center' },
      body: {
        es: 'La ayuda explica pantallas, tareas frecuentes y solución de problemas. Es el primer lugar para guiar usuarios nuevos.',
        en: 'Help explains screens, common tasks, and troubleshooting. It is the first place to guide new users.',
      },
      cta: { es: 'Abrir Ayuda', en: 'Open Help' },
    },
  ]

  if (isAdmin) {
    steps.splice(3, 0, {
      icon: Megaphone,
      href: '/studio/channels',
      title: { es: 'Canales e integraciones', en: 'Channels and integrations' },
      body: {
        es: 'Configura WhatsApp, correo, calendario, Google Drive, n8n y otros servicios de la clínica desde tarjetas desplegables.',
        en: 'Configure WhatsApp, email, calendar, Google Drive, n8n, and other clinic services from expandable cards.',
      },
      cta: { es: 'Ver Canales', en: 'View Channels' },
    })
    steps.splice(4, 0, {
      icon: Users,
      href: '/studio/users',
      title: { es: 'Usuarios y permisos', en: 'Users and permissions' },
      body: {
        es: 'Administra usuarios, roles, alertas y acceso al menú. Los cambios deben mantener a cada persona dentro de su clínica y función.',
        en: 'Manage users, roles, alerts, and menu access. Changes should keep each person within their clinic and responsibilities.',
      },
      cta: { es: 'Ver Usuarios', en: 'View Users' },
    })
  }

  if (isSuperuser) {
    steps.splice(5, 0, {
      icon: BookOpen,
      href: '/studio/kb',
      title: { es: 'KB de la clínica', en: 'Clinic KB' },
      body: {
        es: 'La base de conocimiento alimenta respuestas, ayuda y entrenamiento. Solo superusuarios deben administrar fuentes y sincronización.',
        en: 'The knowledge base powers answers, help, and training. Only super users should manage sources and sync.',
      },
      cta: { es: 'Abrir KB', en: 'Open KB' },
    })
  }

  if (isAdmin) {
    steps.push({
      icon: GearSix,
      href: '/studio',
      title: { es: 'Admin Studio', en: 'Admin Studio' },
      body: {
        es: 'Admin Studio centraliza configuración clínica, canales, automatizaciones, cumplimiento, uso y salud de credenciales.',
        en: 'Admin Studio centralizes clinic setup, channels, automations, compliance, usage, and credential health.',
      },
      cta: { es: 'Abrir Studio', en: 'Open Studio' },
    })
  }

  return steps
}

export function InAppTutorial() {
  const pathname = usePathname()
  const user = useAuthStore((s) => s.user)
  const language = useAuthStore((s) => s.language) as PanelLanguage
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const lang = language ?? 'es'

  const storageKey = user ? `docmee.tutorial.${STORAGE_VERSION}:${user.id}` : null
  const steps = useMemo(() => stepSet(user?.role), [user?.role])
  const active = steps[Math.min(step, steps.length - 1)]
  const Icon = active?.icon

  useEffect(() => {
    if (!storageKey || pathname === '/login') return
    const openTour = () => {
      setStep(0)
      setOpen(true)
    }
    window.addEventListener(OPEN_EVENT, openTour)
    try {
      if (!localStorage.getItem(storageKey)) {
        window.setTimeout(openTour, 700)
      }
    } catch {
      window.setTimeout(openTour, 700)
    }
    return () => window.removeEventListener(OPEN_EVENT, openTour)
  }, [pathname, storageKey])

  const close = (done = true) => {
    if (done && storageKey) {
      try {
        localStorage.setItem(storageKey, new Date().toISOString())
      } catch {
        // Non-critical: the walkthrough can safely appear again if storage is unavailable.
      }
    }
    setOpen(false)
  }

  if (!open || !active || !Icon) return null

  const isLast = step >= steps.length - 1

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/58 px-4 py-6 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="docmee-tutorial-title"
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] text-[var(--crm-text-main)] shadow-2xl"
      >
        <button
          type="button"
          onClick={() => close(true)}
          aria-label={copy.later[lang]}
          className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] text-[var(--crm-text-muted)] hover:text-[var(--crm-text-main)]"
        >
          <X size={18} />
        </button>

        <div className="relative min-h-36 overflow-hidden bg-gradient-to-br from-cyan-500/20 via-[var(--crm-card-bg)] to-cyan-500/20 p-6">
          <div className="absolute -right-12 -top-20 h-44 w-44 rounded-full bg-cyan-400/20 blur-2xl" />
          <div className="relative flex items-center gap-4 pr-12">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-cyan-500/14 text-cyan-300 ring-1 ring-cyan-300/30">
              <Icon size={30} weight="duotone" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-cyan-300">{copy.intro[lang]}</p>
              <h2 id="docmee-tutorial-title" className="mt-1 text-2xl font-bold">
                {active.title[lang]}
              </h2>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <p className="text-base leading-7 text-[var(--crm-text-muted)]">{active.body[lang]}</p>
          <p className="rounded-xl border border-[var(--crm-border-color)] bg-[var(--crm-input-bg)] px-4 py-3 text-sm text-[var(--crm-text-muted)]">
            {step === 0 ? copy.subtitle[lang] : copy.replayHint[lang]}
          </p>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              {steps.map((item, index) => (
                <button
                  type="button"
                  key={item.title.en}
                  aria-label={`${index + 1}`}
                  onClick={() => setStep(index)}
                  className={`h-2.5 rounded-full transition-all ${
                    index === step ? 'w-8 bg-cyan-400' : 'w-2.5 bg-[var(--crm-border-color)]'
                  }`}
                />
              ))}
            </div>
            <span className="text-xs font-semibold text-[var(--crm-text-muted)]">
              {step + 1} / {steps.length}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {active.href ? (
              <Link
                href={active.href}
                onClick={() => close(true)}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-500/12 px-4 text-sm font-bold text-cyan-300 hover:bg-cyan-500/18"
              >
                {active.cta?.[lang] ?? copy.open[lang]}
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => close(true)}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--crm-border-color)] px-4 text-sm font-bold text-[var(--crm-text-muted)] hover:text-[var(--crm-text-main)]"
            >
              {copy.later[lang]}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                disabled={step === 0}
                onClick={() => setStep((value) => Math.max(0, value - 1))}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--crm-border-color)] px-4 text-sm font-bold text-[var(--crm-text-muted)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowLeft size={16} />
                {copy.back[lang]}
              </button>
              <button
                type="button"
                onClick={() => (isLast ? close(true) : setStep((value) => value + 1))}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-cyan-600 px-5 text-sm font-bold text-white shadow-lg shadow-cyan-950/20 hover:bg-cyan-500"
              >
                {isLast ? copy.finish[lang] : copy.next[lang]}
                {!isLast ? <ArrowRight size={16} /> : null}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
