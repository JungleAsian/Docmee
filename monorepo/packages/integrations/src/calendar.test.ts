import { describe, expect, it } from "vitest";
import { FakeCalendarProvider } from "./calendar.js";

describe("FakeCalendarProvider", () => {
  it("reports a created event as busy in an overlapping window", async () => {
    const cal = new FakeCalendarProvider();
    await cal.createEvent({
      startAt: "2026-07-01T15:00:00Z",
      endAt: "2026-07-01T15:30:00Z",
      summary: "Consulta",
    });
    const busy = await cal.freeBusy("2026-07-01T15:15:00Z", "2026-07-01T16:00:00Z");
    expect(busy).toHaveLength(1);
  });

  it("returns no busy for a non-overlapping window", async () => {
    const cal = new FakeCalendarProvider();
    await cal.createEvent({
      startAt: "2026-07-01T15:00:00Z",
      endAt: "2026-07-01T15:30:00Z",
      summary: "Consulta",
    });
    const busy = await cal.freeBusy("2026-07-01T16:00:00Z", "2026-07-01T17:00:00Z");
    expect(busy).toEqual([]);
  });

  it("frees the slot after deleteEvent", async () => {
    const cal = new FakeCalendarProvider();
    const { eventId } = await cal.createEvent({
      startAt: "2026-07-01T15:00:00Z",
      endAt: "2026-07-01T15:30:00Z",
      summary: "Consulta",
    });
    await cal.deleteEvent(eventId);
    expect(await cal.freeBusy("2026-07-01T15:00:00Z", "2026-07-01T15:30:00Z")).toEqual([]);
  });
});
