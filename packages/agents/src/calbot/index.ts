// calbot — the appointment scheduling agent. Pure flow logic with injected
// Google Calendar + persistence side effects (mirrors the botbase pattern).

export {
  getOAuth2Client,
  listAvailableSlots,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  computeFreeSlots,
  DEFAULT_BOOKING_GRID,
  type BookingGrid,
  createGoogleCalendarOps,
  createGoogleCalendarClient,
  type CalendarOps,
  type TimeSlot,
  type CreateEventParams,
  type GoogleCalendarConfig,
  type RefreshedTokens,
} from './google-calendar-client.js'

export {
  parseDate,
  parseTime,
  isAffirmative,
  isNegative,
  matchProvider,
  matchService,
  formatSlotLabel,
  pick,
  type ClinicInfo,
  type ProviderRef,
  type ServiceRef,
  type UpcomingAppointment,
} from './shared.js'

export {
  normalizeAvailability,
  hasAvailability,
  worksOnDay,
  weekdayOf,
  isWithinAvailability,
  filterSlotsByAvailability,
  WEEKDAYS,
  type Weekday,
  type TimeRange,
  type DoctorAvailability,
} from './doctor-availability.js'

export {
  advanceBookingFlow,
  initialBookingState,
  type BookingStep,
  type BookingState,
  type BookingContext,
  type BookingDeps,
  type FlowResult,
} from './booking-flow.js'

export {
  advanceRescheduleFlow,
  initialRescheduleState,
  type RescheduleStep,
  type RescheduleState,
  type RescheduleContext,
  type RescheduleDeps,
  type RescheduleResult,
} from './reschedule-flow.js'

export {
  advanceCancelFlow,
  initialCancelState,
  type CancelStep,
  type CancelState,
  type CancelContext,
  type CancelDeps,
  type CancelResult,
} from './cancel-flow.js'

export {
  buildStatusReply,
  advanceStatusFlow,
  type StatusContext,
  type StatusResult,
} from './status-flow.js'
