import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateRules } from "@docmee/core";
import { createTestDb, type TestDb } from "../testing/pglite.js";
import { createClinic } from "./auth.js";
import { createFlow, listFlows, createRule, loadEnabledRules } from "./flows.js";

describe("flows + rules storage (Phase 3B)", () => {
  let h: TestDb;
  let clinicId: string;

  beforeAll(async () => {
    h = await createTestDb();
    const c = await h.db.withPlatformContext((tx) => createClinic(tx, { name: "A" }));
    clinicId = c.id;
  });
  afterAll(async () => h.close());

  it("stores and lists a declarative flow", async () => {
    await h.db.withClinicContext(clinicId, (tx) =>
      createFlow(tx, {
        name: "intake-pediatria",
        definition: {
          start: "s1",
          steps: { s1: { key: "s1", prompt: "¿Edad del paciente?", next: "done" }, done: { key: "done", prompt: "ok" } },
        },
      }),
    );
    const flows = await h.db.withClinicContext(clinicId, (tx) => listFlows(tx));
    expect(flows[0]!.definition.start).toBe("s1");
  });

  it("stores rules and loads them engine-ready (usable by evaluateRules)", async () => {
    await h.db.withClinicContext(clinicId, (tx) =>
      createRule(tx, {
        name: "vip-priority",
        priority: 5,
        definition: {
          when: [{ field: "tag", op: "eq", value: "vip" }],
          then: [{ type: "escalate" }],
        },
      }),
    );
    const rules = await h.db.withClinicContext(clinicId, (tx) => loadEnabledRules(tx));
    const actions = evaluateRules(rules, { tag: "vip" });
    expect(actions.map((a) => a.type)).toContain("escalate");
  });
});
