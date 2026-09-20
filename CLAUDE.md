# RoyalPal

## Usage rules

These exist because the weekly Claude usage allowance is a real constraint on
this project, and subagent fan-out is the most expensive way to work — each
spawned agent starts cold and re-derives context the session already holds.

- **Never spawn subagents or parallel agents** unless the user explicitly asks
  for them by name.
- **Do not re-run the full test suite** unless a change requires it. Run only
  the test files affected by the change.
- **Prefer reading existing docs and reports** over re-deriving information.
  `docs/AUDIT-BACKLOG.md`, `docs/STATUS.md`, `docs/LAUNCH-STATUS.md`,
  `docs/MIGRATIONS.md` and `docs/deploy-0028-0041.md` already hold most of what
  a new session would otherwise rediscover.
