# Applying migrations to production

**Production is on `0027`. Migrations `0028`–`0040` are not applied.**

> Verify rather than trust this line: **Admin → Diagnostics** probes the
> connected database for the table or column each late migration introduces
> and reports which are actually present.

That is thirteen migrations, and the order and the timing both matter — several
of them will break the live site if applied before the code that goes with
them is deployed.

---

## The rule that matters more than any other

> **Deploy the code first. Apply the migration second.**

Four of these migrations remove a permission the currently-deployed code still
relies on. Applying one of those before its code is live does not degrade the
site — it breaks the feature outright, for everyone, immediately.

| Migration | Removes                                             | Needs deployed first                                |
| --------- | --------------------------------------------------- | --------------------------------------------------- |
| `0028`    | Tutor writes to their own financial/Connect columns | `startTutorOnboarding` writing via the service role |
| `0029`    | Client INSERT on `bookings`                         | `createBooking` inserting via the service role      |
| `0030`    | Participant cancelling a **paid** lesson directly   | `cancelBooking` writing via the service role        |
| `0039`    | Signup without a date of birth                      | The signup form sending `date_of_birth`             |

`0039` is the one most likely to catch someone out: apply it before the new
signup form is live and **every new registration fails**, because
`handle_new_user` raises on the missing field inside the `auth.users` insert.

`0040` is a pure `revoke` and is additive in the same sense: it removes a
privilege no application code has ever used. Apply it in the same batch — it
closes an unauthenticated account-lockout path that arrives _with_ `0038`, so
never apply `0038` without it.

The other eight are additive — new tables, new columns, new policies — and
cannot break code that does not know about them.

### The window "deploy the code first" opens, and how to close it

The rule above is about the four that REMOVE a permission. The additive eight
run the other way: the deployed code **reads** the tables they create. Between
the deploy and the migrations, messaging, support, push registration,
rescheduling and the account-deletion screens all hit tables that do not exist
yet, and each answers with an error rather than degrading.

That is not a reason to reverse the order — reversing it breaks signup,
booking, cancellation and tutor onboarding for everyone, which is worse. It is
a reason to keep the window short and to know what it costs:

- Apply the migrations immediately after the deploy is confirmed live, in one
  sitting, not the next day.
- Do it at the quietest hour you have.
- Afterwards, open **Admin → Diagnostics**; it re-probes and will tell you if
  any of them did not land.

---

## Procedure

```bash
# 1. Take a backup, and confirm you can restore it. 0036 and 0037 are not
#    reversible by re-running anything.
#    Supabase Dashboard → Database → Backups

# 2. Deploy the application first.
git push            # → Vercel builds and promotes

# 3. Confirm the deployment is live and serving the NEW code before going on.

# 4. Apply the migrations, in order.
supabase link --project-ref <ref>
supabase db push
```

If `supabase db push` is not available, paste each file into the SQL editor **in
numeric order**. They are not independent: `0035` redefines a trigger `0008`
created, `0037` adds columns `0030`'s logic reads, and `0039` redefines the
function `0012` created.

---

## Verifying afterwards

Read-only. Run in the SQL editor; every row should read `PASS`.

```sql
select 'tables' as check,
       case when count(*) = 8 then 'PASS' else 'FAIL: ' || count(*) || '/8' end as result
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('support_tickets','support_messages','conversations','messages',
                      'push_tokens','notification_preferences','booking_reschedules',
                      'account_deletion_requests')
union all
select 'rls enabled everywhere',
       case when count(*) = 0 then 'PASS' else 'FAIL: ' || string_agg(relname, ', ') end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
union all
select 'age gate live',
       case when position('aged 18' in pg_get_functiondef(p.oid)) > 0
            then 'PASS' else 'FAIL: handle_new_user has no age check' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'handle_new_user'
union all
select 'booking client insert revoked',
       case when count(*) = 0 then 'PASS' else 'FAIL: authenticated can still INSERT' end
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'bookings'
   and grantee = 'authenticated' and privilege_type = 'INSERT'
union all
select 'reschedule function present',
       case when count(*) = 1 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'reschedule_booking'
union all
select 'rate limiter present',
       case when count(*) = 1 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'consume_rate_limit';
```

---

## Rolling back

There is no down-migration, deliberately: a generated `DROP` is exactly as
likely to destroy data as to undo a mistake.

- **Additive migrations** (`0031`–`0034`, `0038`) can be left in place. Redeploy
  the previous application build; the new tables sit unused.
- **Permission-removing migrations** (`0028`–`0030`, `0039`) must be undone by
  redeploying the previous code **and** re-granting by hand. The grant each one
  removes is named in the migration's own header comment.
- **`0036`/`0037`** add columns only, so the rollback is a code rollback.

Restoring the backup from step 1 is the answer when more than one of these has
gone wrong at once.

---

## `PENDING_MIGRATIONS_0028_0029.sql`

That file is a **paste-ready kit for `0028` and `0029` only**, written when
those were the only two outstanding. It is kept because its pre-check and its
seven-row verification are still correct for those two migrations, and it is
renamed so nobody mistakes it for the whole backlog. It does **not** cover
`0030`–`0039`. Use `supabase db push` and the verification above instead.
