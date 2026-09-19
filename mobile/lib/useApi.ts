import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api, ApiError } from "@/lib/api";

export type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  retryable: boolean;
  refresh: () => void;
  reload: () => void;
};

/**
 * Fetches a GET endpoint with the four states every screen owes its reader:
 * loading, data, empty (the caller's job) and error-with-retry.
 *
 * Refetches on focus, not just on mount. A phone app is not a page load — a
 * person books a lesson, swipes back, and expects the list behind them to
 * reflect it. Without this, every screen is stale the moment you navigate away
 * and back, which reads as the app being broken.
 *
 * `refreshing` is tracked apart from `loading` so pull-to-refresh spins the
 * control instead of blanking the screen the person is reading.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!path) {
        setLoading(false);
        return;
      }
      if (mode === "refresh") setRefreshing(true);
      try {
        const result = await api.get<T>(path);
        setData(result);
        setError(null);
        setRetryable(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load that.");
        setRetryable(err instanceof ApiError ? err.isRetryable : true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, ...deps],
  );

  useEffect(() => {
    setLoading(true);
    void load("initial");
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      // Refresh rather than reload: the screen already has content, and
      // blanking it on every back-navigation would be worse than slightly
      // stale data for a moment.
      void load("refresh");
    }, [load]),
  );

  return {
    data,
    loading,
    refreshing,
    error,
    retryable,
    refresh: () => void load("refresh"),
    reload: () => {
      setLoading(true);
      void load("initial");
    },
  };
}

/** A mutation with busy/error state, for the many small POSTs in this app. */
export function useMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
): {
  run: (args: TArgs) => Promise<TResult | null>;
  busy: boolean;
  error: string | null;
  clearError: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (args: TArgs) => {
      setBusy(true);
      setError(null);
      try {
        return await fn(args);
      } catch (err) {
        setError(err instanceof Error ? err.message : "That didn't work. Please try again.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );

  return { run, busy, error, clearError: () => setError(null) };
}
