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
 *   from(t).delete().eq(c,v)...
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
  private setFilters: [string, unknown[]][] = [];
  // NOT named `single`: createFakeSupabase exposes a chainable `single()`
  // METHOD by Object.assign-ing it onto the instance, which would overwrite
  // a same-named boolean field and leave it permanently truthy — making
  // every query, including multi-row ones, return a single row.
  private wantsSingle = false;
  private sorts: [string, boolean][] = [];
  private rowLimit: number | null = null;

  constructor(
    private rows: Row[],
    private op: "select" | "update" | "upsert" | "insert" | "delete",
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

  /** Membership filter — used by cancelBooking to make the transition
   * conditional in the database rather than on a status it read a moment
   * earlier. Real membership semantics: a fake that matched everything would
   * turn that guard into a no-op and still let its test pass. */
  in(column: string, values: unknown[]): this {
    this.setFilters.push([column, values]);
    return this;
  }

  /** Real sort, not a no-op: a fake that silently ignores ordering would
   * let a test claim coverage of behaviour it never exercised. */
  order(column: string, opts?: { ascending?: boolean }): this {
    const ascending = opts?.ascending ?? true;
    this.sorts.push([column, ascending]);
    return this;
  }

  /** Real truncation, for the same reason. */
  limit(count: number): this {
    this.rowLimit = count;
    return this;
  }

  /** supabase-js `.returns<T>()` is a pure TypeScript assertion with no
   * runtime effect, so identity is the faithful implementation. */
  returns(): this {
    return this;
  }

  maybeSingle(): PromiseLike<Result<Row | null>> {
    this.wantsSingle = true;
    return this as unknown as PromiseLike<Result<Row | null>>;
  }

  /** Postgrest `.single()` — same as maybeSingle for our purposes. */
  single_(): PromiseLike<Result<Row | null>> {
    this.wantsSingle = true;
    return this as unknown as PromiseLike<Result<Row | null>>;
  }

  private matches(row: Row): boolean {
    return (
      this.filters.every(([c, v]) => row[c] === v) &&
      this.negativeFilters.every(([c, v]) => row[c] !== v) &&
      this.setFilters.every(([c, vs]) => vs.includes(row[c]))
    );
  }

  private run(): Result<unknown> {
    if (this.op === "insert") {
      if (this.control?.insertError) {
        return { data: null, error: this.control.insertError };
      }
      const row = { id: `row_${this.rows.length + 1}`, ...this.payload };
      this.rows.push(row);
      return { data: this.wantsSingle ? row : [row], error: null };
    }

    if (this.op === "select") {
      let found = this.rows.filter((r) => this.matches(r));

      for (const [column, ascending] of [...this.sorts].reverse()) {
        found = [...found].sort((a, b) => {
          const x = a[column];
          const y = b[column];
          if (x === y) return 0;
          // Nulls last regardless of direction, matching PostgREST's
          // nullsFirst: false default.
          if (x == null) return 1;
          if (y == null) return -1;
          return (x < y ? -1 : 1) * (ascending ? 1 : -1);
        });
      }

      if (this.rowLimit !== null) found = found.slice(0, this.rowLimit);

      return this.wantsSingle
        ? { data: found[0] ?? null, error: null }
        : { data: found, error: null };
    }

    if (this.op === "update") {
      const target = this.rows.filter((r) => this.matches(r));
      for (const row of target) Object.assign(row, this.payload);
      return this.wantsSingle
        ? { data: target[0] ?? null, error: null }
        : { data: target, error: null };
    }

    if (this.op === "delete") {
      for (let i = this.rows.length - 1; i >= 0; i--) {
        if (this.matches(this.rows[i])) this.rows.splice(i, 1);
      }
      return { data: null, error: null };
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
  /** Every GoTrue admin call made through this client, in order. */
  const authAdminCalls: { method: string; id: string; attrs: Record<string, unknown> }[] = [];

  // `single()` is a reserved-ish name on the class; expose it by wrapping so
  // the chain reads exactly like the real client at the call sites.
  const withSingle = (q: Query) =>
    Object.assign(q, { single: () => (q as unknown as { single_: () => unknown }).single_() });

  return {
    db,
    control,
    authAdminCalls,
    client: {
      auth: {
        getUser: async () => ({ data: { user }, error: null }),
        // The GoTrue admin surface. Only the calls the app actually makes are
        // modelled; each records its arguments so a test can assert that a
        // session was revoked rather than merely that a column was written.
        admin: {
          updateUserById: async (id: string, attrs: Record<string, unknown>) => {
            authAdminCalls.push({ method: "updateUserById", id, attrs });
            return { data: { user: { id } }, error: null };
          },
        },
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
          delete: () => withSingle(new Query(rows, "delete")),
        };
      },
    },
  };
}
