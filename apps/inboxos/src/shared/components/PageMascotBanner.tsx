'use client'

import { usePathname } from 'next/navigation'
import type { CSSProperties } from 'react'

type BannerAsset =
  | 'bowing'
  | 'clipboardPose'
  | 'clipboard'
  | 'confused'
  | 'crossedArms'
  | 'firstAid'
  | 'heart'
  | 'idea'
  | 'laptop'
  | 'pill'
  | 'syringe'
  | 'thumbsUpPose'
  | 'thumbsUp'
  | 'wavingPose'
  | 'waving'
  | 'phoneDark'
  | 'wordmarkWide'
  | 'wordmarkTools'
  | 'hologram'
  | 'kbCrossedArms'
  | 'analytics'

type BannerCopy = {
  eyebrow: string
  title: string
  body: string
  asset: BannerAsset
}

const ASSET_SRC: Record<BannerAsset, string> = {
  bowing: '/mascot-banners/bowing',
  clipboardPose: '/mascot-banners/clipboard-pose',
  clipboard: '/mascot-banners/clipboard',
  confused: '/mascot-banners/confused',
  crossedArms: '/mascot-banners/crossed-arms',
  firstAid: '/mascot-banners/first-aid',
  heart: '/mascot-banners/heart',
  idea: '/mascot-banners/idea',
  laptop: '/mascot-banners/laptop',
  pill: '/mascot-banners/pill',
  syringe: '/mascot-banners/syringe',
  thumbsUpPose: '/mascot-banners/thumbs-up-pose',
  thumbsUp: '/mascot-banners/thumbs-up',
  wavingPose: '/mascot-banners/waving-pose',
  waving: '/mascot-banners/waving',
  phoneDark: '/mascot-banners/phone-dark',
  wordmarkWide: '/mascot-banners/wordmark-wide',
  wordmarkTools: '/mascot-banners/wordmark-tools',
  hologram: '/mascot-banners/hologram',
  kbCrossedArms: '/mascot-banners/kb-crossed-arms',
  analytics: '/mascot-banners/analytics',
}

