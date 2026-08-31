export interface UserUiPreferences {
  sideRailSectionOrder: string[]
  sideRailItemOrder: Record<string, string[]>
  hiddenSideRailItems: string[]
  railExpanded: boolean
  conversationListExpanded: boolean
  imageBannersVisible: boolean
}

export const DEFAULT_USER_UI_PREFERENCES: UserUiPreferences = {
  sideRailSectionOrder: ['patient', 'calendar', 'notes', 'others'],
  sideRailItemOrder: {
    main: ['patient', 'calendar', 'notes', 'others'],
    others: ['customTags', 'safetyHandoff', 'assign', 'lifecycle', 'tags', 'aiAssistance'],
  },
  hiddenSideRailItems: [],
  railExpanded: false,
  conversationListExpanded: true,
  imageBannersVisible: true,
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0)
    ? value
    : null
}

function stringMap(value: unknown): Record<string, string[]> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out: Record<string, string[]> = {}
  for (const [key, raw] of Object.entries(value)) {
    const list = strings(raw)
    if (list) out[key] = list
  }
  return out
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function appendMissing(saved: string[], allowed: readonly string[]): string[] {
  const allowedSet = new Set(allowed)
  const safeSaved = saved.filter((item) => allowedSet.has(item))
  const seen = new Set(safeSaved)
  return [...safeSaved, ...allowed.filter((item) => !seen.has(item))]
}

export function normalizeUserUiPreferences(raw: unknown): UserUiPreferences {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const itemOrder = {
    ...DEFAULT_USER_UI_PREFERENCES.sideRailItemOrder,
    ...(stringMap(input.sideRailItemOrder) ?? {}),
  }

  return {
    sideRailSectionOrder: strings(input.sideRailSectionOrder) ?? DEFAULT_USER_UI_PREFERENCES.sideRailSectionOrder,
    sideRailItemOrder: itemOrder,
    hiddenSideRailItems: strings(input.hiddenSideRailItems) ?? DEFAULT_USER_UI_PREFERENCES.hiddenSideRailItems,
    railExpanded: bool(input.railExpanded, DEFAULT_USER_UI_PREFERENCES.railExpanded),
    conversationListExpanded: bool(input.conversationListExpanded, DEFAULT_USER_UI_PREFERENCES.conversationListExpanded),
    imageBannersVisible: bool(input.imageBannersVisible, DEFAULT_USER_UI_PREFERENCES.imageBannersVisible),
  }
}

export function visibleOrderedItems(
  savedOrder: readonly string[] | undefined,
  allowedItems: readonly string[],
  hiddenItems: readonly string[],
): string[] {
  const hidden = new Set(hiddenItems)
  const ordered = appendMissing([...(savedOrder ?? [])], allowedItems)
  return ordered.filter((item) => !hidden.has(item))
}
