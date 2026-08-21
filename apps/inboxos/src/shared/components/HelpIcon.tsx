import {
  BookOpenText,
  Tray,
  CalendarBlank,
  PlugsConnected,
  Robot,
  FileText,
  ShieldCheck,
  ChartLine,
  Question,
  type Icon,
} from '@phosphor-icons/react'

// Help-category icons in the SAME visual style as the workflow builder's node
// icons (Phosphor, weight="duotone") — see WorkflowNodeIcon.tsx. Maps the help
// content's icon keys to a Phosphor icon; unknown keys fall back to a question mark.
const ICONS: Record<string, Icon> = {
  kb: BookOpenText,
  inbox: Tray,
  calendar: CalendarBlank,
  channels: PlugsConnected,
  automations: Robot,
  templates: FileText,
  compliance: ShieldCheck,
  metrics: ChartLine,
}

export function HelpIcon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const IconComponent = ICONS[name] ?? Question
  return <IconComponent className={className} weight="duotone" aria-hidden="true" />
}
