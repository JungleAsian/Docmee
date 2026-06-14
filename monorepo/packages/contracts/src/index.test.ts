import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_STATUSES,
  CHANNELS,
  CONVERSATION_MODES,
  LOCALES,
  ROLES,
  type RealtimeEvent,
} from "./index.js";

describe("contract enums", () => {
  it("exposes the locked role set", () => {
    expect(ROLES).toEqual(["doctor", "secretary", "admin", "assistant", "platform"]);
  });

  it("exposes channels in launch order (whatsapp first)", () => {
    expect(CHANNELS[0]).toBe("whatsapp");
  });

  it("exposes conversation modes including the paused/resolved terminal states", () => {
    expect(CONVERSATION_MODES).toContain("paused");
    expect(CONVERSATION_MODES).toContain("resolved");
  });

  it("exposes the full appointment lifecycle", () => {
    expect(APPOINTMENT_STATUSES).toEqual([
      "booked",
      "confirmed",
      "completed",
      "cancelled",
      "no_show",
    ]);
  });

  it("defaults locale list to Spanish-first", () => {
    expect(LOCALES[0]).toBe("es");
  });

  it("models realtime events as a discriminated union", () => {
    const ev: RealtimeEvent = { event: "conversation.updated", data: { id: "c1" } };
    expect(ev.event).toBe("conversation.updated");
  });
});
