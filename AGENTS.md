# Repository workflow

Before starting any backlog brick, refresh the repository from `main` first:

1. Require a clean working tree; never discard or overwrite another contributor's work.
2. Run `git fetch origin main`.
3. Rebase the current short-lived branch onto `origin/main`, or create the brick branch from
   `origin/main` when no feature work exists yet.
4. Re-open and re-read every file the brick will touch after the refresh. Do not rely on a stale
   copy, an earlier audit, or conversation context.
5. If `origin` or network access is unavailable, do not begin the brick. Report that the mandatory
   refresh could not be completed.

The detailed Git workflow remains in `CONTRIBUTING.md`.

## Project rules live elsewhere — read them before writing code

This file only covers the refresh discipline above. The rules that decide whether a change
is *correct* in this repository are not here:

- **`CLAUDE.md`** — the non-negotiable invariants: determinism of `packages/shared-core`
  (no `Math.random`, no `Date.now`, no implementation-approximated `Math.*`), purity of
  `applyAction`, modules talk only through the bus, fail-secure rejection (an error is a
  stable `E_*` code, never a leaked detail), server authority, fixed module order.
- **`CONTRIBUTING.md`** — the full Git and review regimen.
- **`.claude/skills/`** — the executable rituals: `brick` (take a backlog task),
  `localization` (player-visible text is a KEY, never a literal), `new-module`,
  `add-game-content`, `sync-state-doc`.
- **`docs/state.md`** — what is already built. Check it before building something twice.

Run `pnpm run check` (lint + typecheck + test + docs-check) before every commit; it is the
gate CI mirrors.
