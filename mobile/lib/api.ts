import { supabase } from "@/lib/supabase";

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True when retrying could plausibly succeed — offline, timeout, 5xx. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }

  /** True when the session is the problem and the app should sign out. */
  get isAuthFailure(): boolean {
    return this.status === 401;
  }
}

/**
 * The RoyalPal API client.
 *
 * Every call carries the current Supabase access token as a bearer, which the
 * server turns back into an RLS-scoped session — the same session a browser
 * would have. Nothing privileged lives in this app; the token is a user's own
 * credential and grants exactly what that user can already do.
 *
 * The token is read fresh on every request rather than cached. supabase-js
 * refreshes in the background and hands back a new access token roughly
 * hourly; a cached one turns into 401s the first time the app is left open
 * for an afternoon.
 */
async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  if (!BASE_URL) {
    throw new ApiError("The app isn't configured to reach RoyalPal yet.", 0, "unconfigured");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // A mobile network can hang indefinitely rather than failing, which shows up
  // as a spinner that never resolves. A bounded wait turns that into an error
  // the UI can offer a retry for.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...init.headers,
      },
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
      const body = payload as { error?: string; code?: string } | null;
      throw new ApiError(
        body?.error ?? "Something went wrong. Please try again.",
        response.status,
        body?.code,
      );
    }

    return payload as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new ApiError("That took too long. Check your connection and try again.", 0, "timeout");
    }
    // fetch rejects with a TypeError when the device is offline or DNS fails.
    throw new ApiError("You appear to be offline. Check your connection.", 0, "offline");
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "DELETE",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
};

/** Shapes the API returns, kept in one place so screens share them. */
export type Me = {
  profile: {
    id: string;
    role: "student" | "tutor" | "admin";
    fullName: string;
    avatarUrl: string | null;
    country: string | null;
    timezone: string;
    status: "active" | "suspended";
    deletionRequestedAt: string | null;
  };
  roleProfile: Record<string, unknown> | null;
  badges: { unreadMessages: number; unreadNotifications: number };
};

export type TutorSummary = {
  id: string;
  full_name: string;
  headline: string;
  bio: string;
  avatar_url: string | null;
  hourly_rate_cents: number;
  trial_price_cents: number | null;
  currency: string;
  teaching_languages: string[];
  specializations: string[];
  avg_rating: number | null;
  total_reviews: number;
  video_url: string | null;
  subject_ids: number[];
  stripe_charges_enabled: boolean;
  favorited?: boolean;
};

export type TutorPage = {
  tutors: TutorSummary[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

export type Booking = {
  id: string;
  status: "pending_payment" | "confirmed" | "completed" | "cancelled" | "refunded";
  start_at: string;
  end_at: string;
  price_cents: number;
  currency: string;
  meeting_url: string | null;
  meeting_status: string;
  subject_name: string | null;
  student_name: string;
  tutor_name: string;
  reviewed?: boolean;
};

export type ConversationSummary = {
  id: string;
  bookingId: string;
  status: "open" | "closed";
  closedReason: string | null;
  counterpartName: string;
  counterpartAvatarUrl: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  lessonStartAt: string;
  lessonStatus: string;
  subjectName: string | null;
};

export type Message = {
  id: string;
  body: string;
  senderId: string;
  mine: boolean;
  readAt: string | null;
  createdAt: string;
};

export type NotificationItem = {
  id: string;
  type: string;
  icon: string;
  category: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: string;
};

export type AvailabilityDay = {
  date: string;
  label: string;
  slots: { startAt: string; endAt: string; label: string }[];
};

export type Ticket = {
  id: string;
  subject: string;
  category: string;
  status: string;
  lastMessageAt: string;
  createdAt: string;
};
