/**
 * A minimal in-memory stand-in for the Supabase service-role client, built
 * to exercise the exact query chains the Stripe webhook handlers use.
 *
 * Why a fake and not vi.fn() mocks: the properties under test (idempotency,
 * out-of-order delivery, conditional updates that only fire when a row is
 * still in a given state) are *row-state* properties. Assertion-only mocks
 * would verify that we called the client, not that the resulting data ends
 * up correct. This fake stores rows and applies filters/updates for real, so
 * a test can assert the final state of `payments` and `bookings`.
 *
 * Supported surface (deliberately only what the handlers use):
 *   from(t).select(cols).eq(c,v)...maybeSingle()
 *   from(t).update(patch).eq(c,v)...
 *   from(t).upsert(payload, { onConflict })
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
export type DbError = { message: string; code?: string };

type Result<T> = { data: T; error: DbError | null };

/** Test-controlled failure injection (e.g. simulating the double-booking
 * exclusion-constraint violation Postgres raises as 23P01). */
export type Control = { insertError: DbError | null };

class Query implements PromiseLike<Result<Row[]>> {
  private filters: [string, unknown][] = [];
  private negativeFilters: [string, unknown][] = [];
  private single = false;

  constructor(
    private rows: Row[],
    private op: "select" | "update" | "upsert" | "insert",
    private payload?: Row,
    private onConflict?: string,
    private control?: Control,
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  /** Negative filter — used by the atomic "don't downgrade a succeeded
   * payment" guard in startCheckout. */
  neq(column: string, value: unknown): this {
    this.negativeFilters.push([column, value]);
    return this;
  }

  maybeSingle(): PromiseLike<Result<Row | null>> {
    this.single = true;
    return this as unknown as PromiseLike<Result<Row | null>>;
  }

  /** Postgrest `.single()` — same as maybeSingle for our purposes. */
  single_(): PromiseLike<Result<Row | null>> {
    this.single = true;
    return this as unknown as PromiseLike<Result<Row | null>>;
  }

  private matches(row: Row): boolean {
    return (
      this.filters.every(([c, v]) => row[c] === v) &&
      this.negativeFilters.every(([c, v]) => row[c] !== v)
    );
  }

  private run(): Result<unknown> {
    if (this.op === "insert") {
      if (this.control?.insertError) {
        return { data: null, error: this.control.insertError };
      }
      const row = { id: `row_${this.rows.length + 1}`, ...this.payload };
      this.rows.push(row);
      return { data: this.single ? row : [row], error: null };
    }

    if (this.op === "select") {
      const found = this.rows.filter((r) => this.matches(r));
      return this.single ? { data: found[0] ?? null, error: null } : { data: found, error: null };
    }

    if (this.op === "update") {
      const target = this.rows.filter((r) => this.matches(r));
      for (const row of target) Object.assign(row, this.payload);
      return this.single ? { data: target[0] ?? null, error: null } : { data: target, error: null };
    }

    // upsert
    const key = this.onConflict ?? "id";
    const existing = this.rows.find((r) => r[key] === this.payload?.[key]);
    if (existing) {
      Object.assign(existing, this.payload);
    } else {
      this.rows.push({ id: `row_${this.rows.length + 1}`, ...this.payload });
    }
    return { data: null, error: null };
  }

  then<A, B = never>(
    onfulfilled?: ((value: Result<Row[]>) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run() as Result<Row[]>).then(onfulfilled, onrejected);
  }
}

export function createFakeSupabase(tables: Tables, user: { id: string } | null = null) {
  const db: Tables = {};
  for (const [name, rows] of Object.entries(tables)) {
    db[name] = rows.map((r) => ({ ...r }));
  }
  const control: Control = { insertError: null };

  // `single()` is a reserved-ish name on the class; expose it by wrapping so
  // the chain reads exactly like the real client at the call sites.
  const withSingle = (q: Query) =>
    Object.assign(q, { single: () => (q as unknown as { single_: () => unknown }).single_() });

  return {
    db,
    control,
    client: {
      auth: {
        getUser: async () => ({ data: { user }, error: null }),
      },
      from(table: string) {
        db[table] ??= [];
        const rows = db[table];
        return {
          select: () => withSingle(new Query(rows, "select")),
          insert: (payload: Row) =>
            withSingle(new Query(rows, "insert", payload, undefined, control)),
          update: (patch: Row) => withSingle(new Query(rows, "update", patch)),
          upsert: (payload: Row, opts?: { onConflict?: string }) =>
            withSingle(new Query(rows, "upsert", payload, opts?.onConflict)),
        };
      },
    },
  };
}
