import { View, Text, Linking } from "react-native";
import { router } from "expo-router";
import { Card, Badge, Button, usePalette } from "@/components/ui";
import { formatDateTimeIn, formatMoney, timeZoneLabel, BOOKING_STATUS_LABELS } from "@/lib/format";
import { spacing } from "@/lib/theme";
import type { Booking } from "@/lib/api";

const TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  pending_payment: "warning",
  confirmed: "success",
  completed: "neutral",
  cancelled: "danger",
  refunded: "neutral",
};

/**
 * When the lesson can be joined.
 *
 * `join_opens_at` comes from the server, so there is one copy of the policy
 * instead of two that each carried a comment claiming to match the other.
 * Whether that moment has arrived is still decided here, against this device's
 * clock, so a screen left open reaches it. Showing the link days early sends
 * people into an empty room and generates a support ticket every time.
 */
function joinWindow(booking: Booking): boolean {
  const now = Date.now();
  return (
    now >= new Date(booking.join_opens_at).getTime() && now <= new Date(booking.end_at).getTime()
  );
}

export function BookingCard({
  booking,
  timezone,
  viewerRole,
}: {
  booking: Booking;
  timezone: string;
  viewerRole: "student" | "tutor";
}) {
  const palette = usePalette();
  const other = viewerRole === "student" ? booking.tutor_name : booking.student_name;
  const canJoin = booking.status === "confirmed" && joinWindow(booking) && booking.meeting_url;

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontWeight: "600", color: palette.foreground }}>
            {booking.subject_name ?? "Lesson"} with {other}
          </Text>
          <Text style={{ color: palette.muted, fontSize: 14 }}>
            {formatDateTimeIn(booking.start_at, timezone)} (
            {timeZoneLabel(booking.start_at, timezone)})
          </Text>
        </View>
        <Badge
          label={BOOKING_STATUS_LABELS[booking.status] ?? booking.status}
          tone={TONE[booking.status] ?? "neutral"}
        />
      </View>

      <Text style={{ color: palette.muted, fontSize: 14 }}>
        {formatMoney(booking.price_cents, booking.currency)}
      </Text>

      {canJoin ? (
        <Button onPress={() => Linking.openURL(booking.meeting_url!)}>Join lesson</Button>
      ) : null}

      {booking.status === "confirmed" && booking.meeting_status === "failed" ? (
        <Text style={{ color: palette.muted, fontSize: 13 }}>
          We&apos;re still preparing your video link — it will appear here shortly.
        </Text>
      ) : null}

      <Button variant="secondary" onPress={() => router.push(`/lesson/${booking.id}`)}>
        Lesson details
      </Button>
    </Card>
  );
}
