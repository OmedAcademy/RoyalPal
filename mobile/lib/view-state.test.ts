import { describe, it, expect } from "vitest";
import { viewState } from "./view-state";

/**
 * MOB-13 — a failed request must not be reported as an empty result.
 *
 * The tutor calendar never read `availability.error`, so a fetch failure fell
 * into the else branch: "You haven't set any availability yet, so nobody can
 * book you." The most alarming sentence on the screen, shown for a reason that
 * has nothing to do with the tutor, about something they could not fix by
 * doing what it suggests.
 */

type Availability = { rules: unknown[] };
const noRules = (a: Availability) => a.rules.length === 0;

const base = { data: null, loading: false, error: null, retryable: false };

describe("viewState", () => {
  it("calls a failed fetch an error, not an empty result", async () => {
    const view = viewState<Availability>(
      { ...base, error: "You appear to be offline.", retryable: true },
      noRules,
    );

    expect(view.kind).toBe("error");
    if (view.kind === "error") {
      expect(view.message).toBe("You appear to be offline.");
      expect(view.retryable).toBe(true);
    }
  });

  it("calls a genuinely empty response empty", async () => {
    const view = viewState<Availability>({ ...base, data: { rules: [] } }, noRules);

    expect(view.kind).toBe("empty");
  });

  it("reports loading before anything else", async () => {
    // A request still in flight is not yet a failure and not yet an absence.
    const view = viewState<Availability>({ ...base, loading: true, error: "stale" }, noRules);

    expect(view.kind).toBe("loading");
  });

  it("hands back the data when there is some", async () => {
    const view = viewState<Availability>({ ...base, data: { rules: [1, 2] } }, noRules);

    expect(view.kind).toBe("ready");
    if (view.kind === "ready") expect(view.data.rules).toHaveLength(2);
  });

  it("keeps showing data when a REFRESH fails", async () => {
    // Blanking a screen someone is reading, to report that the newer copy did
    // not arrive, trades something useful for something merely accurate.
    const view = viewState<Availability>(
      { data: { rules: [1] }, loading: false, error: "Timed out", retryable: true },
      noRules,
    );

    expect(view.kind).toBe("ready");
  });

  it("treats a null payload as empty rather than as data", async () => {
    expect(viewState<Availability>(base, noRules).kind).toBe("empty");
  });
});
