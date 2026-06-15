/**
 * Declarative flow engine (Phase 3B). A custom intake/conversation flow is data,
 * not code: ordered steps with optional branching by the patient's answer. Pure
 * advance function — the runner persists state (crash-recovery by design).
 */
export interface FlowBranch {
  /** Answer value (matched case-insensitively, trimmed) → next step key. */
  equals: string;
  next: string;
}

export interface FlowStep {
  key: string;
  prompt: string;
  /** Next step: a fixed key, or branch on the answer with a default fallthrough. */
  next?: string;
  branches?: FlowBranch[];
  defaultNext?: string;
}

export interface FlowDefinition {
  start: string;
  steps: Record<string, FlowStep>;
}

export interface FlowAdvanceResult {
  /** The next step's key, or null when the flow is complete. */
  nextKey: string | null;
  prompt: string | null;
  done: boolean;
}

function resolveNext(step: FlowStep, answer: string): string | null {
  if (step.branches?.length) {
    const a = answer.trim().toLowerCase();
    const hit = step.branches.find((b) => b.equals.trim().toLowerCase() === a);
    if (hit) return hit.next;
    return step.defaultNext ?? step.next ?? null;
  }
  return step.next ?? null;
}

/** Given the current step + the patient's answer, compute the next step/prompt. */
export function flowAdvance(
  def: FlowDefinition,
  currentKey: string,
  answer: string,
): FlowAdvanceResult {
  const step = def.steps[currentKey];
  if (!step) return { nextKey: null, prompt: null, done: true };
  const nextKey = resolveNext(step, answer);
  if (!nextKey || !def.steps[nextKey]) {
    return { nextKey: null, prompt: null, done: true };
  }
  return { nextKey, prompt: def.steps[nextKey]!.prompt, done: false };
}

export function flowFirstPrompt(def: FlowDefinition): string | null {
  return def.steps[def.start]?.prompt ?? null;
}
