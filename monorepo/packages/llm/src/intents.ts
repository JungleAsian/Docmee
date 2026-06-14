/** The five pipeline intents (architecture §4). */
export const INTENTS = [
  "question",
  "booking",
  "appointment_status",
  "handoff",
  "other",
] as const;

export type Intent = (typeof INTENTS)[number];

export function isIntent(value: string): value is Intent {
  return (INTENTS as readonly string[]).includes(value);
}
