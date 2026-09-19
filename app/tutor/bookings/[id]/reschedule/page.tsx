import type { Metadata } from "next";
import { requireProfile } from "@/lib/supabase/queries";
import { RescheduleView } from "@/components/booking/RescheduleView";

export const metadata: Metadata = { title: "Move a lesson — RoyalPal" };

export default async function TutorReschedulePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile(["tutor"]);
  const { id } = await params;
  return (
    <RescheduleView
      bookingId={id}
      viewerId={profile.id}
      viewerRole="tutor"
      viewerTimezone={profile.timezone}
    />
  );
}
