'use client'

import { usePathname } from 'next/navigation'
import type { ComponentType } from 'react'
import {
  BellRinging,
  Buildings,
  CalendarBlank,
  ChartLineUp,
  ChatsCircle,
  ClipboardText,
  CurrencyDollar,
  FirstAidKit,
  GearSix,
  Lifebuoy,
  ListChecks,
  Pulse,
  ShieldCheck,
  Stethoscope,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react'

type HeaderIcon = ComponentType<{ size?: number; className?: string }>

type BannerCopy = {
  title: string
  subtitle?: string
  icon: HeaderIcon
}

const ROUTE_COPY: Array<[RegExp, BannerCopy]> = [
  [/^\/help\//, {
    title: 'Help guides',
    subtitle: 'Support content for Docmee screens, workflows, and setup.',
    icon: Lifebuoy,
  }],
  [/^\/inbox/, {
    title: 'InboxOS',
    subtitle: 'WhatsApp conversations, notes, assignments, and Docmee assistance.',
    icon: ChatsCircle,
  }],
  [/^\/alerts/, {
    title: 'Alerts center',
    subtitle: 'Unread, urgent, important, and standard clinic notifications.',
    icon: BellRinging,
  }],
  [/^\/calendar/, {
    title: 'Calendar and bookings',
    subtitle: 'Availability, appointments, cancellations, and booking revisions.',
    icon: CalendarBlank,
  }],
  [/^\/waitlist/, {
    title: 'Waitlist',
    subtitle: 'Patients waiting for earlier slots and follow-up actions.',
    icon: ListChecks,
  }],
  [/^\/analytics/, {
    title: 'Analytics',
    icon: ChartLineUp,
  }],
  [/^\/qos/, {
    title: 'Quality monitoring',
    subtitle: 'Abandoned conversations, delayed responses, escalations, and service risks.',
    icon: Pulse,
  }],
  [/^\/reports/, {
    title: 'Operational reports',
    subtitle: 'Scheduled summaries, delivery status, and performance snapshots.',
    icon: ClipboardText,
  }],
  [/^\/studio\/channels/, {
    title: 'Channels and integrations',
    subtitle: 'Messaging, calendar, email, automation, storage, and AI providers.',
    icon: GearSix,
  }],
  [/^\/studio\/integrations/, {
    title: 'Channels and integrations',
    subtitle: 'Provider accounts, webhooks, and delivery services.',
    icon: GearSix,
  }],
  [/^\/studio\/users/, {
    title: 'Users and access',
    subtitle: 'Roles, permissions, side rail visibility, alerts, and account access.',
    icon: UsersThree,
  }],
  [/^\/studio\/doctors/, {
    title: 'Doctors and availability',
    subtitle: 'Doctors, working hours, booking rules, and calendar readiness.',
    icon: Stethoscope,
  }],
  [/^\/studio\/quick-replies/, {
    title: 'Quick replies',
    subtitle: 'Approved in-window responses for patient conversations.',
    icon: ChatsCircle,
  }],
  [/^\/studio\/templates/, {
    title: 'WhatsApp templates',
    subtitle: 'Appointment, reminder, handoff, and review templates for Meta approval.',
    icon: ClipboardText,
  }],
  [/^\/studio\/automations/, {
    title: 'Automations',
    subtitle: 'No-code automation rules for clinic operations.',
    icon: ListChecks,
  }],
  [/^\/studio\/custom-flows/, {
    title: 'Custom flows',
    subtitle: 'Conversation logic, escalation behavior, and clinic-specific flow rules.',
    icon: Pulse,
  }],
  [/^\/studio\/workflows/, {
    title: 'Workflow builder',
    subtitle: 'Trigger, condition, and action workflows.',
    icon: ListChecks,
  }],
  [/^\/studio\/kb/, {
    title: 'Clinic knowledge base',
    subtitle: 'Approved clinic knowledge and help content.',
    icon: ClipboardText,
  }],
  [/^\/studio\/cost-monitoring/, {
    title: 'Cost monitoring',
    subtitle: 'AI, WhatsApp, and clinic usage costs.',
    icon: CurrencyDollar,
  }],
  [/^\/studio\/license/, {
    title: 'License management',
    subtitle: 'Licensing, access limits, renewals, and activation status.',
    icon: ShieldCheck,
  }],
  [/^\/studio\/compliance/, {
    title: 'Compliance',
    subtitle: 'Policy, safety, and audit requirements.',
    icon: ShieldCheck,
  }],
  [/^\/studio\/governance/, {
    title: 'Governance',
    subtitle: 'Platform guardrails, oversight, and operational controls.',
    icon: ShieldCheck,
  }],
  [/^\/studio\/credential-health/, {
    title: 'Credential health',
    subtitle: 'Provider keys, tokens, webhooks, and integrations.',
    icon: FirstAidKit,
  }],
  [/^\/studio\/errors/, {
    title: 'Error monitoring',
    subtitle: 'Configuration, provider, webhook, and runtime problems.',
    icon: WarningCircle,
  }],
  [/^\/studio\/audit/, {
    title: 'Audit review',
    subtitle: 'Implementation checks, design alignment, and release confidence.',
    icon: ClipboardText,
  }],
  [/^\/studio\/clinics/, {
    title: 'Clinic management',
    subtitle: 'Clinic profiles, configuration, and readiness status.',
    icon: Buildings,
  }],
  [/^\/studio$/, {
    title: 'Clinic command center',
    subtitle: 'Clinics, setup progress, readiness, and admin work.',
    icon: GearSix,
  }],
]

function copyForPath(pathname: string): BannerCopy | null {
  if (pathname === '/help') return null
  return ROUTE_COPY.find(([pattern]) => pattern.test(pathname))?.[1] ?? null
}

export function PageMascotBanner() {
  const pathname = usePathname()
  const copy = copyForPath(pathname)
  if (!copy) return null

  const Icon = copy.icon

  return (
    <section className="docmee-page-hero">
      <div className="docmee-page-hero-copy">
        <div className="docmee-page-hero-title-row">
          <span className="docmee-page-hero-icon" aria-hidden>
            <Icon size={18} />
          </span>
          <h1>{copy.title}</h1>
        </div>
        {copy.subtitle ? <p>{copy.subtitle}</p> : null}
      </div>
    </section>
  )
}
