/** Positive, intentionally tiny auto-publication vocabulary. Unknown prose is
 * never classified as safe merely because a risk regex did not match it. */
export function officeHourFact(text: string): string | null {
  const normalized = text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
  const match = /^(?:we open at|the clinic opens at|abrimos a las|la clinica abre a las|la clínica abre a las) (1[0-2]|[1-9])(?::([0-5][0-9]))? (am|pm)\.$/.exec(normalized)
  return match ? `opens:${Number(match[1]) % 12 + (match[3] === 'pm' ? 12 : 0)}:${match[2] ?? '00'}` : null
}

/** Only a complete current scope can establish consistency, and only for
 * atomic office-hour assertions. Mixed prose/unknown facts remain unknown. */
export function scopedOfficeHourConsistency(answer: string, sources: string[], complete: boolean): 'clear' | 'conflict' | 'unknown' {
  const expected = officeHourFact(answer)
  if (!complete || !expected || !sources.length) return 'unknown'
  const facts = sources.flatMap(source => source.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim())).map(officeHourFact)
  if (!facts.length || facts.some(fact => fact === null)) return 'unknown'
  return facts.every(fact => fact === expected) ? 'clear' : 'conflict'
}
