import { describe, expect, it } from "vitest";
import { evaluateRules, ruleMatches, type Rule } from "./rules.js";

describe("deterministic rule engine (Phase 3B)", () => {
  it("ANDs conditions within a rule", () => {
    const rule: Rule = {
      when: [
        { field: "intent", op: "eq", value: "booking" },
        { field: "tags", op: "contains", value: "vip" },
      ],
      then: [{ type: "priority_route" }],
    };
    expect(ruleMatches(rule, { intent: "booking", tags: ["vip"] })).toBe(true);
    expect(ruleMatches(rule, { intent: "booking", tags: ["normal"] })).toBe(false);
  });

  it("returns matching actions in priority order", () => {
    const rules: Rule[] = [
      { priority: 1, when: [{ field: "x", op: "eq", value: 1 }], then: [{ type: "low" }] },
      { priority: 9, when: [{ field: "x", op: "eq", value: 1 }], then: [{ type: "high" }] },
      { priority: 5, when: [{ field: "x", op: "eq", value: 2 }], then: [{ type: "nope" }] },
    ];
    expect(evaluateRules(rules, { x: 1 }).map((a) => a.type)).toEqual(["high", "low"]);
  });

  it("supports gt/lt/in/neq operators", () => {
    expect(ruleMatches({ when: [{ field: "n", op: "gt", value: 3 }], then: [] }, { n: 5 })).toBe(true);
    expect(ruleMatches({ when: [{ field: "n", op: "lt", value: 3 }], then: [] }, { n: 5 })).toBe(false);
    expect(ruleMatches({ when: [{ field: "c", op: "in", value: ["a", "b"] }], then: [] }, { c: "b" })).toBe(true);
    expect(ruleMatches({ when: [{ field: "s", op: "neq", value: "x" }], then: [] }, { s: "y" })).toBe(true);
  });
});
