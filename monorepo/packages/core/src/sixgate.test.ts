import { describe, expect, it } from "vitest";
import { evaluateSixGate, type SixGateContext } from "./sixgate.js";

/** A fully-passing context; each test flips one field to assert that gate blocks. */
const PASS: SixGateContext = {
  optedOut: false,
  automationEnabled: true,
  appointmentCancelled: false,
  hasConsent: true,
  sentWithin48h: false,
  within24hWindow: true,
  hasApprovedTemplate: false,
};

describe("🔒 six-gate proactive model (mandatory in-phase suite)", () => {
  it("allows when all gates pass (inside the 24h window)", () => {
    expect(evaluateSixGate(PASS)).toEqual({ allowed: true });
  });

  it("gate 1 — opted out blocks first", () => {
    expect(evaluateSixGate({ ...PASS, optedOut: true })).toEqual({
      allowed: false,
      blockedBy: "opted_out",
    });
  });

  it("gate 2 — automation disabled blocks", () => {
    expect(evaluateSixGate({ ...PASS, automationEnabled: false }).blockedBy).toBe(
      "automation_disabled",
    );
  });

  it("gate 3 — cancelled appointment blocks", () => {
    expect(evaluateSixGate({ ...PASS, appointmentCancelled: true }).blockedBy).toBe(
      "appointment_cancelled",
    );
  });

  it("gate 4 — missing consent blocks", () => {
    expect(evaluateSixGate({ ...PASS, hasConsent: false }).blockedBy).toBe("no_consent");
  });

  it("gate 5 — frequency cap (sent within 48h) blocks", () => {
    expect(evaluateSixGate({ ...PASS, sentWithin48h: true }).blockedBy).toBe("frequency_cap");
  });

  it("gate 6 — outside the 24h window requires an approved template", () => {
    expect(
      evaluateSixGate({ ...PASS, within24hWindow: false, hasApprovedTemplate: false }).blockedBy,
    ).toBe("template_required");
    expect(
      evaluateSixGate({ ...PASS, within24hWindow: false, hasApprovedTemplate: true }),
    ).toEqual({ allowed: true });
  });

  it("evaluates gates in priority order (opted-out wins over later failures)", () => {
    // Every gate would fail; the FIRST (opted_out) must be reported.
    expect(
      evaluateSixGate({
        optedOut: true,
        automationEnabled: false,
        appointmentCancelled: true,
        hasConsent: false,
        sentWithin48h: true,
        within24hWindow: false,
        hasApprovedTemplate: false,
      }).blockedBy,
    ).toBe("opted_out");
  });
});
