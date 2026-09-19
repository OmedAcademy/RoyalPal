import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "@/lib/api";
import { colors } from "@/lib/theme";

/**
 * Push notifications.
 *
 * NO SECRETS LIVE HERE. Expo's push service is addressed by the token the
 * device itself is issued, and the server holds whatever credential is used to
 * send. Nothing in this file could be extracted from the bundle and used to
 * notify anybody.
 *
 * The token is never hardcoded and never cached in app storage: it is fetched
 * from the OS each launch and POSTed to the server, which claims it for the
 * signed-in account. That re-registration on every launch is deliberate — it
 * keeps last_seen_at honest and, on a shared device, moves a reissued token to
 * whoever is actually signed in now.
 */

let handlerInstalled = false;

export function installNotificationHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      // shouldShowAlert is deprecated in SDK 57 in favour of these two, which
      // separate "appear as a banner" from "appear in the notification list".
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

/** Android shows nothing at all without a channel. iOS ignores this. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Lessons and messages",
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: colors.royal,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

function projectId(): string | undefined {
  // The id EAS assigns. getExpoPushTokenAsync cannot mint a token without it,
  // so an unconfigured build simply has no push rather than a crash.
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    undefined
  );
}

export type PushRegistration = { token: string; platform: "ios" | "android" | "web" };

let currentToken: string | null = null;

export async function registerForPush(): Promise<PushRegistration | null> {
  // A simulator cannot receive push. Asking anyway produces a confusing
  // permission prompt followed by a failure.
  if (!Device.isDevice) return null;
  if (Platform.OS === "web") return null;

  const id = projectId();
  if (!id || id.startsWith("00000000")) return null;

  await ensureAndroidChannel();

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  // Only ask if we have not been refused: re-prompting after a denial does
  // nothing on either platform and burns the one chance to ask on iOS.
  if (status !== "granted" && existing.canAskAgain) {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") return null;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    currentToken = token;

    await api.post("/api/v1/devices", {
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
      deviceName: Device.deviceName ?? Device.modelName ?? undefined,
    });

    return { token, platform: Platform.OS === "ios" ? "ios" : "android" };
  } catch {
    // Expo's token endpoint is a network call and can fail offline. Push is an
    // enhancement; the app works without it and will try again next launch.
    return null;
  }
}

/** Detaches this device from the account being signed out of. */
export async function unregisterCurrentDevice(): Promise<void> {
  if (!currentToken) return;
  try {
    await api.del("/api/v1/devices", { token: currentToken });
  } catch {
    // If this fails the server still stops sending once the token is reclaimed
    // by the next sign-in, and a dead token is disabled on first send failure.
  }
  currentToken = null;
}