const ROUTE_COPY: Array<[RegExp, BannerCopy]> = [
  [/^\/help\//, {
    eyebrow: 'Docmee support',
    title: 'Help guides',
    body: 'Find clear support content for Docmee screens, workflows, setup, and clinic operations.',
    asset: 'hologram',
  }],
  [/^\/inbox/, {
    eyebrow: 'Patient conversations',
    title: 'InboxOS',
    body: 'Manage WhatsApp, internal notes, assignments, and Docmee assistance from one focused workspace.',
    asset: 'phoneDark',
  }],
  [/^\/alerts/, {
    eyebrow: 'Clinic signals',
    title: 'Alerts center',
    body: 'Review unread, urgent, important, and standard notifications before they interrupt clinic flow.',
    asset: 'analytics',
  }],
  [/^\/calendar/, {
    eyebrow: 'Scheduling',
    title: 'Calendar and bookings',
    body: 'Coordinate availability, appointments, cancellations, and booking revisions with clinic context.',
    asset: 'clipboardPose',
  }],
  [/^\/waitlist/, {
    eyebrow: 'Scheduling',
    title: 'Waitlist',
    body: 'Track patients waiting for earlier slots and keep follow-up actions visible.',
    asset: 'clipboardPose',
  }],
  [/^\/analytics/, {
    eyebrow: 'Insights',
    title: 'Analytics',
    body: 'See demand, automation performance, patient trends, and operational metrics in one view.',
    asset: 'analytics',
  }],
  [/^\/qos/, {
    eyebrow: 'Service quality',
    title: 'Quality monitoring',
    body: 'Spot abandoned conversations, delayed responses, escalations, and other service risks quickly.',
    asset: 'hologram',
  }],
  [/^\/reports/, {
    eyebrow: 'Reports',
    title: 'Operational reports',
    body: 'Review scheduled summaries, delivery status, and clinic performance snapshots.',
    asset: 'clipboardPose',
  }],
  [/^\/studio\/channels/, {
    eyebrow: 'Admin Studio',
    title: 'Channels and integrations',
    body: 'Connect messaging, calendar, email, automation, storage, and AI providers with guided setup cards.',
    asset: 'hologram',
  }],
  [/^\/studio\/integrations/, {
    eyebrow: 'Admin Studio',
    title: 'Channels and integrations',
    body: 'Connect clinic tools, provider accounts, webhooks, and delivery services from one guided workspace.',
    asset: 'hologram',
  }],
  [/^\/studio\/users/, {
    eyebrow: 'Admin Studio',
    title: 'Users and access',
    body: 'Set user roles, permissions, side rail visibility, alerts, and account access in a no-code flow.',
    asset: 'thumbsUpPose',
  }],
  [/^\/studio\/doctors/, {
    eyebrow: 'Admin Studio',
    title: 'Doctors and availability',
    body: 'Configure doctors, working hours, booking rules, and calendar readiness for each clinic.',
    asset: 'clipboardPose',
  }],
  [/^\/studio\/quick-replies/, {
    eyebrow: 'Admin Studio',
    title: 'Quick replies',
    body: 'Keep approved in-window responses easy to find, update, and reuse during patient conversations.',
    asset: 'thumbsUpPose',
  }],
  [/^\/studio\/templates/, {
    eyebrow: 'Admin Studio',
    title: 'WhatsApp templates',
    body: 'Prepare patient-safe appointment, reminder, handoff, and review templates for Meta approval.',
    asset: 'hologram',
  }],
  [/^\/studio\/automations/, {
    eyebrow: 'Admin Studio',
    title: 'Automations',
    body: 'Create no-code automation rules that keep clinic operations moving without custom code.',
    asset: 'thumbsUpPose',
  }],
  [/^\/studio\/custom-flows/, {
    eyebrow: 'Admin Studio',
    title: 'Custom flows',
    body: 'Shape Docmee conversation logic, escalation behavior, and clinic-specific flow rules visually.',
    asset: 'hologram',
  }],
  [/^\/studio\/workflows/, {
    eyebrow: 'Admin Studio',
    title: 'Workflow builder',
    body: 'Design trigger, condition, and action workflows for repeatable clinic operations.',
    asset: 'analytics',
  }],
  [/^\/studio\/kb/, {
    eyebrow: 'Admin Studio',
    title: 'Clinic knowledge base',
    body: 'Train Docmee with approved clinic knowledge and keep help content grounded and current.',
    asset: 'kbCrossedArms',
  }],
  [/^\/studio\/cost-monitoring/, {
    eyebrow: 'Admin Studio',
    title: 'Cost monitoring',
    body: 'Track AI, WhatsApp, and clinic usage costs with clear assumptions and operational context.',
    asset: 'analytics',
  }],
  [/^\/studio\/license/, {
    eyebrow: 'Admin Studio',
    title: 'License management',
    body: 'Review clinic licensing, access limits, renewals, and activation status across Docmee.',
    asset: 'kbCrossedArms',
  }],
  [/^\/studio\/compliance/, {
    eyebrow: 'Admin Studio',
    title: 'Compliance',
    body: 'Monitor policy, safety, and audit requirements that protect clinic workflows and patients.',
    asset: 'hologram',
  }],
  [/^\/studio\/governance/, {
    eyebrow: 'Admin Studio',
    title: 'Governance',
    body: 'Manage platform guardrails, oversight, and operational controls for Docmee clinics.',
    asset: 'kbCrossedArms',
  }],
  [/^\/studio\/credential-health/, {
    eyebrow: 'Admin Studio',
    title: 'Credential health',
    body: 'Check provider keys, tokens, webhooks, and integrations before they affect clinic operations.',
    asset: 'hologram',
  }],
  [/^\/studio\/errors/, {
    eyebrow: 'Admin Studio',
    title: 'Error monitoring',
    body: 'Find configuration, provider, webhook, and runtime problems that need attention.',
    asset: 'hologram',
  }],
  [/^\/studio\/audit/, {
    eyebrow: 'Admin Studio',
    title: 'Audit review',
    body: 'Review implementation checks, design alignment, and release confidence for Docmee.',
    asset: 'clipboard',
  }],
  [/^\/studio\/clinics/, {
    eyebrow: 'Admin Studio',
    title: 'Clinic management',
    body: 'Create, review, and maintain clinic profiles, configuration, and readiness status.',
    asset: 'kbCrossedArms',
  }],
  [/^\/studio$/, {
    eyebrow: 'Admin Studio',
    title: 'Clinic command center',
    body: 'Review clinics, setup progress, readiness, and the admin work needed to keep Docmee operational.',
    asset: 'thumbsUpPose',
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

  // The Inbox is an all-day workspace — a full-size hero would eat a quarter of
  // the viewport, so it gets a slim compact variant (~84px) that keeps the
  // wordmark/title but drops the tall art + body copy, handing the height back
  // to the message grid.
  const compact = pathname.startsWith('/inbox')

  return (
    <section
      className={`docmee-page-hero${compact ? ' docmee-page-hero--compact' : ''}`}
      style={{ '--docmee-page-hero-image': `url('${ASSET_SRC[copy.asset]}')` } as CSSProperties}
    >
      <div className="docmee-page-hero-copy">
        <p className="docmee-page-hero-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
      </div>
    </section>
  )
}
