/**
 * Hand-authored to match supabase/migrations/0001-0037 exactly.
 * Once a real Supabase project exists, regenerate and diff against this file with:
 *   npx supabase gen types typescript --project-id <project-id> --schema public
 *
 * Every table includes `Relationships: []` and the schema includes empty
 * Views/Functions maps — required by @supabase/postgrest-js's GenericTable/
 * GenericSchema constraints for row-type inference to resolve correctly.
 * Omitting them silently degrades query results to `never`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = "student" | "tutor" | "admin";
export type UserStatus = "active" | "suspended";
export type TutorVerificationStatus = "pending" | "approved" | "rejected";
export type EnglishLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type BookingStatus =
  "pending_payment" | "confirmed" | "completed" | "cancelled" | "refunded";
export type PaymentStatus = "requires_payment" | "succeeded" | "failed" | "refunded" | "expired";
/** Tutor-payout state (migration 0024). Null = no transfer applies, i.e. the
 * lesson was a plain platform charge because the tutor had not completed
 * Connect onboarding. Distinct from PaymentStatus, which is the student's
 * charge. */
export type TransferStatus = "paid" | "reversed";
export type SupportCategory =
  "account" | "booking" | "payment" | "technical" | "report_user" | "safeguarding" | "other";
export type SupportStatus = "open" | "in_progress" | "waiting_on_user" | "resolved" | "closed";
export type PushPlatform = "ios" | "android" | "web";
export type NotificationChannel = "email" | "push";
export type ConversationStatus = "open" | "closed";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          role: UserRole;
          full_name: string;
          avatar_url: string | null;
          country: string | null;
          timezone: string;
          phone: string | null;
          status: UserStatus;
          created_at: string;
          updated_at: string;
          // Migration 0036. Write-once age gate; see profiles_date_of_birth lock.
          date_of_birth: string | null;
          age_confirmed_at: string | null;
          // Migration 0039. Consent evidence: who, when, and which version.
          terms_accepted_at: string | null;
          terms_version: string | null;
          deletion_requested_at: string | null;
          anonymized_at: string | null;
        };
        Insert: {
          id: string;
          role: UserRole;
          full_name: string;
          avatar_url?: string | null;
          country?: string | null;
          timezone?: string;
          phone?: string | null;
          status?: UserStatus;
          created_at?: string;
          updated_at?: string;
          date_of_birth?: string | null;
          age_confirmed_at?: string | null;
          terms_accepted_at?: string | null;
          terms_version?: string | null;
          deletion_requested_at?: string | null;
          anonymized_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      student_profiles: {
        Row: {
          id: string;
          learning_goals: string | null;
          target_languages: string[] | null;
          native_language: string | null;
          english_level: EnglishLevel | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          learning_goals?: string | null;
          target_languages?: string[] | null;
          native_language?: string | null;
          english_level?: EnglishLevel | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["student_profiles"]["Insert"]>;
        Relationships: [];
      };
      tutor_profiles: {
        Row: {
          id: string;
          headline: string;
          bio: string;
          video_url: string | null;
          hourly_rate_cents: number;
          trial_price_cents: number | null;
          currency: string;
          languages_spoken: string[];
          teaching_languages: string[];
          specializations: string[];
          years_experience: number | null;
          certifications: string[];
          education: string | null;
          availability_note: string | null;
          verification_status: TutorVerificationStatus;
          avg_rating: number | null;
          total_reviews: number;
          stripe_account_id: string | null;
          stripe_charges_enabled: boolean;
          /** Fuller Connect state (migration 0026). Mirrors of Stripe's own
           * account object, meant to be written only by the account.updated
           * webhook. Migration 0028 enforces that in the database, but it is
           * NOT applied to production (as of 10 September 2026): there a
           * tutor can still write these columns directly.
           * charges_enabled and payouts_enabled are deliberately separate:
           * an account can take charges while its bank payouts are paused. */
          stripe_payouts_enabled: boolean;
          stripe_details_submitted: boolean;
          stripe_requirements_due: string[];
          stripe_disabled_reason: string | null;
          /** Per-tutor commission override in basis points (migration 0025).
           * Null = use the platform rate. See lib/pricing/commission.ts. */
          platform_fee_bps: number | null;
          created_at: string;
          updated_at: string;
          // Migration 0036. Why an application was rejected, so the tutor is
          // told something actionable instead of "update your profile".
          rejection_reason: string | null;
          rejection_notes: string | null;
          verification_decided_at: string | null;
          verification_decided_by: string | null;
        };
        Insert: {
          id: string;
          headline: string;
          bio: string;
          video_url?: string | null;
          hourly_rate_cents: number;
          trial_price_cents?: number | null;
          currency?: string;
          languages_spoken?: string[];
          teaching_languages?: string[];
          specializations?: string[];
          years_experience?: number | null;
          certifications?: string[];
          education?: string | null;
          availability_note?: string | null;
          verification_status?: TutorVerificationStatus;
          avg_rating?: number | null;
          total_reviews?: number;
          stripe_account_id?: string | null;
          stripe_charges_enabled?: boolean;
          stripe_payouts_enabled?: boolean;
          stripe_details_submitted?: boolean;
          stripe_requirements_due?: string[];
          stripe_disabled_reason?: string | null;
          platform_fee_bps?: number | null;
          created_at?: string;
          updated_at?: string;
          rejection_reason?: string | null;
          rejection_notes?: string | null;
          verification_decided_at?: string | null;
          verification_decided_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["tutor_profiles"]["Insert"]>;
        Relationships: [];
      };
      subjects: {
        Row: {
          id: number;
          name: string;
          category: string;
          slug: string;
        };
        Insert: {
          id?: number;
          name: string;
          category: string;
          slug: string;
        };
        Update: Partial<Database["public"]["Tables"]["subjects"]["Insert"]>;
        Relationships: [];
      };
      tutor_subjects: {
        Row: {
          tutor_id: string;
          subject_id: number;
        };
        Insert: {
          tutor_id: string;
          subject_id: number;
        };
        Update: Partial<Database["public"]["Tables"]["tutor_subjects"]["Insert"]>;
        Relationships: [];
      };
      availability_rules: {
        Row: {
          id: string;
          tutor_id: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tutor_id: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["availability_rules"]["Insert"]>;
        Relationships: [];
      };
      availability_exceptions: {
        Row: {
          id: string;
          tutor_id: string;
          date: string;
          start_time: string | null;
          end_time: string | null;
          is_available: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tutor_id: string;
          date: string;
          start_time?: string | null;
          end_time?: string | null;
          is_available: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["availability_exceptions"]["Insert"]>;
        Relationships: [];
      };
      bookings: {
        Row: {
          id: string;
          student_id: string;
          tutor_id: string;
          subject_id: number;
          start_at: string;
          end_at: string;
          lesson_duration_minutes: number;
          status: BookingStatus;
          meeting_link: string | null;
          // Live-classroom fields (migration 0022). Written exclusively by
          // MeetingService via the service role.
          meeting_provider: string | null;
          meeting_url: string | null;
          meeting_id: string | null;
          calendar_event_id: string | null;
          meeting_status: string;
          price_cents: number;
          platform_fee_cents: number;
          currency: string;
          cancellation_reason: string | null;
          created_at: string;
          updated_at: string;
          // Migration 0037. refund_owed_cents is what OUR policy decided;
          // whether it was actually refunded lives in payments.status, which
          // only Stripe's charge.refunded event writes.
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancellation_policy: string | null;
          refund_owed_cents: number | null;
        };
        Insert: {
          id?: string;
          student_id: string;
          tutor_id: string;
          subject_id: number;
          start_at: string;
          end_at: string;
          lesson_duration_minutes?: number;
          status?: BookingStatus;
          meeting_link?: string | null;
          meeting_provider?: string | null;
          meeting_url?: string | null;
          meeting_id?: string | null;
          calendar_event_id?: string | null;
          meeting_status?: string;
          price_cents: number;
          platform_fee_cents: number;
          currency?: string;
          cancellation_reason?: string | null;
          created_at?: string;
          updated_at?: string;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancellation_policy?: string | null;
          refund_owed_cents?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["bookings"]["Insert"]>;
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          booking_id: string;
          stripe_payment_intent_id: string | null;
          checkout_session_id: string | null;
          amount_cents: number;
          status: PaymentStatus;
          currency: string;
          paid_at: string | null;
          created_at: string;
          // Migration 0024. Tutor-payout and dispute state, independent of
          // `status` (which tracks the student's charge). Written only by
          // the Stripe webhook handlers.
          stripe_transfer_id: string | null;
          transfer_status: TransferStatus | null;
          transfer_status_reason: string | null;
          stripe_dispute_id: string | null;
          dispute_status: string | null;
          // Migration 0037. An ATTEMPT, not an outcome — `status` is the only
          // field that says Stripe confirmed the money moved back.
          refund_requested_at: string | null;
          refund_requested_by: string | null;
          stripe_refund_id: string | null;
        };
        Insert: {
          id?: string;
          booking_id: string;
          stripe_payment_intent_id?: string | null;
          checkout_session_id?: string | null;
          amount_cents: number;
          status?: PaymentStatus;
          currency?: string;
          paid_at?: string | null;
          created_at?: string;
          stripe_transfer_id?: string | null;
          transfer_status?: TransferStatus | null;
          transfer_status_reason?: string | null;
          stripe_dispute_id?: string | null;
          dispute_status?: string | null;
          refund_requested_at?: string | null;
          refund_requested_by?: string | null;
          stripe_refund_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["payments"]["Insert"]>;
        Relationships: [];
      };
      reviews: {
        Row: {
          id: string;
          booking_id: string;
          student_id: string;
          tutor_id: string;
          rating: number;
          comment: string | null;
          created_at: string;
          // Migration 0035. Hidden reviews keep their row but leave public
          // view and stop counting toward the tutor's average.
          hidden_at: string | null;
          hidden_by: string | null;
          hidden_reason: string | null;
          tutor_reply: string | null;
          tutor_replied_at: string | null;
        };
        Insert: {
          id?: string;
          booking_id: string;
          student_id: string;
          tutor_id: string;
          rating: number;
          comment?: string | null;
          created_at?: string;
          hidden_at?: string | null;
          hidden_by?: string | null;
          hidden_reason?: string | null;
          tutor_reply?: string | null;
          tutor_replied_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["reviews"]["Insert"]>;
        Relationships: [];
      };
      favorites: {
        Row: {
          student_id: string;
          tutor_id: string;
          created_at: string;
        };
        Insert: {
          student_id: string;
          tutor_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["favorites"]["Insert"]>;
        Relationships: [];
      };
      admin_actions: {
        Row: {
          id: string;
          admin_id: string;
          action: string;
          target_id: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          admin_id: string;
          action: string;
          target_id?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["admin_actions"]["Insert"]>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          category: string;
          title: string;
          body: string | null;
          data: Json;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          category?: string;
          title: string;
          body?: string | null;
          data?: Json;
          read_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
        Relationships: [];
      };
      stripe_events: {
        Row: {
          id: string;
          type: string;
          payload: Json;
          processed_at: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          type: string;
          payload: Json;
          processed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["stripe_events"]["Insert"]>;
        Relationships: [];
      };
      support_tickets: {
        Row: {
          id: string;
          user_id: string;
          category: SupportCategory;
          subject: string;
          status: SupportStatus;
          assigned_admin_id: string | null;
          last_message_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          category?: SupportCategory;
          subject: string;
          status?: SupportStatus;
          assigned_admin_id?: string | null;
          last_message_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["support_tickets"]["Insert"]>;
        Relationships: [];
      };
      support_messages: {
        Row: {
          id: string;
          ticket_id: string;
          sender_id: string;
          /** Recorded at write time, never derived from the sender's current
           * role — a demoted admin must not retroactively unwrite their
           * replies. */
          from_admin: boolean;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          ticket_id: string;
          sender_id: string;
          from_admin?: boolean;
          body: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["support_messages"]["Insert"]>;
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          booking_id: string;
          student_id: string;
          tutor_id: string;
          status: ConversationStatus;
          closed_reason: string | null;
          last_message_at: string | null;
          // Migration 0046. Written by touch_conversation, never by a client:
          // the column grant withholds it.
          last_message_preview: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          student_id: string;
          tutor_id: string;
          status?: ConversationStatus;
          closed_reason?: string | null;
          last_message_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["conversations"]["Insert"]>;
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          read_at?: string | null;
          created_at?: string;
        };
        /** read_at is the ONLY field a client may change (migration 0032's
         * protect_message_columns). */
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
        Relationships: [];
      };
      push_tokens: {
        Row: {
          id: string;
          user_id: string;
          token: string;
          platform: PushPlatform;
          device_name: string | null;
          disabled_at: string | null;
          last_seen_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          token: string;
          platform: PushPlatform;
          device_name?: string | null;
          disabled_at?: string | null;
          last_seen_at?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["push_tokens"]["Insert"]>;
        Relationships: [];
      };
      notification_preferences: {
        /** Opt-OUT rows: a row exists only where something is switched off,
         * so the absence of data means enabled. */
        Row: {
          user_id: string;
          channel: NotificationChannel;
          category: string;
          enabled: boolean;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          channel: NotificationChannel;
          category: string;
          enabled?: boolean;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notification_preferences"]["Insert"]>;
        Relationships: [];
      };
      booking_reschedules: {
        Row: {
          id: string;
          booking_id: string;
          requested_by: string;
          previous_start_at: string;
          previous_end_at: string;
          new_start_at: string;
          new_end_at: string;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          requested_by: string;
          previous_start_at: string;
          previous_end_at: string;
          new_start_at: string;
          new_end_at: string;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["booking_reschedules"]["Insert"]>;
        Relationships: [];
      };
      rate_limits: {
        /** Migration 0038. Service-role only: RLS is enabled with zero
         * policies, so every authenticated and anonymous access is denied. */
        Row: {
          key: string;
          window_started_at: string;
          count: number;
        };
        Insert: {
          key: string;
          window_started_at: string;
          count?: number;
        };
        Update: Partial<Database["public"]["Tables"]["rate_limits"]["Insert"]>;
        Relationships: [];
      };
      account_deletion_requests: {
        Row: {
          id: string;
          user_id: string;
          reason: string | null;
          scheduled_for: string;
          cancelled_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          reason?: string | null;
          scheduled_for: string;
          cancelled_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["account_deletion_requests"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      review_authors: {
        Row: {
          id: string;
          full_name: string;
          avatar_url: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      /** Migration 0034. The single audited door through which a booking's
       * start_at/end_at may change; see the migration for why it exists. */
      reschedule_booking: {
        Args: {
          p_booking_id: string;
          p_new_start_at: string;
          p_reason?: string | null;
          p_max_reschedules?: number;
        };
        Returns: Database["public"]["Tables"]["bookings"]["Row"];
      };
      /** Migration 0038. Atomic fixed-window counter; the check and the
       * increment are one statement because read-then-write is a race two
       * concurrent requests win together. */
      consume_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number };
        Returns: { allowed: boolean; remaining: number; reset_at: string }[];
      };
      // Migration 0046. No arguments: it counts for auth.uid(), which cannot
      // be passed the wrong value.
      unread_message_count: {
        Args: Record<string, never>;
        Returns: number;
      };
    };
    Enums: {
      user_role: UserRole;
      user_status: UserStatus;
      tutor_verification_status: TutorVerificationStatus;
      booking_status: BookingStatus;
      payment_status: PaymentStatus;
      english_level: EnglishLevel;
      support_category: SupportCategory;
      support_status: SupportStatus;
    };
  };
}

/**
 * A profile as an RLS-scoped CLIENT can read it.
 *
 * `phone` and `date_of_birth` are absent because migration 0041 revokes SELECT
 * on those two columns from `authenticated` — RLS scopes rows, not columns, so
 * the policies that share a tutor's name were sharing their date of birth too.
 * Omitting them here means a component that reaches for one fails to compile
 * rather than failing at runtime with "permission denied for column".
 *
 * Privileged code that needs the full row (signup, anonymisation, diagnostics)
 * goes through the service role and uses ProfileRow.
 */
export type Profile = Omit<
  Database["public"]["Tables"]["profiles"]["Row"],
  "phone" | "date_of_birth"
>;

/** The complete row, readable only through the service role. */
export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type StudentProfile = Database["public"]["Tables"]["student_profiles"]["Row"];
export type TutorProfile = Database["public"]["Tables"]["tutor_profiles"]["Row"];

/**
 * A tutor profile as an RLS-scoped CLIENT can read it.
 *
 * Migration 0041 revokes SELECT on the tutor's Stripe and commission state
 * from `authenticated`: a student who can see a headline must not also be able
 * to read the connected-account id or the negotiated commission rate, and RLS
 * scopes rows rather than columns. Omitting them here turns a query that would
 * fail at runtime with "permission denied for column" into a compile error.
 *
 * Privileged readers — the payouts page, Connect onboarding, checkout's
 * destination-charge lookup, the admin console and the Stripe webhooks — use
 * the service role and the full TutorProfile type.
 */
export type TutorProfileClient = Omit<
  TutorProfile,
  | "stripe_account_id"
  | "stripe_payouts_enabled"
  | "stripe_details_submitted"
  | "stripe_requirements_due"
  | "stripe_disabled_reason"
  | "platform_fee_bps"
>;
export type Subject = Database["public"]["Tables"]["subjects"]["Row"];
export type AvailabilityRule = Database["public"]["Tables"]["availability_rules"]["Row"];
export type AvailabilityException = Database["public"]["Tables"]["availability_exceptions"]["Row"];
export type Booking = Database["public"]["Tables"]["bookings"]["Row"];
export type Payment = Database["public"]["Tables"]["payments"]["Row"];
export type Review = Database["public"]["Tables"]["reviews"]["Row"];
export type StripeEvent = Database["public"]["Tables"]["stripe_events"]["Row"];
export type SupportTicket = Database["public"]["Tables"]["support_tickets"]["Row"];
export type SupportMessage = Database["public"]["Tables"]["support_messages"]["Row"];
export type Conversation = Database["public"]["Tables"]["conversations"]["Row"];
export type Message = Database["public"]["Tables"]["messages"]["Row"];
export type PushToken = Database["public"]["Tables"]["push_tokens"]["Row"];
export type NotificationPreference =
  Database["public"]["Tables"]["notification_preferences"]["Row"];
export type BookingReschedule = Database["public"]["Tables"]["booking_reschedules"]["Row"];
export type AccountDeletionRequest =
  Database["public"]["Tables"]["account_deletion_requests"]["Row"];
