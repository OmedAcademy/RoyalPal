/**
 * Hand-authored to match supabase/migrations/0001-0019 exactly.
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
          created_at: string;
          updated_at: string;
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
          created_at?: string;
          updated_at?: string;
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
        };
        Insert: {
          id?: string;
          booking_id: string;
          student_id: string;
          tutor_id: string;
          rating: number;
          comment?: string | null;
          created_at?: string;
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
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      user_status: UserStatus;
      tutor_verification_status: TutorVerificationStatus;
      booking_status: BookingStatus;
      payment_status: PaymentStatus;
      english_level: EnglishLevel;
    };
  };
}

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type StudentProfile = Database["public"]["Tables"]["student_profiles"]["Row"];
export type TutorProfile = Database["public"]["Tables"]["tutor_profiles"]["Row"];
export type Subject = Database["public"]["Tables"]["subjects"]["Row"];
export type AvailabilityRule = Database["public"]["Tables"]["availability_rules"]["Row"];
export type AvailabilityException = Database["public"]["Tables"]["availability_exceptions"]["Row"];
export type Booking = Database["public"]["Tables"]["bookings"]["Row"];
export type Payment = Database["public"]["Tables"]["payments"]["Row"];
export type Review = Database["public"]["Tables"]["reviews"]["Row"];
