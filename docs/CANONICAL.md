# Canonical RoyalPal repository

This file is the preservation record for the 24 September 2026 consolidation.

**There is one RoyalPal codebase:**

https://github.com/OmedAcademy/RoyalPal

`main` is the only branch anyone should build on. Tell any person or tool:
"Work on OmedAcademy/RoyalPal."

## What was audited

The authenticated account `OmedAcademy` had five repositories on 24 September 2026:

| Repository                         | RoyalPal? | Why                                                                |
| ---------------------------------- | --------- | ------------------------------------------------------------------ |
| `OmedAcademy/RoyalPal`             | Yes       | The tutoring marketplace. Only repository with this application.   |
| `OmedAcademy/Lingora`              | No        | Separate IELTS product. Create Next App readme. Not a marketplace. |
| `OmedAcademy/Barberly`             | No        | Separate product.                                                  |
| `OmedAcademy/Mastura`              | No        | Separate product.                                                  |
| `OmedAcademy/OmedAcademyPrototype` | No        | Early HTML prototype of Omed Academy, not RoyalPal.                |

No second RoyalPal repository, fork, or rename exists on this account. Unrelated
public repositories named `royalpalm` or `royalpalace*` belong to other people
and are not this product.

## What was ambiguous, and what this commit fixed

The ambiguity was inside this one repository, not between two repositories.

| Ref                           | Tip       | Date       | Commits | Files | Migrations | Relationship                        |
| ----------------------------- | --------- | ---------- | ------: | ----: | ---------: | ----------------------------------- |
| `main` (before)               | `60391d5` | 2026-07-18 |       3 |    51 |         11 | Scaffold plus the M1 schema only    |
| `feat/stripe-connect-express` | `548e997` | 2026-09-16 |      42 |   236 |         29 | Strict descendant of the old `main` |
| `claude/royalpal-wa6nzy`      | `ed4aee4` | 2026-09-20 |      82 |   467 |         46 | Strict descendant of both           |

`git merge-base --is-ancestor` was true for both older tips against
`ed4aee4`. Neither older branch had a commit the newer branch lacked.
Fast-forwarding `main` from `60391d5` to `ed4aee4` discarded no code.

`main` on GitHub was still the July scaffold, which is what
https://royal-pal.vercel.app was serving. The working marketplace lived only
on `claude/royalpal-wa6nzy`, so a clone of the default branch was not the
product.

## Preservation points

Annotated tags, pushed with this consolidation:

- `preserve/main-2026-07-18` → `60391d5`
- `preserve/feat-stripe-connect-express-2026-09-16` → `548e997`
- `preserve/claude-royalpal-wa6nzy-2026-09-20` → `ed4aee4`

The old branch names are left in place. They are not a second implementation.
Pull request #1 (`feat/stripe-connect-express`) is fully contained in `main`.

## What was not done

- No other OmedAcademy repository was modified or deleted.
- No database migration was applied. Production can still be behind `0028`–`0046`.
  Read `docs/MIGRATIONS.md` before touching it. Shipping this code is the step
  those migrations were waiting for; applying them is a separate, explicit step.
- Stripe was not called.
