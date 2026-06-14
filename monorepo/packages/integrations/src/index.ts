/**
 * @docmee/integrations — outward integrations. OWNER: Prime.
 * Philosophy: Docmee is the source of communication data; external tools are the
 * destination. Phase 1C: Google Calendar (datetime source of truth).
 */
export {
  type CalendarProvider,
  type BusyInterval,
  type CreateEventInput,
  FakeCalendarProvider,
  GoogleCalendarProvider,
  type GoogleCalendarConfig,
} from "./calendar.js";
