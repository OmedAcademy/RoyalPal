/**
 * Which of the four states a screen is actually in.
 *
 * useApi's own docblock names them — loading, data, empty, error-with-retry —
 * and then leaves the choosing to each screen, which is where they get
 * confused. The tutor calendar collapsed error into empty and told a tutor
 * "you haven't set any availability yet, so nobody can book you" whenever the
 * availability request failed. That is the most alarming sentence the screen
 * can produce, shown for a reason that has nothing to do with the tutor.
 *
 * Deciding it in one place, from data rather than from whichever branch a
 * ternary happened to fall into, is the only version that stays right as
 * screens are added.
 */

export type AsyncView<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string; retryable: boolean }
  | { kind: "empty" }
  | { kind: "ready"; data: T };

export type AsyncLike<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  retryable: boolean;
};

export function viewState<T>(
  state: AsyncLike<T>,
  /** Whether a successful response actually contained anything. */
  isEmpty: (data: T) => boolean = () => false,
): AsyncView<T> {
  if (state.loading) return { kind: "loading" };

  // Only when there is nothing to show. useApi keeps the previous data through
  // a failed REFRESH on purpose, and blanking a screen someone is reading, to
  // report that the newer copy did not arrive, trades something useful for
  // something merely accurate.
  if (state.error && state.data === null) {
    return { kind: "error", message: state.error, retryable: state.retryable };
  }

  if (state.data === null) return { kind: "empty" };
  return isEmpty(state.data) ? { kind: "empty" } : { kind: "ready", data: state.data };
}
