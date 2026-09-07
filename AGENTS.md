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
