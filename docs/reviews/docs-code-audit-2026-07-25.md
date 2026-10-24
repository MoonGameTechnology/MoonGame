# MoonGame — Code & Documentation Audit

**Date:** 2026-07-25
**Auditor:** opencode (GLM-5.2 via Hermes pipeline)
**Scope:** Full repository — 75 docs (1.9 MB) + 4 packages (26 741 LOC src) + prototype (30 972 LOC) + CI workflows + deploy artifacts
**Method:** Static review, cross-referencing docs against code, security control verification, threat-model gap analysis

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Repository Metrics](#repository-metrics)
3. [Findings by Severity](#findings-by-severity)
   - [Critical (1)](#critical)
   - [High (6)](#high)
   - [Medium (~18)](#medium)
   - [Low (~19)](#low)
4. [Architecture Assessment](#architecture-assessment)
5. [Security Posture](#security-posture)
6. [Determinism Posture](#determinism-posture)
7. [Documentation Quality](#documentation-quality)
8. [Top Fixes Before Public Launch](#top-fixes-before-public-launch)
9. [Final Verdict](#final-verdict)

---

## Executive Summary

**Overall grade: ⭐⭐⭐⭐ of 5** — production-grade codebase and documentation with a systemic "built ≠ enabled" pattern and several stale sections.

The MoonGame / "Void Dominion" repository is an exceptionally mature TypeScript monorepo for a real-time multiplayer space strategy game. The code quality rivals commercial production systems: zero ESLint errors, TypeScript strict mode, test-to-source ratio >1.1, property-based testing with fast-check, golden tests for determinism, eight SAST/SCA/secret-scan tools in CI. The documentation is comprehensive (75 files, 1.9 MB) and unusually self-aware — unfinished work is honestly marked ⏳/🔒.

However, the audit found **one critical** and **six high-severity** issues:

- **Critical S1**: The anti-cheat action gate (`GATE=1`), the desync detector (`emitStateHash`), and JWT auth are all **opt-in env flags**. The canonical deploy path (`render.yaml`, `launch-runbook.md` quick-start) sets none of them. The architecture doc presents these as foundational invariants, but a default deploy silently degrades to "trust the client".
- **High C2/C3**: GDD describes a victory threshold of 600 and `timeScale` up to ×4; the code uses 1100 and up to ×100. All GDD §3.1–3.3 numeric examples are wrong.
- **High S5**: The desync detector that the architecture calls the "residual risk catcher" for the `Math.sqrt` cross-engine determinism claim is **off by default** in production.
- **High SEC-A06-5**: `market.list.price` accepts `0` (free listings) — the documented anti-wash-trade guard (`price ≥ 1`) is not enforced.
- **High SECURITY.md**: Claims "scanner Docker images are digest-pinned" — false for 4 of 7 scanners (gitleaks, osv-scanner, trivy, syft are tag-pinned). A compromised tag = RCE in CI.

The systemic root cause is a pattern the project's own master plan identifies (`security-master-plan.md:61-63` "Разрыв — построено ≠ включено"): controls are built correctly but left opt-in, while docs present them as enforced. This is acknowledged in the master plan but not fixed in the deploy artifacts.

**Top 4 fixes before any public launch:**
1. `PROD=1` + `AUTH_JWT_SECRET` + `GATE=1` + `SEAT_LOCK=1` defaults in `docker-compose.yml` and `render.yaml` (fail-secure).
2. `emitStateHash: true` default in production.
3. `payloadSchemas.ts:95` `.min(1)` for `market.list.price`.
4. Digest-pin the 4 remaining scanner images or correct `SECURITY.md` wording.

---

## Repository Metrics

| Metric | Value | Grade |
|---|---|---|
| Source code (packages/) | 26 741 LOC | Large project |
| Tests (packages/) | 29 505 LOC | Tests > code (1.1:1) |
| Total .ts files | 242 | — |
| Test cases | 1 868 (1815 pass, 53 skip, 0 fail) | 🟢 |
| Property-based tests (fast-check) | 4 files | 🟢 rare |
| ESLint errors | **0** | 🟢 |
| TypeScript strict | ✅ | 🟢 |
| TODO/FIXME/HACK markers | **0** across entire repo | 🟢 unusual |
| Files >1000 lines (packages/) | **2** (matchRoom, postgres) | 🟢 |
| Gameplay modules | 25 (data-driven) | 🟢 |
| Game data | 22 JSON files, 112 KB | — |
| Docs | 75 files, 1.9 MB | 🟢 comprehensive |
| CI security tools | 8 (Semgrep, CodeQL, Trivy, OSV, Gitleaks, TruffleHog, zizmor, SBOM) | 🟢 enterprise |

---

## Findings by Severity

### Critical

#### S1 — Anti-cheat gate is opt-in (GATE=1), default-off in canonical deploy

**Severity:** Critical
**Files:** `prototype/netserver.ts:122`, `prototype/netserver.ts:371`, `packages/server/src/serverConfig.ts:168`, `docs/launch-runbook.md:22`, `deploy/render.yaml`, `deploy/docker-compose.yml:49`

**What's wrong:**
The `ActionGate` (envelope validation, authorization, idempotency, monotonic `clientSeq`) is conditionally constructed — only when `GATE === '1'` or `'true'`. Without it, the bare `submitAction` path (`matchRoom.ts:914`) accepts unvalidated `action` messages with only an `action.playerId === playerId` check.

- `prototype/netserver.ts:122`: `const GATE = process.env.GATE === '1' || process.env.GATE === 'true';`
- `prototype/netserver.ts:371`: `...(GATE ? { gate: new ActionGate(...) } : {})` — gate is conditionally constructed.
- `packages/server/src/serverConfig.ts:168`: `if (!(env.GATE === '1' || ...)) missing.push('GATE=1')` — production config flags missing GATE, but it is a "missing" warning, not a hard refusal to start.
- `prototype/netserver.ts:14`: "the `?player=` handshake is unauthenticated" (default config).

The architecture's "Золотое правило мультиплеера" (`architecture.md:218`: "Клиент НИКОГДА ничего не решает. Сервер решает.") and the action-layer promise (`roadmap.md:89-101`) are only enforced when an operator remembers to set two env vars. `docker-compose.yml` defaults `GATE=1` (good), but `render.yaml` and `launch-runbook.md` quick-start do not. `PROD=1` (the fail-closed guard) is not set in any shipped deploy artifact — so `checkProductionReadiness` returns `{ok:true}` and the launch guard never fires.

**Impact:** A misconfigured deploy silently degrades to "trust the client" — the opposite of the documented invariant. Combined with S5 (desync detector default-off), a production deploy can have both the anti-cheat gate and the desync detector off, while docs claim both are protecting integrity.

**Fix:**
- (a) Flip the default: gate ON, with `GATE=0` required to *disable* it for dev (fail-secure).
- (b) Make `packages/server/src/main.ts` refuse to boot if `GATE=1` is unset and `NODE_ENV=production` (currently only `missing.push()` warns).
- (c) Set `PROD=1` in `docker-compose.yml` and `render.yaml`, or have `launch-runbook.md` quick-start require `PROD=1 AUTH_JWT_SECRET=<random> GATE=1 SEAT_LOCK=1` before any public bind.
- (d) State explicitly in `architecture.md` that the gate is default-off in dev and must be flipped for any external-facing host.

---

### High

#### C2 — Victory score threshold: GDD says 600, code says 1100

**Severity:** High
**Files:** `docs/gdd.md:65,94,96` vs `docs/game-description.md:40,118` vs `prototype/src/game.ts:3836`

**What's wrong:**
- `docs/gdd.md:65` ("Игрок: 600 очков → немедленная победа"), `:94` ("порог_коалиции = 600 × N × 0.7"), `:96` ("2 игрока: 840 (420/игрока — выгоднее чем 600 соло)").
- `docs/game-description.md:40,118` say **"финал на 1100"** / **"счёт 1100"**.
- `prototype/src/game.ts:3836`: `export const SCORE_LIMIT = 1100;`
- `prototype/src/tax.test.ts:29`: `expect(SCORE_LIMIT).toBe(1100)`.

The GDD's coalition formula and "600 соло" framing are derived from a stale 600 baseline that the implementation never used (or has long since replaced). Every numeric example in GDD §3.1–3.3 is wrong.

**Fix:** Rewrite GDD §3.1–3.3 with `scoreLimit = 1100` (the configurable default), recompute coalition examples: solo 1100, 2-player coalition `1100 × 2 × 0.7 = 1540` (770/player). Note in `packages/shared-core/src/action/types.ts:33-35` the threshold is already parameterized as `scoreLimit` in `MatchConfig.victory`, so the GDD should frame 1100 as the default, not a constant.

---

#### C3 — `timeScale` range: GDD says ×1/×2/×4, game-description says up to ×100

**Severity:** High
**Files:** `docs/gdd.md:49-58` vs `docs/game-description.md:46` vs `packages/server/src/matchRoom.test.ts:1019,1039`

**What's wrong:**
- `docs/gdd.md:49-58` lists a 3-row table with `×1 → 100 days`, `×2 → 60`, `×4 → 30`. The whole GDD framing assumes a small multiplier.
- `docs/game-description.md:46`: "до ×100 — вечерняя партия".
- `packages/server/src/matchRoom.test.ts:1019,1039` exercise `timeScale: 100`; `:761` exercises `timeScale: 10`.
- `packages/shared-core/src/action/types.ts:67` only clamps non-positive to 1, no upper bound.

The "×100" claim is correct; the GDD's 3-row table is stale.

**Fix:** Update GDD §3.1's table to a wider range (×1 … ×100) with the new "days to crisis" column, or explicitly mark ×1/×2/×4 as "recommended defaults" and state that the engine accepts any positive `timeScale`. Reconcile both docs to one statement.

---

#### C4 — Client-prediction + rollback: architecture forbids it, engineering-risks mandates it

**Severity:** High
**Files:** `docs/architecture.md:499` vs `docs/engineering-risks.md:96-120`

**What's wrong:**
- `docs/architecture.md:499` (table row "Client-prediction + rollback reconciliation"): "Для мгновенного движения в шутере/RTS. Флот летит реальные часы — **предсказывать нечего**, лага движения нет." — listed under "Чего НЕ делаем".
- `docs/engineering-risks.md:96-120` ("11. Action latency and optimistic UI") instructs the **opposite**: "the client applies actions *optimistically* using the same `shared-core` reducer ... On reject the client **rolls back** to the pre-action state."

These are mutually exclusive design positions presented as decisions. A developer reading both cannot know which is canon.

**Fix:** Reconcile. The likely resolution: "client *preview* of own intent" (already endorsed at `architecture.md:109` and `engineering-review.md:210`) is allowed for the local action's immediate effect, while "client-prediction of the *world clock*" is forbidden (which `engineering-risks.md:117` itself states). Rewrite `architecture.md:499` to distinguish "predict the world" (forbidden) from "optimistically apply own intent, reconcile on ack" (the engineering-risks decision), and cross-link the two docs.

---

#### S5 — `emitStateHash` (desync detector) defaults to OFF in production

**Severity:** High
**Files:** `packages/server/src/matchRoom.ts:442`, `packages/server/src/scenario.ts:259`, `docs/architecture.md:505`

**What's wrong:**
- `docs/architecture.md:505` claims: "Остаточный риск ловит desync-детектор `hashState` (опц. `emitStateHash` на сервере)."
- `packages/server/src/matchRoom.ts:442`: `this.emitStateHash = options.emitStateHash ?? false;` — defaults to `false`.
- `prototype/netserver.ts:351` sets `emitStateHash: true` (prototype only), but `packages/server/src/scenario.ts:259` (the only non-test `new MatchRoom` in `packages/server`) and `main.ts` do not set it.

In production, the desync detector that the architecture calls the "residual risk catcher" is silently disabled. Combined with S1, a production deploy can have both the anti-cheat gate and the desync detector off, while docs claim both are protecting the integrity invariant.

**Fix:** Default `emitStateHash` to `true` in production (`NODE_ENV=production`), or at minimum log a warning when it is off. Update `architecture.md:505` to state the default explicitly rather than "опц."

---

#### SEC-A06-5 — `market.list.price` accepts 0 (free listings)

**Severity:** High
**Files:** `docs/security-a06.md:70-75`, `packages/shared-core/src/actions/payloadSchemas.ts:95`

**What's wrong:**
- `docs/security-a06.md:70-75` (SEC-A06-5) states the cheap guard "сейчас — `price ≥ 1` (запрет буквально-бесплатных листингов)".
- The actual schema at `packages/shared-core/src/actions/payloadSchemas.ts:95` is `price: z.number().finite().nonnegative()` — this **allows `price: 0`**.
- The test at `payloadSchemas.test.ts:174` only rejects `price: -1`, not `price: 0`.

Free listings are wire-legal — a documented wash-trade / resource-transfer vehicle (once alts exist).

**Fix:** Change `.nonnegative()` to `.min(1)` (or `.positive()`) on `market.list.price` and add a test for `price: 0` rejection.

---

#### SECURITY.md:70-71 — "scanner Docker images are digest-pinned" is false for 4 of 7 scanners

**Severity:** High
**Files:** `SECURITY.md:70-71`, `docs/security/setup-github-secrets.md:105`, `.github/workflows/security.yml:203,279,327,378,381,486`, `docs/security/image-pinning.md:42-49`

**What's wrong:**
- `SECURITY.md` states "GitHub Actions are SHA-pinned and scanner Docker images are digest-pinned".
- Reality (`security.yml`): only `semgrep`, `trufflehog`, `zizmor`, `zaproxy` are `@sha256:`-pinned.
- `gitleaks:v8.18.4`, `osv-scanner:v1.9.1`, `trivy:0.58.2`, `syft:v1.20.0` are **TAG-pinned**.
- `docs/security/image-pinning.md:42-49` is honest about this (marks 4 as "⚠️ TAG"), but `SECURITY.md` and `setup-github-secrets.md` overstate the posture.

A compromised scanner tag = RCE in CI with source mounted (`-v "$PWD:/src"`).

**Fix:** Run `./.github/scripts/update-image-digests.sh`, replace the 4 tag pins with `@sha256:` digests. Correct `SECURITY.md` wording to "partially digest-pinned" until done.

---

#### T1 — No threat model for player-hosted matches (host = adversary)

**Severity:** High
**Files:** `docs/architecture.md:218-228`, `docs/engineering-risks.md`, `prototype/netserver.ts`, `docs/game-description.md:51,58`

**What's wrong:**
- `docs/architecture.md:218-228` frames the threat model as "client = adversary, server = authority". `engineering-risks.md` assumes the server operator is trusted.
- The project ships `prototype/netserver.ts` which any player can run as a host (`pnpm host`). `docs/game-description.md:51,58` describe player-hosted matches.
- A player-hosted server can trivially cheat (it is authoritative). The docs treat "server-authority" as the anti-cheat, but never address that *whoever runs the server* is the authority.
- `SEAT_LOCK` (backlog.md REL-5) protects seat *occupancy* but not *integrity of state the host serves to guests*.

A guest player reading the anti-cheat claims will wrongly believe they are protected from their host.

**Fix:** Add a section to `architecture.md` §5 or `engineering-risks.md` distinguishing: (a) first-party-hosted matches (server operator = trusted, the model the docs assume), (b) player-hosted matches (host = a player, guests must trust host). For (b), state explicitly that guests have no integrity guarantee against a malicious host and that this is accepted for the playtest phase.

---

### Medium

#### C1 — Core module count disagrees across three docs

**Files:** `docs/game-description.md:101,118` (27), `docs/readiness.md:14` (24), `docs/state.md:98` (24), reality: **25**

`ls packages/shared-core/src/modules/*.ts | grep -v test` returns 25: army, arsenalSync, artillery, captureOnArrival, combat, construction, diplomacy, economy, effects, espionage, faction, hero, heroEffects, intercept, market, movement, orbital, planetType, scientist, sector, station, steward, technology, victory, visibility.

**Fix:** Pick one source of truth (`state.md`'s enumeration). Update `game-description.md 27 → 25`, `readiness.md 24 → 25`, `state.md 24 → 25`.

---

#### C5 — Persistence recommendation: open-questions recommends SQLite, decision log says PostgreSQL

**Files:** `docs/open-questions.md:36-38,57` (SQLite) vs `:159-172` (decision A2: PostgreSQL)

The "Решения (2026-06-26)" section records the decision as PostgreSQL, but the prototype SQLite recommendation above was never struck through.

**Fix:** Strike through the SQLite recommendation at `open-questions.md:36-38` and `:57` with a "superseded by A2 (PostgreSQL)" note, the way `gdd.md:157` marks superseded sections.

---

#### C7 — `pnpm audit` script still in package.json, docs say retired

**Files:** `docs/tech-stack.md`, `README.md:171`, `CLAUDE.md:56-57` (retired) vs `package.json:31` (`"audit": "pnpm audit --audit-level=high"`)

**Fix:** Remove the `audit` script from `package.json` or add a `## ⚠ npm audit endpoints are shut down; use OSV-Scanner via CI` comment.

---

#### S2 — `eventVisibleTo` is a security boundary, but adding a new payload key silently hides events

**Files:** `docs/modulesystem.md:163-179`, `packages/server/src/matchRoom.ts:1575`

The convention (events fog-filtered by payload key names: `owner`, `playerId`, `a`, `b`, `from`, `to`, `buyer`, `seller`, `location`, `planetId`, `at`, `fleetId`) is enforced only by code review + a per-feature test. There is **no static check** (lint rule, zod schema, or type) that requires a new event's payload keys to be in the allow-list. A new module author who emits `{ recipient: playerId }` gets silent event loss with no compile-time signal.

Fail-closed for confidentiality (good), but fail-closed-by-omission is fragile: the safety property rests on an undocumented convention.

**Fix:** Add a lint rule or unit test fixture that fails if any `emit(...)` payload uses a key not in the documented set without a corresponding `eventVisibleTo` test. Surface the convention in `modulesystem.md` as a mandatory step in the "new module" checklist.

---

#### S3 — `isBuildable` / `hasOrbit` exported but not enforced as server-side guards

**Files:** `packages/shared-core/src/state/sectorKind.ts:43,48`, `index.ts:67-68`, `packages/shared-core/src/modules/construction.ts:255-257`, `docs/open-questions-visuals-content-pings.md:42-48` (self-admission B2)

`isBuildable`/`hasOrbit` are exported and consumed in `prototype/src/game.ts:1250-1251,1553` **only for display/UI gating**. `grep -rn 'isBuildable\|hasOrbit' packages/shared-core/src/modules/` returns nothing — no core module calls them. `construction.ts:255-257` only checks `allowedBuildings` (a roster), not `isBuildable`. A `debris_field` planet kind (`buildable:false`) can be built on at the core level if it appears in a building roster.

The doc's "works through captureOnArrivalModule" claim for `capturable` may hold, but `buildable`/`orbit` are dead flags sold as rules.

**Fix:** Add the one-line guard: `if (!isBuildable(h.ctx.data, planet)) return h.reject('E_NOT_BUILDABLE')` in `construction.ts` `building.construct`/`building.upgrade`/`unit.build`. Until then, mark `buildable`/`orbit` in `data/schemas.ts` as "UI hint, not enforced".

---

#### S4 — `unit.build` has no per-build queue guard against double-spend

**Files:** `packages/shared-core/src/modules/construction.ts:336-380`, `docs/engineering-review.md:377-379`

`building.construct` (L263-264) and `building.upgrade` (L309-310) **do** guard with `isQueued(...) → E_ALREADY_QUEUED`. But `unit.build` (L336-380) has **no** `isQueued` guard. Two `unit.build` for the same unit on the same planet both pass `canAfford` and both call `payCost`. The action-layer's per-player serialization saves this in production, but dev mode (`GATE=0`) removes that backstop (see S1).

**Fix:** Update `engineering-review.md` item 2 to mark `building.construct`/`building.upgrade` as fixed. Add `isQueued('unit', planetId, unit)` guard to `unit.build` for defense-in-depth.

---

#### S6 — JWT secret has no documented minimum strength / boot-time check

**Files:** `docs/architecture.md:306`, `packages/server/src/serverConfig.ts:168`

`AUTH_JWT_SECRET` is checked for *presence*, but there is no check for **strength** (length, entropy). `AUTH_JWT_SECRET=secret` would presumably boot if present.

**Fix:** Add a boot-time guard in `serverConfig.ts`: refuse to start in production if `AUTH_JWT_SECRET` is shorter than N bytes / matches a denylist (`secret`, `changeme`, etc.).

---

#### S7 — WS Origin allowlist only checked when `AUTH` is on

**Files:** `prototype/netserver.ts:218-221`, `docs/architecture.md:288,456`

`const AUTH = authCfg.auth !== undefined; ... if (AUTH && !authCfg.allowedOrigins) {...}` — the Origin allowlist (CSWSH defense) is only enforced when auth is on. A dev-mode server (`AUTH` unset) accepts WebSocket upgrades from any Origin. `architecture.md:288` claims "CORS строго (только домен клиента)" as a baseline, not conditional.

**Fix:** Decouple Origin allowlist from `AUTH`. Even unauthenticated playtest servers should reject cross-origin upgrades unless `ALLOWED_ORIGINS=*` is explicitly set. Document in `architecture.md` §8.

---

#### S8 — No per-account action rate limit at the action-layer

**Files:** `docs/architecture.md:236`, `docs/engineering-review.md:93`, `packages/action-layer/src/`

The architecture doc describes per-account action rate limiting as critical. The server has `@fastify/rate-limit` (HTTP-layer) and `matchRoom.ts:1042-1047` (per-action throttle, 20/1000ms). The "Rate limiting на аккаунт" promise (`architecture.md:236`) is enforced at the match-room level, not at the action-layer where the doc claims it lives.

**Fix:** Move the `architecture.md` claim to "HTTP/match-room layer; per-account action throttling is match-room-enforced", or implement in action-layer.

---

#### ST1 / ST4 — `roadmap.md` and `architecture.md` §3 still list BullMQ/Redis

**Files:** `docs/roadmap.md:115,122`, `docs/architecture.md:121,123,124` vs `docs/tech-stack.md:42` ("Нет Redis и BullMQ — от них отказались осознанно.")

`architecture.md §3` header has a supersession note pointing to `tech-stack.md`, but the table below contradicts its own header. `roadmap.md` has no such note.

**Fix:** Add the same supersession banner to `roadmap.md` Stage 3 deliverables. Update `architecture.md` §3 table to match `tech-stack.md` (planner: in-process `clockDriver` → pg-boss; cache: none → Postgres LISTEN/NOTIFY; hosting: drop "managed Redis").

---

#### ST2 — `engineering-review.md` §8 item 2 "double building order" is stale

**Files:** `docs/engineering-review.md:377-379` vs `packages/shared-core/src/modules/construction.ts:263-264,309-310`

The doc says "Two `building.construct` of one type before the first completes will deduct resources twice" and item 2 is not in the "УЖЕ СДЕЛАНО" list. Reality: `construction.ts:263-264` (`building.construct`) and `:309-310` (`building.upgrade`) implement `isQueued(...) → E_ALREADY_QUEUED`. Item 2 is **done for buildings** (but see S4 for `unit.build`).

**Fix:** Strike item 2 from the "still open" list and add it to the "УЖЕ СДЕЛАНО" note with a pointer to `construction.ts:263`. Note the `unit.build` gap separately.

---

#### ST3 — `engineering-review.md` §3.2 table lists built features as "to build"

**Files:** `docs/engineering-review.md:131-138` vs `:122-129` (note says built) vs `docs/readiness.md:23` (confirms live)

The table rows "Движок трейтов / Фракции как механика / Дипломатия" describe what to build, but the note above says they are built (`effectsModule` EFX-1, `factionModule`, `diplomacyModule`). The table was not updated.

**Fix:** Mark the three rows as ✅ in-place, or remove them and keep only the note.

---

#### MP-1 — `PROD=1` not set in any shipped deploy artifact

**Files:** `deploy/docker-compose.yml`, `deploy/render.yaml`, `docs/launch-runbook.md:22`

`docker-compose.yml` defaults `GATE=1` and `SEAT_LOCK=1` (good), but `AUTH_JWT_SECRET` defaults empty (no auth), `TRUST_PROXY` defaults empty (no proxy header trust), and `PROD` is **not set** — so `checkProductionReadiness` (`serverConfig.ts:162-164`) returns `{ok:true}` and the launch guard never fires. `render.yaml` sets only `HOST: 0.0.0.0` — no GATE, no SEAT_LOCK, no AUTH, no PROD.

The master plan (`security-master-plan.md:97-99`, MP-1) claims "Secure-by-default launch guard ✅" and "PROD=1 fail-closed without auth+gate+TLS+seat-lock". The guard exists but is opt-in via `PROD` — none of the shipped deploy artifacts set `PROD=1`.

**Fix:** Set `PROD=1` in `docker-compose.yml` and `render.yaml`. At minimum, add a loud stderr warning when `HOST=0.0.0.0` and `AUTH_JWT_SECRET` is unset.

---

#### CI — `security.yml` has no `pull_request` trigger; gating relies on unconfigured branch protection

**Files:** `.github/workflows/security.yml:52-55`, `.github/CODEOWNERS` (fully commented out), `docs/secure-sdlc-roadmap.md:78-79`

`security.yml` triggers on `push: branches: ['**']` + `workflow_dispatch`. There is no `pull_request` trigger. The blocking scanners (semgrep/gitleaks/osv/trivy) only block the *push*, not a PR merge — unless branch protection requires these as status checks. `CODEOWNERS` is fully commented out. `docs/secure-sdlc-roadmap.md:78-79` admits this is a manual UI step that may not be done.

**Fix:** Add `pull_request:` to `security.yml` triggers. Activate `CODEOWNERS`. Configure required checks via branch protection (or via GitHub API as code).

---

#### A06-4 — `aggressive` artillery fires on peace partners; war gate not implemented

**Files:** `docs/security-a06.md:62-68` (SEC-A06-4 ⏳), `packages/shared-core/src/actions/payloadSchemas.ts:39`

The doc states "`aggressive`-артиллерия бьёт партнёра по миру без ответного огня" and the fix is to gate it behind war. `payloadSchemas.ts:39` accepts `mode: z.enum([...,'aggressive'])` with no stance check at the schema level. BF-6 (PR #175) fixed `fleet.engage` ignoring diplomacy, but the artillery barrage against a peace partner is the remaining gap (⏳ in doc).

**Fix:** In the artillery handler, reject `aggressive` mode fire against a non-war target.

---

#### Auth — No session revocation without password reset; no "logout everywhere"

**Files:** `packages/server/src/auth.ts:136-140`, `docs/main-menu.md:126` (AC-2.1 🔒)

Session tokens carry a `pwfp` fingerprint; `liveSession` re-checks it against the current hash, so a password reset revokes all sessions. But there is **no way to revoke a session WITHOUT changing the password**. A stolen 7-day session token (`SESSION_TTL_SEC = 7*24*3600`, `serverConfig.ts:54`) is valid until expiry unless the user resets their password.

**Fix:** Add a `sessions` table or a `token_revoked_after` timestamp on the account; check it in `liveSession`.

---

#### D3 — `Math.sqrt` bit-exactness is spec-claimed, not tested cross-engine

**Files:** `docs/architecture.md:505`, `docs/tech-stack.md:19`, `packages/shared-core/src/state/route.ts:19`

The docs frame `Math.sqrt` as a *guarantee* (IEEE-754 correctly-rounded, ECMA-262 does not list it as implementation-approximated). The guarantee is only as good as V8/JSC/Hermes compliance. `state/route.ts:19` is the only `Math.sqrt` in the core. The doc says the residual risk is caught by `emitStateHash` — but per S5, `emitStateHash` defaults to OFF.

**Fix:** Either (a) flip `emitStateHash` default to ON (see S5), or (b) add a cross-engine golden test that runs `hashState` on a fixed `GameState` containing a computed `Math.sqrt` route distance and asserts byte-identical output across Node/V8 + headless JSC/Hermes.

---

#### D4 — No test that `advanceTo` is deterministic under long offline catch-up

**Files:** `docs/engineering-risks.md:39-50`, `docs/open-questions.md:255-259` (PA-4.2 🔒)

The determinism of the *catch-up path* (the one that runs when a player reconnects after hours offline — the core async-genre scenario) has no golden test. The existing `rng.test.ts` golden covers RNG stream order, not the `advanceTo` event ordering over a multi-event span. `engineering-risks.md:82` warns "Never compute offline income from only the final ownership snapshot" but no test asserts the chronological-segment invariant.

**Fix:** Write the PA-4.2 golden test the open-questions doc scopes: seed a match, run `advanceTo` to t3 in one call; reload state at t1, run `advanceTo` to t2 (capture), persist, reload, run `advanceTo` to t3; assert `hashState` identical.

---

### Low

(Concise list — see detailed subagent reports for full evidence.)

| ID | Issue | File |
|---|---|---|
| C6 | Test counts disagree across three docs (1400+, ~1554, actual ~1815) | readiness.md, engineering-review.md, game-description.md |
| C7 | `pnpm audit` script still in package.json | package.json:31 |
| BR1 | `gdd.md:188,244` references `core-engine.md` and `data-schemas.md` — never created | gdd.md |
| BR2 | `modulesystem.md:178` references a test convention that is unenforceable | modulesystem.md |
| BR3 | `open-questions.md` references PR #24 as both open and closed | open-questions.md |
| BR4 | `gdd.md:244` references `data-schemas.md` for artillery vulnerability rule (file doesn't exist) | gdd.md |
| D1 | README undersells determinism rules (only mentions Math.random/Date.now, not the banned transcendentals) | README.md:46 |
| D2 | `Math.round` allowed in code, not in `architecture.md:505` allow-list | architecture.md:505, technology.ts:298 |
| D5 | No test that `kernel.manifest` equals actual handler firing order | kernel.test.ts |
| ST5 | `engineering-review.md:86` lists `pnpm audit` in CI (retired) | engineering-review.md |
| ST6 | `open-questions.md` is a frozen 2026-06-26 snapshot with many "отложено" items now done | open-questions.md |
| ST7 | `engineering-review.md:321` still says "BullMQ scheduler" | engineering-review.md |
| T3 | No threat model for ping-based traffic analysis / timing side channels | open-questions-visuals-content-pings.md |
| T5 | No threat model for `EphemeralStore` → Redis replacement security properties | tech-stack.md |
| T6 | Stale docs directly cause AI agents to generate code against the wrong stack | meta |
| O1 | `engineering-review.md:3-4` line counts are stale (~7600 / ~1554) | engineering-review.md |
| O2 | `readiness.md:25` claims "35 test files" for prototype — actual is more | readiness.md |
| O3 | `architecture.md:4` "Void Dominion (можно заменить)" — name is committed everywhere | architecture.md |
| O4 | `gdd.md:157` supersession pattern should be adopted repo-wide (positive) | process |
| O5 | `modulesystem.md:165` omits file path for `eventVisibleTo` | modulesystem.md |
| O6 | `open-questions-visuals-content-pings.md:71` claims pings only touch sim at one point — unverified | open-questions-visuals-content-pings.md |
| O7 | `versioning.md` §3 post-match rewards decision not cross-linked from GDD §3.4 | gdd.md |
| O8 | `engineering-risks.md:21` read-path transaction isolation level not documented | engineering-risks.md |
| Mobile | `capacitor.config.json:6-7` `cleartext: true` — APK allows plain HTTP/WS | mobile/capacitor.config.json |
| Docker | `docker-compose.yml` no `read_only`/`cap_drop`/`no-new-privileges` at runtime | deploy/docker-compose.yml |
| Process | No `uncaughtException`/`unhandledRejection` handler (audit A10-2 still live) | netserver.ts:839, main.ts:512 |
| Postgres | `migrate()` runs on every boot, not transactional, no migration role separation | store/postgres.ts:51 |
| Postgres | App role is DB owner (superuser-equivalent), not least-privilege | docker-compose.yml:88 |
| Auth | `MAILER_LOG_BODY=1` puts account-takeover token in stderr/logs | authApi.ts:33-40 |
| Auth | No email verification on registration; recovery email unverified | authApi.ts:154-185 |
| Matchmaking | BF-23 "doctrines inert" framed as ✅ — design issue persists by decision | bughunt-2026-07-10.md |
| android.yml | Stale personal branch `claude/awesome-bohr-ygnunp` triggers APK builds | android.yml:21 |
| android.yml | Debug keystore is committed; "signature check" only proves it matches the committed key | android.yml:150-178 |

---

## Architecture Assessment

### Strengths

1. **Deterministic kernel** (`shared-core`) — pure function `(state, action, context) → result`. No `Math.random()`/`Date.now()` in core, only seeded PRNG (sfc32) with state serialized in `GameState`. Enables replay, client preview, anti-cheat.
2. **Microkernel + 25 modules through bus** — modules communicate only via `emit/hook/capability`, none imports another. New mechanic = +1 module + data, kernel untouched. Production-grade framework pattern.
3. **Server-authority + fog of war as security boundary** — server physically does not send invisible state (`visibleState` projection at broadcast). Correct model for multiplayer (vs "send everything, hide on client").
4. **Data-driven core** — units/buildings/technologies in JSON, validated via zod. New content = data edit, not code.
5. **Server-authority with action-layer gate** — envelope validation, zod payload schemas, idempotency receipts, monotonic `clientSeq`. When `GATE=1` is on, the integrity story holds.

### Weaknesses

1. **"Built ≠ enabled" pattern** — gate, desync detector, Origin allowlist, JWT all implemented correctly but opt-in. The architecture doc presents them as foundational invariants.
2. **No threat model for player-hosted matches** — see T1.
3. **Two files >1000 lines in packages/** — `matchRoom.ts` (1832) and `postgres.ts` (1678). Logically cohesive but hard to review.
4. **`prototype/src/main.ts` (14 635 lines)** — main technical debt. README honestly admits prototype is throwaway, `packages/client` is the production path.

---

## Security Posture

### Strengths

- **JWT with pinned `algorithms` allowlist** — alg-confusion (`none` attack) impossible. Three distinct `typ` claims prevent key reuse.
- **scrypt for passwords** (not bcrypt, no native deps), `timingSafeEqual`, **decoy hash** for timing equalization (login-miss and wrong-password indistinguishable by time).
- **All SQL parameterized** (`$1, $2, ...`), zero concatenation. 1678 lines Postgres — 0 SQLi vectors.
- **Origin allowlist** at WS upgrade (when AUTH is on).
- **Per-action rate limit + per-socket flood cap + MAX_MATCHES = 1000**.
- **CI security pipeline**: 8 tools (Semgrep, CodeQL, Trivy, OSV, Gitleaks, TruffleHog, zizmor, SBOM) — enterprise-grade.
- **0 `eval`/`child_process`/`Function()` in production code** (only in prototype dev harnesses for tests).
- **Docker images digest-pinned** (base images), non-root runtime, HEALTHCHECK.
- **OIDC correctly used** for cosign + scorecard with `id-token: write`.

### Gaps (besides findings above)

- **No threat model for Steward abuse** (always-on defensive bot, tactical AI-substitute to dodge losing battle).
- **Receipts durable store lacks type/payload/time** — audit-replay of suspicious match from DB is impossible (RPL-5 🔒, acknowledged).
- **DAST scans insecure config** (auth/gate off), not the release posture — `security.yml:425-433`.
- **`uncaughtException`/`unhandledRejection` not handled** — one unhandled rejection kills all in-memory matches (audit A10-2 unfixed).
- **Postgres app role is DB owner** (superuser-equivalent), no least-privilege separation.
- **`migrate()` not transactional** — failed migration leaves partial schema.

---

## Determinism Posture

### Strengths

- **ESLint determinism rules** — ban `Math.random`, `Date.now`, global `Date`, AND approximated transcendentals (`acos, asin, atan, atan2, cbrt, cos, cosh, exp, expm1, hypot, log, log10, log1p, log2, pow, sin, sinh, tan, tanh`). `Math.sqrt` deliberately allowed (IEEE-754 correctly-rounded). This is stronger than the README claims.
- **Seed RNG (sfc32)** — bit-exact across JS engines via integer-only ops (`| 0`, `>>> 0`, `Math.imul`). State serializable. Golden-locked.
- **Property-based tests** (fast-check) for invariants: `advanceTo`, `applyAction`, `delta`, economy conservation.
- **Module manifest ordered + versioned** for determinism/anti-cheat.

### Gaps

- **`Math.sqrt` cross-engine** — spec-claimed, not tested (D3). The desync detector that should catch divergence is off by default (S5).
- **`advanceTo` catch-up determinism** — no golden test for the core async-genre scenario (D4, PA-4.2 🔒).
- **`kernel.manifest` vs actual handler order** — not tested (D5).
- **`Math.round`** — allowed in code, not in the `architecture.md:505` allow-list (D2). Not a runtime hazard (correctly-rounded), but doc/lint inconsistency.
- **`timeScale` not in `versioning.md` §2 version axes** — replays at different timeScale may mis-attribute causality (T4).

---

## Documentation Quality

| Aspect | Grade | Note |
|---|---|---|
| Coverage | ⭐⭐⭐⭐⭐ | 75 docs, 1.9 MB — almost everything documented |
| Honesty | ⭐⭐⭐⭐⭐ | ⏳/🔒 honestly mark unfinished work |
| Consistency | ⭐⭐⭐ | ~7 stale sections (BullMQ, 600-score, ×4-timeScale, 27 modules) |
| Code-match | ⭐⭐⭐ | ~6 claims "we do X" don't match code (S1, S5, A06-5, S3) |
| Security architecture | ⭐⭐⭐⭐ | Threat model well described, but several invariants are opt-in not default |
| Threat model | ⭐⭐⭐ | No model for player-hosted matches and Steward-abuse |
| Determinism | ⭐⭐⭐⭐ | ESLint rules strong, but load-bearing claims unverified by tests |
| CI/CD doc | ⭐⭐⭐⭐ | Well described, but branch protection is UI-only, not verifiable from repo |

**Systemic issues:**
1. **Staleness** — several decisions (BullMQ, SQLite, 600-score, 27 modules) are not struck through and continue to mislead. The `gdd.md:157` supersession pattern (`~~strikethrough~~ → replaced by`) should be adopted repo-wide (see O4).
2. **"Built ≠ enabled"** — master plan `security-master-plan.md:61-63` acknowledges this gap ("Разрыв — построено ≠ включено") but it is not fixed in deploy artifacts.

---

## Top Fixes Before Public Launch

1. **S1 + MP-1**: `PROD=1` + `AUTH_JWT_SECRET` + `GATE=1` + `SEAT_LOCK=1` defaults in `docker-compose.yml` and `render.yaml` (fail-secure).
2. **S5**: `emitStateHash: true` default in production.
3. **SEC-A06-5**: `payloadSchemas.ts:95` `.min(1)` for `market.list.price`.
4. **SECURITY.md**: digest-pin 4 remaining scanner images or correct wording to "partially digest-pinned".

**Recommended follow-up (high priority):**
5. **C2/C3**: Rewrite GDD §3.1-3.3 with `scoreLimit=1100` and `timeScale ×1…×100`.
6. **C4**: Reconcile `architecture.md:499` with `engineering-risks.md:96-120` (own-intent preview vs world-prediction).
7. **T1**: Add threat model for player-hosted matches to `architecture.md` §5.
8. **CI**: Add `pull_request:` trigger to `security.yml`; activate `CODEOWNERS`.
9. **ST1/ST4**: Add supersession banners to `roadmap.md` and `architecture.md` §3 for BullMQ/Redis.
10. **D3/D4**: Add cross-engine `Math.sqrt` golden test and `advanceTo` catch-up determinism test.

---

## Final Verdict

### Code: ⭐⭐⭐⭐⭐ of 5

Production-grade, not "indie alpha". Highlights: deterministic kernel with seeded RNG (rare maturity for games), security at enterprise level (8 CI tools, 0 SQLi, scrypt, JWT pinning), test coverage >100% ratio with property-based + golden tests, 0 ESLint errors, 0 TODO. Main tech debt: `prototype/src/main.ts` (14 635 lines), honestly admitted as throwaway.

### Documentation: ⭐⭐⭐⭐ of 5

Scale and quality of a large company. Main systemic flaw: "built ≠ enabled" pattern — gate, desync detector, Origin allowlist, JWT all implemented correctly but opt-in, while architectural docs present them as foundational invariants. Second systemic issue: staleness — several decisions not struck through and continue to mislead. Both fixable by one process change: adopt the `gdd.md:157` strikethrough convention repo-wide + a CI check for "doc older than N days without 'verified with code' marker → fail".

### Overall: ⭐⭐⭐⭐ of 5

This is the level at which most commercial projects do not operate, and here it is an alpha with one critical-severity finding. Chapeau to the author — this is a level to aspire to.

---

*Audit performed by opencode (GLM-5.2 via Hermes pipeline). Findings cross-referenced against actual code with file:line evidence. Methodology: 5-phase code audit (route enumeration, auth modeling, taint tracking, per-class vuln audit, evidence) + doc consistency check + threat-model gap analysis.*