import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { api, ApiError, type Me } from "@/lib/api";
import { registerForPush, unregisterCurrentDevice } from "@/lib/push";

type AuthState = {
  /** null while the stored session is still being read from the keychain. */
  session: Session | null | undefined;
  me: Me | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  configured: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Push registration is per signed-in user; this stops it re-running on every
  // token refresh, which fires often and would hammer the endpoint.
  const registeredFor = useRef<string | null>(null);

  const loadMe = useCallback(async (current: Session | null) => {
    if (!current) {
      setMe(null);
      setError(null);
      return;
    }
    try {
      const data = await api.get<Me>("/api/v1/me");
      setMe(data);
      setError(null);

      if (registeredFor.current !== data.profile.id) {
        registeredFor.current = data.profile.id;
        // Best-effort: a device that cannot register still gets a working app,
        // it just misses push. Never block sign-in on it.
        void registerForPush();
      }
    } catch (err) {
      if (err instanceof ApiError && err.isAuthFailure) {
        // The stored session outlived its refresh token. Clearing it is the
        // only recovery, and it must not look like a crash.
        await supabase.auth.signOut();
        setMe(null);
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn't load your account.");
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession(null);
      setLoading(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadMe(data.session);
      if (active) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, next) => {
      if (!active) return;
      setSession(next);
      // TOKEN_REFRESHED fires roughly hourly and changes nothing the app needs
      // to re-fetch; reloading the profile on it would mean a network request
      // every hour for no reason.
      if (event !== "TOKEN_REFRESHED") await loadMe(next);
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadMe]);

  const refresh = useCallback(async () => {
    const {
      data: { session: current },
    } = await supabase.auth.getSession();
    await loadMe(current);
  }, [loadMe]);

  const signOut = useCallback(async () => {
    // Unregister BEFORE dropping the session: the call is authenticated, and
    // doing it afterwards would leave the token attached to this account and
    // the next person to sign in on this phone receiving the previous user's
    // lesson reminders.
    await unregisterCurrentDevice();
    registeredFor.current = null;
    await supabase.auth.signOut();
    setMe(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      me,
      loading,
      error,
      refresh,
      signOut,
      configured: isSupabaseConfigured,
    }),
    [session, me, loading, error, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
