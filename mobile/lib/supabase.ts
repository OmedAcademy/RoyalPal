import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { AppState } from "react-native";
import { sessionStorage } from "@/lib/storage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Whether the app has been pointed at a Supabase project.
 *
 * Checked rather than assumed so a build with missing configuration shows a
 * clear message instead of failing inside the auth library with something
 * nobody can act on.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * The ONLY credentials in this bundle are the project URL and the anon key,
 * both of which are designed to be public. Row Level Security is what protects
 * the data, not secrecy of the key. The service-role key is never here and
 * never can be: anything needing it goes through the RoyalPal API.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    // A native app has no URL bar to read a callback fragment from; the
    // deep-link handler in app/_layout.tsx feeds the session in explicitly.
    detectSessionInUrl: false,
  },
});

/**
 * Supabase refreshes tokens on a timer, and a timer does not run while an app
 * is backgrounded. Without this, coming back to the app after a few hours
 * leaves it holding an expired access token until something fails.
 */
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
