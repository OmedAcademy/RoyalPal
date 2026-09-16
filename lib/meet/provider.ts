/**
 * Live-classroom provider contract.
 *
 * Booking logic never talks to Google (or Zoom, or Teams) directly — it calls
 * MeetingService, which delegates to whichever provider is configured. Adding
 * a provider means implementing this interface and registering it; no booking
 * or payment code changes.
 *
 * Providers must be:
 *  • idempotent on create — `bookingId` is the caller's idempotency key, so a
 *    duplicate Stripe webhook delivery cannot mint a second meeting room;
 *  • pure transport — persistence and rollback are the service's job.
 */

export type MeetingParticipant = {
  email: string;
  name?: string;
};

export type CreateMeetingInput = {
  /** Stable idempotency key. Also the provider's dedupe key where supported. */
  bookingId: string;
  subject: string;
  description?: string;
  /** ISO-8601 instants. */
  startAt: string;
  endAt: string;
  /** IANA zone the event is displayed in (the tutor's zone). */
  timeZone: string;
  tutor: MeetingParticipant;
  student: MeetingParticipant;
};

export type RescheduleMeetingInput = {
  calendarEventId: string;
  startAt: string;
  endAt: string;
  timeZone: string;
};

export type Meeting = {
  /** Provider name, persisted so a booking can be cancelled by whichever
   * provider created it even after the default provider changes. */
  provider: string;
  meetingUrl: string;
  /** Provider-side conference id, where the provider exposes one. */
  meetingId: string | null;
  /** Handle used to update or cancel the event later. */
  calendarEventId: string;
};

export interface MeetingProvider {
  readonly name: string;
  /** False when credentials are absent — the service then no-ops instead of
   * throwing, so an unconfigured deployment still takes bookings. */
  isConfigured(): boolean;
  createMeeting(input: CreateMeetingInput): Promise<Meeting>;
  rescheduleMeeting(input: RescheduleMeetingInput): Promise<Meeting>;
  cancelMeeting(calendarEventId: string): Promise<void>;
}

/** Raised for provider failures that are worth retrying (429 / 5xx / network). */
export class TransientMeetingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientMeetingError";
  }
}

/** Raised for failures a retry cannot fix (400 / 401 / 403 / 404). */
export class PermanentMeetingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentMeetingError";
  }
}
