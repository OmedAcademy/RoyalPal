import type { Metadata } from "next";
import { describeChannels } from "@/lib/notifications/diagnostics";
import { DeliveryTestButton } from "@/components/admin/DeliveryTestButton";

export const metadata: Metadata = { title: "Delivery — RoyalPal admin" };

// Reads process.env at request time; a build-time snapshot of the
// configuration would be exactly the wrong answer after a key is added.
export const dynamic = "force-dynamic";

export default function AdminDeliveryPage() {
  const channels = describeChannels();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Delivery</h1>
      <p className="text-muted -mt-2 max-w-2xl text-sm">
        Every channel beyond the in-app feed stays dormant until its credentials exist, and the
        notification service swallows delivery failures on purpose so a broken mailbox can never
        fail a booking. Those two together mean a misconfigured deployment looks identical to a
        working one from the outside. This page is how you tell them apart.
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Configuration</h2>
        <ul className="flex flex-col gap-2">
          {channels.map((channel) => (
            <li
              key={channel.channel}
              className="border-hairline bg-surface flex flex-col gap-1 rounded-xl border p-4"
            >
              <span className="flex items-center gap-2 font-medium">
                <span aria-hidden="true">{channel.configured ? "✅" : "⚪"}</span>
                <span className="capitalize">{channel.channel}</span>
                <span className="text-muted text-xs font-normal">
                  {channel.configured ? "configured" : "not configured"}
                </span>
              </span>
              <span className="text-muted text-sm">{channel.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Send a test</h2>
        <p className="text-muted max-w-2xl text-sm">
          The test goes to <strong>your own account only</strong> — the recipient comes from your
          session and cannot be chosen. It bypasses your notification preferences, so a muted
          category is never mistaken for a broken channel, and it is recorded in the audit log.
        </p>
        <DeliveryTestButton />
      </section>
    </div>
  );
}
