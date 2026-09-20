# RoyalPal

## Usage rules

These exist because the weekly Claude usage allowance is a real constraint on
this project, and subagent fan-out is the most expensive way to work — each
spawned agent starts cold and re-derives context the session already holds.

- **Subagents may be used only one at a time, never in parallel, and only when
  a task cannot reasonably be done inline.** Prefer inline work, which reuses
  context already held.
- **Do not re-run the full test suite** unless a change requires it. Run only
  the test files affected by the change.
- **Prefer reading existing docs and reports** over re-deriving information.
  `docs/AUDIT-BACKLOG.md`, `docs/STATUS.md`, `docs/LAUNCH-STATUS.md`,
  `docs/MIGRATIONS.md` and `docs/deploy-0028-0041.md` already hold most of what
  a new session would otherwise rediscover.
