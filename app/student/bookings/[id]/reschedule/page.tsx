import type { Metadata } from "next";
import { requireProfile } from "@/lib/supabase/queries";
import { RescheduleView } from "@/components/booking/RescheduleView";

export const metadata: Metadata = { title: "Move a lesson — RoyalPal" };

export default async function StudentReschedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireProfile(["student"]);
  const { id } = await params;
  return (
    <RescheduleView
      bookingId={id}
      viewerId={profile.id}
      viewerRole="student"
      viewerTimezone={profile.timezone}
    />
  );
}
