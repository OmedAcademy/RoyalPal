import { useCallback, useEffect, useRef, useState } from "react";
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
 *
 * Two things this is careful about, both of which used to be wrong.
 *
 * It fires ONCE on mount. useFocusEffect runs on the first focus too, so every
 * screen opened a second identical request a moment after its first — double
 * the load, for nothing.
 *
 * And it ignores a response that has been overtaken. Requests are not
 * guaranteed to come back in the order they were sent; on the paginated search
 * screen, page 1 arriving after page 2 replaced the newer results with the
 * older ones, which reads as the app ignoring the tap.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  /** Monotonic request token. Only the newest request may write state. */
  const sequence = useRef(0);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!path) {
        setLoading(false);
        return;
      }
      const mine = ++sequence.current;
      if (mode === "refresh") setRefreshing(true);
      try {
        const result = await api.get<T>(path);
        if (mine !== sequence.current) return;
        setData(result);
        setError(null);
        setRetryable(false);
      } catch (err) {
        if (mine !== sequence.current) return;
        setError(err instanceof Error ? err.message : "Couldn't load that.");
        setRetryable(err instanceof ApiError ? err.isRetryable : true);
      } finally {
        // The guard is repeated here rather than hoisted: an overtaken request
        // must not clear a spinner that belongs to the one that overtook it.
        if (mine === sequence.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, ...deps],
  );

  /** The `load` the effect below has already fired for, cleared once the
   * matching focus has been seen. Tracked by identity rather than with a
   * "first focus" flag, because `load` changes whenever `path` or `deps` do —
   * a page change would otherwise fire the pair of requests all over again. */
  const fetchedFor = useRef<unknown>(null);

  useEffect(() => {
    fetchedFor.current = load;
    setLoading(true);
    void load("initial");
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      // A focus that arrives for the same `load` the effect above just fired
      // is the mount's own focus, moments after an identical request.
      if (fetchedFor.current === load) {
        fetchedFor.current = null;
        return;
      }
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
