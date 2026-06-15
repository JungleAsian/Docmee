import { describe, expect, it } from "vitest";
import {
  currentEscalationTarget,
  escalationTargets,
  isDuplicate,
  isQuietHoursSuppressed,
} from "./escalation.js";

const MIN = 60_000;

describe("escalation chain (architecture §11)", () => {
  it("escalates assigned → all → admin → IA Studio over time", () => {
    expect(currentEscalationTarget(0)).toBe("assigned_secretary");
    expect(currentEscalationTarget(11 * MIN)).toBe("all_secretaries");
    expect(currentEscalationTarget(21 * MIN)).toBe("clinic_admin");
    expect(currentEscalationTarget(61 * MIN)).toBe("ia_studio_admin");
  });

  it("accumulates targets as time passes", () => {
    expect(escalationTargets(25 * MIN)).toEqual([
      "assigned_secretary",
      "all_secretaries",
      "clinic_admin",
    ]);
  });
});

describe("deduplication", () => {
  it("suppresses same type+conversation within 5 minutes", () => {
    const recent = [{ type: "bot_failed", conversationId: "c1", atMs: 1_000_000 }];
    expect(
      isDuplicate({ type: "bot_failed", conversationId: "c1", atMs: 1_000_000 + 2 * MIN }, recent),
    ).toBe(true);
    expect(
      isDuplicate({ type: "bot_failed", conversationId: "c1", atMs: 1_000_000 + 6 * MIN }, recent),
    ).toBe(false);
    expect(
      isDuplicate({ type: "bot_failed", conversationId: "c2", atMs: 1_000_000 + 2 * MIN }, recent),
    ).toBe(false);
  });
});

describe("quiet hours", () => {
  it("suppresses only P3/P4 during quiet hours", () => {
    expect(isQuietHoursSuppressed("P3", true)).toBe(true);
    expect(isQuietHoursSuppressed("P4", true)).toBe(true);
    expect(isQuietHoursSuppressed("P1", true)).toBe(false);
    expect(isQuietHoursSuppressed("P2", true)).toBe(false);
    expect(isQuietHoursSuppressed("P3", false)).toBe(false);
  });
});
