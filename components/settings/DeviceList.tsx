"use client";

import { useActionState } from "react";
import { removeDevice, type AccountActionState } from "@/lib/actions/account";
import { formatDateTime } from "@/lib/utils/format";

type Device = {
  token: string;
  platform: string;
  deviceName: string | null;
  lastSeenAt: string;
};

const PLATFORM_LABELS: Record<string, string> = {
  ios: "iPhone or iPad",
  android: "Android",
  web: "Browser",
};

export function DeviceList({ devices }: { devices: Device[] }) {
  const [state, formAction] = useActionState<AccountActionState, FormData>(removeDevice, {});

  if (devices.length === 0) {
    return (
      <p className="border-hairline text-muted rounded-xl border border-dashed px-4 py-3 text-sm">
        No devices registered. Install the RoyalPal app and allow notifications to add one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="border-hairline bg-surface divide-y divide-[color:var(--hairline)] overflow-hidden rounded-2xl border">
        {devices.map((device) => (
          <li key={device.token} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {device.deviceName ?? PLATFORM_LABELS[device.platform] ?? device.platform}
              </p>
              <p className="text-muted text-sm">Last active {formatDateTime(device.lastSeenAt)}</p>
            </div>
            <form action={formAction}>
              <input type="hidden" name="token" value={device.token} />
              <button
                type="submit"
                className="text-muted hover:text-foreground min-h-11 shrink-0 px-2 text-sm underline underline-offset-4"
              >
                Remove
              </button>
            </form>
          </li>
        ))}
      </ul>
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {state.message}
        </p>
      )}
    </div>
  );
}
