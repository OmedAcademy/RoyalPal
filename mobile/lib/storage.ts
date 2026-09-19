import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

/**
 * Session storage for Supabase Auth on a device.
 *
 * WHY THIS IS NOT JUST `SecureStore`
 * A Supabase session is a JSON blob containing two JWTs and the user object,
 * and it routinely exceeds 2 KB. SecureStore warns above that size and on
 * Android it is backed by SharedPreferences entries that are not designed for
 * large values — so storing the session directly is the classic silent
 * failure: it works with a small user object and starts dropping sessions the
 * moment a profile grows, which presents as "the app randomly signs me out".
 *
 * So the value is chunked. Chunk 0 holds a small manifest with the count, and
 * the pieces are reassembled on read. A partially-written value (app killed
 * mid-write) fails the count check and is treated as absent, which costs one
 * sign-in rather than leaving a corrupt session that fails in stranger ways.
 *
 * WHY SECURESTORE AT ALL
 * The refresh token is a long-lived credential. On iOS this puts it in the
 * Keychain and on Android in an encrypted store, rather than in plain
 * AsyncStorage where any process that can read the app's files can read it.
 *
 * Web falls back to AsyncStorage because SecureStore has no web
 * implementation; the app targets web only for development.
 */

const CHUNK_SIZE = 1800;

const isWeb = Platform.OS === "web";

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

async function setItemChunked(key: string, value: string): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE));
  }

  // Remove a longer previous value's tail first, or a shrinking session leaves
  // orphan chunks that the next read would happily append.
  await removeItemChunked(key);

  await SecureStore.setItemAsync(key, String(chunks.length));
  for (let i = 0; i < chunks.length; i += 1) {
    await SecureStore.setItemAsync(chunkKey(key, i), chunks[i]);
  }
}

async function getItemChunked(key: string): Promise<string | null> {
  const countRaw = await SecureStore.getItemAsync(key);
  if (!countRaw) return null;

  const count = Number(countRaw);
  if (!Number.isInteger(count) || count < 0) return null;

  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const part = await SecureStore.getItemAsync(chunkKey(key, i));
    // A missing piece means the write was interrupted. Half a session is
    // worse than none, so report none.
    if (part === null) return null;
    parts.push(part);
  }
  return parts.join("");
}

async function removeItemChunked(key: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(key);
  const count = Number(countRaw ?? "0");
  if (Number.isInteger(count)) {
    for (let i = 0; i < count; i += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
  }
  await SecureStore.deleteItemAsync(key);
}

export const sessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return isWeb ? await AsyncStorage.getItem(key) : await getItemChunked(key);
    } catch {
      // A read failure must look like "signed out", never like a crash on
      // launch — the user can always sign in again.
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (isWeb) await AsyncStorage.setItem(key, value);
      else await setItemChunked(key, value);
    } catch {
      // Swallowed deliberately: failing to persist means the session lasts
      // until the app is closed, which is a degraded experience rather than a
      // broken one.
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      if (isWeb) await AsyncStorage.removeItem(key);
      else await removeItemChunked(key);
    } catch {
      // Nothing useful to do; sign-out has already cleared memory state.
    }
  },
};
