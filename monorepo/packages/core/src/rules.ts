/**
 * Deterministic clinic rule engine (Phase 3B). Advanced rules are STRUCTURED and
 * evaluated deterministically — never LLM discretion (architecture principle:
 * safety-critical behavior is deterministic). A rule's conditions are ANDed; all
 * matching rules' actions are returned in priority order.
 */
export type Op = "eq" | "neq" | "contains" | "gt" | "lt" | "in";

export interface Condition {
  field: string;
  op: Op;
  value: unknown;
}

export interface RuleAction {
  type: string;
  params?: Record<string, unknown>;
}

export interface Rule {
  id?: string;
  priority?: number;
  when: Condition[];
  then: RuleAction[];
}

export type RuleContext = Record<string, unknown>;

function matchCondition(c: Condition, ctx: RuleContext): boolean {
  const actual = ctx[c.field];
  switch (c.op) {
    case "eq":
      return actual === c.value;
    case "neq":
      return actual !== c.value;
    case "contains":
      if (Array.isArray(actual)) return actual.includes(c.value);
      if (typeof actual === "string") return actual.includes(String(c.value));
      return false;
    case "gt":
      return typeof actual === "number" && actual > Number(c.value);
    case "lt":
      return typeof actual === "number" && actual < Number(c.value);
    case "in":
      return Array.isArray(c.value) && (c.value as unknown[]).includes(actual);
    default:
      return false;
  }
}

export function ruleMatches(rule: Rule, ctx: RuleContext): boolean {
  return rule.when.every((c) => matchCondition(c, ctx));
}

/** Actions of all rules whose conditions match, highest priority first. */
export function evaluateRules(rules: Rule[], ctx: RuleContext): RuleAction[] {
  return [...rules]
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .filter((r) => ruleMatches(r, ctx))
    .flatMap((r) => r.then);
}
