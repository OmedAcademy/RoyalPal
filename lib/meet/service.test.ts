import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/fake-supabase";
import {
  PermanentMeetingError,
  TransientMeetingError,
  type Meeting,
  type MeetingProvider,
} from "@/lib/meet/provider";

/**
 * MeetingService contract.
 *
 * The service runs inside the Stripe webhook *after* money is captured, so its
 * hard guarantees are: never throw, never create two rooms for one booking,
 * and never leave an orphaned calendar event behind.
 */

const BOOKING = "b-1";
const TUTOR = "t-1";
const STUDENT = "s-1";

let fake: ReturnType<typeof createFakeSupabase>;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    ...fake.client,
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: { email: `${id}@example.com` } },
        }),
      },
    },
  }),
}));

const { MeetingService, __setMeetingProvider } = await import("@/lib/meet/service");

const meeting: Meeting = {
  provider: "test_provider",
  meetingUrl: "https://meet.test/abc-defg-hij",
  meetingId: "abc-defg-hij",
  calendarEventId: "evt_1",
};

/** Configurable provider double. */
function makeProvider(over: Partial<MeetingProvider> = {}): MeetingProvider {
  return {
    name: "test_provider",
    isConfigured: () => true,
    createMeeting: vi.fn().mockResolvedValue(meeting),
    rescheduleMeeting: vi.fn().mockResolvedValue(meeting),
    cancelMeeting: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as MeetingProvider;
}

const booking = () => fake.db.bookings[0];

beforeEach(() => {
  fake = createFakeSupabase({
    bookings: [
      {
        id: BOOKING,
        start_at: "2026-08-01T10:00:00.000Z",
        end_at: "2026-08-01T11:00:00.000Z",
        student_id: STUDENT,
        tutor_id: TUTOR,
        status: "confirmed",
        calendar_event_id: null,
        meeting_url: null,
        meeting_provider: null,
        meeting_status: "pending",
        subjects: { name: "English" },
      },
    ],
    profiles: [
      { id: TUTOR, full_name: "Ada" },
      { id: STUDENT, full_name: "Grace" },
    ],
  });
});

describe("createMeeting", () => {
  it("creates the room and persists every meeting field", async () => {
    __setMeetingProvider(makeProvider());

    await MeetingService.createMeeting(BOOKING);

    expect(booking().meeting_provider).toBe("test_provider");
    expect(booking().meeting_url).toBe(meeting.meetingUrl);
    expect(booking().meeting_id).toBe(meeting.meetingId);
    expect(booking().calendar_event_id).toBe("evt_1");
    expect(booking().meeting_status).toBe("scheduled");
  });

  it("invites BOTH the tutor and the student", async () => {
    const provider = makeProvider();
    __setMeetingProvider(provider);

    await MeetingService.createMeeting(BOOKING);

    const input = (provider.createMeeting as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.tutor.email).toBe(`${TUTOR}@example.com`);
    expect(input.student.email).toBe(`${STUDENT}@example.com`);
    // bookingId is the provider-side idempotency key.
    expect(input.bookingId).toBe(BOOKING);
  });

  it("is idempotent — a duplicate webhook does not create a second room", async () => {
    const provider = makeProvider();
    __setMeetingProvider(provider);

    await MeetingService.createMeeting(BOOKING);
    await MeetingService.createMeeting(BOOKING);

    expect(provider.createMeeting).toHaveBeenCalledTimes(1);
    expect(booking().calendar_event_id).toBe("evt_1");
  });

  it("no-ops when the provider has no credentials configured", async () => {
    const provider = makeProvider({ isConfigured: () => false });
    __setMeetingProvider(provider);

    await MeetingService.createMeeting(BOOKING);

    expect(provider.createMeeting).not.toHaveBeenCalled();
    expect(booking().meeting_status).toBe("pending");
  });

  it("never throws when the provider fails, and records failure for retry", async () => {
    __setMeetingProvider(
      makeProvider({
        createMeeting: vi.fn().mockRejectedValue(new PermanentMeetingError("403 forbidden")),
      }),
    );

    await expect(MeetingService.createMeeting(BOOKING)).resolves.toBeUndefined();
    expect(booking().meeting_status).toBe("failed");
    expect(booking().calendar_event_id).toBeNull();
  });
});

describe("retry behaviour", () => {
  it("retries transient failures and succeeds", async () => {
    const createMeeting = vi
      .fn()
      .mockRejectedValueOnce(new TransientMeetingError("503"))
      .mockRejectedValueOnce(new TransientMeetingError("429"))
      .mockResolvedValue(meeting);
    __setMeetingProvider(makeProvider({ createMeeting }));

    await MeetingService.createMeeting(BOOKING);

    expect(createMeeting).toHaveBeenCalledTimes(3);
    expect(booking().meeting_status).toBe("scheduled");
  });

  it("does NOT retry permanent failures (no wasted calls on a bad token)", async () => {
    const createMeeting = vi.fn().mockRejectedValue(new PermanentMeetingError("401"));
    __setMeetingProvider(makeProvider({ createMeeting }));

    await MeetingService.createMeeting(BOOKING);

    expect(createMeeting).toHaveBeenCalledTimes(1);
    expect(booking().meeting_status).toBe("failed");
  });

  it("gives up after the retry budget and marks failed", async () => {
    const createMeeting = vi.fn().mockRejectedValue(new TransientMeetingError("503"));
    __setMeetingProvider(makeProvider({ createMeeting }));

    await MeetingService.createMeeting(BOOKING);

    expect(createMeeting).toHaveBeenCalledTimes(3);
    expect(booking().meeting_status).toBe("failed");
  });
});

describe("rollback", () => {
  it("deletes the remote event when persisting it fails (no orphaned room)", async () => {
    const cancelMeeting = vi.fn().mockResolvedValue(undefined);
    __setMeetingProvider(makeProvider({ cancelMeeting }));

    // Force the persist step to fail.
    const realFrom = fake.client.from;
    let updates = 0;
    fake.client.from = (table: string) => {
      const q = realFrom(table);
      if (table === "bookings") {
        const origUpdate = q.update.bind(q);
        // @ts-expect-error test seam
        q.update = (patch: Record<string, unknown>) => {
          if (patch.meeting_status === "scheduled" && updates++ === 0) {
            return {
              eq: () => Promise.resolve({ data: null, error: { message: "db write failed" } }),
            };
          }
          return origUpdate(patch);
        };
      }
      return q;
    };

    await MeetingService.createMeeting(BOOKING);

    expect(cancelMeeting).toHaveBeenCalledWith("evt_1");
  });
});

describe("cancelMeeting", () => {
  it("cancels the provider event and invalidates the stored meeting", async () => {
    const provider = makeProvider();
    __setMeetingProvider(provider);
    await MeetingService.createMeeting(BOOKING);

    await MeetingService.cancelMeeting(BOOKING);

    expect(provider.cancelMeeting).toHaveBeenCalledWith("evt_1");
    expect(booking().meeting_status).toBe("cancelled");
    expect(booking().meeting_url).toBeNull();
  });

  it("is a no-op when the booking never had a meeting", async () => {
    const provider = makeProvider();
    __setMeetingProvider(provider);

    await MeetingService.cancelMeeting(BOOKING);

    expect(provider.cancelMeeting).not.toHaveBeenCalled();
  });

  it("never throws when the provider fails", async () => {
    __setMeetingProvider(makeProvider());
    await MeetingService.createMeeting(BOOKING);

    __setMeetingProvider(
      makeProvider({
        cancelMeeting: vi.fn().mockRejectedValue(new PermanentMeetingError("500")),
      }),
    );

    await expect(MeetingService.cancelMeeting(BOOKING)).resolves.toBeUndefined();
  });
});

describe("rescheduleMeeting", () => {
  it("updates the existing event and preserves the Meet URL", async () => {
    const provider = makeProvider();
    __setMeetingProvider(provider);
    await MeetingService.createMeeting(BOOKING);

    await MeetingService.rescheduleMeeting(
      BOOKING,
      "2026-08-02T10:00:00.000Z",
      "2026-08-02T11:00:00.000Z",
    );

    expect(provider.rescheduleMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ calendarEventId: "evt_1" }),
    );
    // Same room — links already shared with attendees keep working.
    expect(booking().meeting_url).toBe(meeting.meetingUrl);
    expect(booking().meeting_status).toBe("scheduled");
  });

  it("creates a meeting if the booking never had one", async () => {
    const provider = makeProvider();
    __setMeetingProvider(provider);

    await MeetingService.rescheduleMeeting(
      BOOKING,
      "2026-08-02T10:00:00.000Z",
      "2026-08-02T11:00:00.000Z",
    );

    expect(provider.createMeeting).toHaveBeenCalledTimes(1);
    expect(provider.rescheduleMeeting).not.toHaveBeenCalled();
  });
});
