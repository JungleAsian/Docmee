import {
  ChatCircleText,
  WarningCircle,
  GitBranch,
  Clock,
  HourglassMedium,
  Brain,
  ChatCircleDots,
  FileText,
  Bell,
  Tag,
  Sparkle,
  ListBullets,
  CheckCircle,
  Question,
  MagicWand,
  CalendarCheck,
  CalendarBlank,
  CalendarPlus,
  Microphone,
  Robot,
  FlagCheckered,
  type Icon,
} from '@phosphor-icons/react'

// Maps NodeTypeDef.icon (a plain string key, kept out of workflowNodes.ts so
// that file stays JSX-free and importable from pure vitest tests) to an
// actual Phosphor icon component. Same lookup-table pattern as NavIcon.tsx.
const ICONS: Record<string, Icon> = {
  keyword: ChatCircleText,
  alert: WarningCircle,
  branch: GitBranch,
  clock: Clock,
  hourglass: HourglassMedium,
  brain: Brain,
  message: ChatCircleDots,
  file: FileText,
  bell: Bell,
  tag: Tag,
  sparkle: Sparkle,
  list: ListBullets,
  check: CheckCircle,
  question: Question,
  extract: MagicWand,
  calendarCheck: CalendarCheck,
  calendar: CalendarBlank,
  calendarMenu: CalendarBlank,
  calendarPlus: CalendarPlus,
  voice: Microphone,
  robot: Robot,
  end: FlagCheckered,
}

export function WorkflowNodeIcon({ icon, className = 'h-4 w-4' }: { icon: string; className?: string }) {
  const IconComponent = ICONS[icon]
  if (!IconComponent) return null
  return <IconComponent className={className} weight="duotone" aria-hidden="true" />
}
