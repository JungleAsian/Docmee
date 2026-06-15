/**
 * Calendar integration (Phase 1C). Google Calendar is the SOURCE OF TRUTH for
 * appointment datetime + availability (architecture §4); Docmee stores everything
 * else. Provider-abstracted so booking logic never calls Google directly and a
 * fake drives tests.
 */
export interface BusyInterval {
  start: string; // RFC3339 UTC
  end: string;
}

export interface CreateEventInput {
  startAt: string;
  endAt: string;
  summary: string;
  description?: string;
}

export interface CalendarProvider {
  readonly name: string;
  /** Busy intervals overlapping [start,end). */
  freeBusy(start: string, end: string): Promise<BusyInterval[]>;
  /** Create an event; returns the provider event id. */
  createEvent(input: CreateEventInput): Promise<{ eventId: string }>;
  /** Cancel/delete an event (reschedule/cancel are human-approved). */
  deleteEvent(eventId: string): Promise<void>;
}

function overlaps(aS: string, aE: string, bS: string, bE: string): boolean {
  return aS < bE && bS < aE;
}

/** Deterministic in-memory calendar for tests/dev (no Google OAuth needed). */
export class FakeCalendarProvider implements CalendarProvider {
  readonly name = "fake-calendar";
  private events = new Map<string, BusyInterval>();
  private seq = 0;

  freeBusy(start: string, end: string): Promise<BusyInterval[]> {
    return Promise.resolve(
      [...this.events.values()].filter((e) => overlaps(e.start, e.end, start, end)),
    );
  }

  createEvent(input: CreateEventInput): Promise<{ eventId: string }> {
    const eventId = `evt_${++this.seq}`;
    this.events.set(eventId, { start: input.startAt, end: input.endAt });
    return Promise.resolve({ eventId });
  }

  deleteEvent(eventId: string): Promise<void> {
    this.events.delete(eventId);
    return Promise.resolve();
  }
}

export interface GoogleCalendarConfig {
  accessToken: string;
  calendarId?: string;
  baseUrl?: string;
}

/**
 * Real Google Calendar adapter (fetch-based; wired, activated per-clinic once the
 * OAuth connect flow X15 provides a token). Not exercised by tests.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = "google-calendar";
  private readonly cfg: Required<GoogleCalendarConfig>;
  constructor(cfg: GoogleCalendarConfig) {
    this.cfg = {
      calendarId: "primary",
      baseUrl: "https://www.googleapis.com/calendar/v3",
      ...cfg,
    };
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.cfg.accessToken}`,
      "content-type": "application/json",
    };
  }

  async freeBusy(start: string, end: string): Promise<BusyInterval[]> {
    const res = await fetch(`${this.cfg.baseUrl}/freeBusy`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        timeMin: start,
        timeMax: end,
        items: [{ id: this.cfg.calendarId }],
      }),
    });
    if (!res.ok) throw new Error(`Google freeBusy ${res.status}`);
    const json = (await res.json()) as {
      calendars: Record<string, { busy: BusyInterval[] }>;
    };
    return json.calendars[this.cfg.calendarId]?.busy ?? [];
  }

  async createEvent(input: CreateEventInput): Promise<{ eventId: string }> {
    const res = await fetch(
      `${this.cfg.baseUrl}/calendars/${encodeURIComponent(this.cfg.calendarId)}/events`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          summary: input.summary,
          description: input.description,
          start: { dateTime: input.startAt },
          end: { dateTime: input.endAt },
        }),
      },
    );
    if (!res.ok) throw new Error(`Google createEvent ${res.status}`);
    const json = (await res.json()) as { id: string };
    return { eventId: json.id };
  }

  async deleteEvent(eventId: string): Promise<void> {
    const res = await fetch(
      `${this.cfg.baseUrl}/calendars/${encodeURIComponent(this.cfg.calendarId)}/events/${eventId}`,
      { method: "DELETE", headers: this.headers() },
    );
    if (!res.ok && res.status !== 410) throw new Error(`Google deleteEvent ${res.status}`);
  }
}
