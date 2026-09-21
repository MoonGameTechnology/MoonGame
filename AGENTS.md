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

## Task completion discipline

When a requested task is complete and ready for integration, do not leave the finished work only
on a feature branch and do not wait for a separate request to publish it.

1. Create the pull request immediately after the task is ready.
2. Make sure the PR contains the complete intended change and targets the current `main`.
3. Follow the PR through CI and review. If a check, conflict, permission error, or tool failure
   blocks it, make at most one retry of the same failed action; then report the exact blocker
   instead of looping.
4. When the PR is green and eligible, put it into the repository's merge queue / enable auto-merge
   so it is revalidated against fresh `main` and merged automatically.
5. A task is not considered fully handed off while completed code is stranded only in a branch.

## Project rules live elsewhere — read them before writing code

This file only covers the refresh and completion discipline above. The rules that decide whether a
change is *correct* in this repository are not here:

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
