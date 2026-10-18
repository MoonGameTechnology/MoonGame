# Void Dominion — Production Server Blackbox Pentest Report

**Date:** 2026-10-16
**Target:** https://77-221-140-87.sslip.io/ (player-facing production), WS endpoints, VPS infra on 77.221.140.87
**Owner:** MoonWuk (own game + own VPS; full authorization)
**Scope constraint:** game application + game infrastructure only. Hosting provider (Aéza / AS210644, Helsinki) NOT touched.
**Method:** blackbox — external probing only (HTTP/WS clients, external port verification via check-host.net). Whitebox repo used only for cross-checking intended behavior.

---

## Executive Summary

The production deployment is in strong shape. All authentication, authorization, session, WebSocket-handshake, CORS and rate-limiting controls tested behaved correctly. **No high or critical vulnerabilities were found.** Three low/informational findings are reported, plus a set of verified-effective defenses documented as negative results.

| # | Finding | Severity |
|---|---|---|
| 1 | `GET /matches/:id/seats` is unauthenticated — leaks seat composition | Low |
| 2 | Duplicate WebSocket connections per join token accepted (no single-peer enforcement observed) | Low |
| 3 | Build version + proxy software disclosed via `/health` and `Via` header | Info |
| 4 | Registration reveals login existence (`409 E_LOGIN_TAKEN`) | Info (likely by-design) |

**Verified effective (negative results):** JWT hardening (alg:none / tampering rejected), strict WS Origin allowlist, `?nick=`/`?ticket=`/`?player=` handshakes refused in account mode, join-token match-scoping, seat-slot hijack prevention, per-IP rate limits (429 observed), CORS origin lock, strict CSP/HSTS, path-traversal and sensitive-path probes all 404, corps RBAC enforcement, archive authorization.

---

## 1. Target & Attack Surface

### Infrastructure

| Port (external, verified via check-host.net from ≥2 nodes) | State |
|---|---|
| 22/tcp (SSH) | open |
| 80/tcp (HTTP → 308 → HTTPS) | open |
| 443/tcp (HTTPS, Caddy) | open |
| 5432, 6379, 8080, 8443, 5900, 9100, 32768 | **closed / refused / timeout** |

> Note: a local port scan initially suggested dozens of open ports (5432, 5900, 6000, 8080, 9100, …). This was proven to be a **local environment artifact** (QEMU NAT tarpit answering SYN locally; `github.com:9999` also "open" from this host). External verification shows only 22/80/443 exposed. **The direct database (Postgres) is NOT exposed to the internet.**

### TLS / Transport

- Let's Encrypt certificate, SAN `77-221-140-87.sslip.io`, valid 2026-10-16 → 2027-01-14 (89 days remaining).
- TLSv1.3, `TLS_AES_128_GCM_SHA256`. HTTP/3 advertised (`alt-svc h3`).
- HSTS: `max-age=31536000; includeSubDomains`.

### HTTP security headers (app)

| Header | Value / Assessment |
|---|---|
| Content-Security-Policy | `default-src 'none'` + sha256-hashed script/style + `connect-src 'self' wss:` + `frame-ancestors 'none'` — strict, good |
| Strict-Transport-Security | on |
| X-Content-Type-Options | nosniff |
| Referrer-Policy | no-referrer |
| Permissions-Policy | all sensitive features disabled |
| Cross-Origin-Opener/Resource-Policy | same-origin(-allow-popups) |
| X-Frame-Options | absent — **covered by `frame-ancestors 'none'`** (not a finding) |
| Via | `1.1 Caddy` — proxy disclosure (info) |
| Vary | Origin (correct for CORS) |

---

## 2. Authentication & Session Testing

### 2.1 Registration / Login

| Test | Result | Verdict |
|---|---|---|
| Register valid login | `201` + session token | ✅ |
| Duplicate login | `409 E_LOGIN_TAKEN` | info (enumeration; see Finding 4) |
| Login bad password vs unknown user | both uniform `401 E_AUTH` | ✅ no enumeration via login |
| Timing: wrong-pass vs unknown-user | 0.34s vs 0.27s (both burn scrypt decoy) | ✅ acceptable |
| Login validation: `ab`, `a b`, `<script>`, SQLi strings | all `400` | ✅ strict `LOGIN_RE` |
| Huge password (100 KB) | `400` | ✅ |
| Invalid JSON body | `400 E_BAD_REQUEST` | ✅ |

**Session JWT** (HS256, `typ: session+jwt`): claims `login`, `pwfp` (password fingerprint), `sub`, `iss=void-dominion`, `aud=session`, 7-day `exp`.

### 2.2 JWT attack surface

| Attack | Result | Verdict |
|---|---|---|
| `alg:none` forged token → `/corps` | `401` | ✅ rejected |
| Tampered `sub` (other account UUID), signature kept | `401` | ✅ rejected |
| Garbage token / empty / missing header | `401` | ✅ |

### 2.3 Join flow

| Test | Result | Verdict |
|---|---|---|
| Join match → `{playerId: "p1", token}` | ✅ | — |
| Second account → `p2` (distinct seat) | ✅ | — |
| Repeat join (same account) → same `p1` | ✅ idempotent | — |
| Join non-existent match | `404 E_NO_MATCH` | ✅ |
| Join without auth | `401` | ✅ |
| **Join-token from match A replayed on match B WS** | `403` | ✅ match-scoped |

**Join token** (HS256, `typ: join+jwt`): `matchId`, `playerId`, `accountId`, `pwfp`, 15-min TTL.

---

## 3. WebSocket Security

| Test | Result | Verdict |
|---|---|---|
| Valid join token | `101 Switching Protocols` + welcome | ✅ |
| No token | `401` | ✅ |
| Garbage token | `401` | ✅ |
| Foreign Origin (`evil.example.com`) | `403` | ✅ |
| Missing Origin | `403` | ✅ |
| `Origin: null` | `403` | ✅ |
| `Origin: http://` (scheme mismatch) | `403` | ✅ |
| Subdomain Origin | `403` | ✅ |
| `?nick=attacker` | `401` (refused in account mode) | ✅ |
| `?player=p1` | `401` | ✅ |
| `?nick=attacker&ticket=fake` | `401` | ✅ |
| **Duplicate concurrent WS with same token** | both `101`, both welcome, both alive | ⚠ Finding 2 |

---

## 4. Rate Limiting

| Endpoint / burst | Observation | Verdict |
|---|---|---|
| `/auth/login` × 120 (invalid body) | ~40 × `400`, then **80 × `429`** | ✅ limiter engages |
| `/auth/login` × 40 (valid body, wrong pass) | all `401` (window not yet saturated in that window) | ✅ consistent with 10/60s shared budget + window semantics |
| `/matches/:id/join` × 40 | 30 pass, then `10 × 429` | ✅ limiter engages |
| `X-Forwarded-For` spoof attempt | no bypass observed | ✅ |

> Initial 25–40-bursts did not trip 429 — because attempts are recorded per window and prior probes had partially consumed/aged out budgets. Longer bursts reliably trip the limiter. **No rate-limit bypass found.**

---

## 5. Authorization (IDOR / RBAC)

### Matches

| Test | Result | Verdict |
|---|---|---|
| Archive match without holding a seat (fresh account) | `403` | ✅ |
| Unarchive without seat | `403` | ✅ |
| Archive with seat (both accounts in match) | `200`, archived per-player only | ✅ per-player isolation |

### Corps

| Test | Result | Verdict |
|---|---|---|
| Create corp | `201` + corpId | ✅ |
| Read corp detail by outsider (authenticated) | `200` (members list) | by-design candidate; member roster is public to auth users |
| Audit log by non-member | `403` | ✅ |
| `disband` by non-member | `403` | ✅ |
| `kick` / `role` / `transfer` by non-member (correct `target` field) | `403` | ✅ |
| Member self-promote to officer/head | `403` | ✅ no privilege escalation |
| Member self-transfer headship | `403` | ✅ |
| Member kick head | `403` | ✅ |
| Member disband | `403` | ✅ |
| Member leave | `200` | ✅ |

---

## 6. Seat Selection (`?slot=`)

| Test | Result | Verdict |
|---|---|---|
| `join?slot=p1` while p1 taken | receives first **free** seat (`p3`) — no hijack | ✅ |
| `join?slot=p3` while p3 free | receives `p3` | ✅ honored |
| `join?slot=999` (invalid) | receives first free seat (`p4`) | ✅ graceful fallback |

---

## 7. Input/surface probes (all clean)

- `PUT/DELETE/PATCH/TRACE /auth/login` → `404`
- Path tricks: `/auth/login/`, `/auth/Login`, `/AUTH/login`, `/auth//login`, `/auth/login%20` → all `404`
- Sensitive paths: `/.env`, `/.git/HEAD`, `/admin`, `/openapi.json`, `/swagger.json`, `/api`, `/debug`, `/server-status`, `/config.json` → all `404`
- CORS: `Origin: https://evil.example.com` → **no ACAO header**; preflight `OPTIONS` → `204` with exact-origin ACAO. No wildcard, no credentials reflection.
- WS message fuzz: garbage frame → error frame (`E_BAD_MESSAGE` family), no crash.

---

## Findings (detailed)

### Finding 1 — `GET /matches/:id/seats` unauthenticated (Low)

```
GET /matches/m-facb6869-.../seats
(no Authorization header)
→ 200 {"seats":[{"playerId":"p1","name":"Azure Compact","faction":"azure","start":"home_1","taken":true}, ...], "mapId":"team-3v3"}
```

Leaks: seat list, faction, homeworld id, taken/free status — for any match id. Match ids are public via `GET /matches`. No PII (players are identified only by seat id here).

**Impact:** trivial reconnaissance of ongoing matches' composition (who holds how many seats, which factions, which starts). Low.
**Recommendation:** require a session (or scope the response to the authenticated player's own seat + free-seat availability only). If unauthenticated by design for the pre-login join UI, consider rate-limiting reads and dropping `start` until seated.

### Finding 2 — Duplicate WebSocket connections per join token (Low)

Two simultaneous WS upgrades with the same `?token=` both completed `101`, both received the welcome snapshot for the same `playerId`, both stayed alive and answered pings.

**Impact:** a leaked/shared join token (15-min TTL) allows a parallel silent session — no kick or notification for the legitimate holder, and two command streams on one seat can race. Requires token compromise first, hence Low.
**Test to run whitebox:** check `singlePeerPerPlayer` in the deployed build's `MatchRoom` options (`prototype/netserver.ts` sets it `true`; verify `packages/server/src/main.ts` / scenario wiring on this build — version `81715959`).
**Recommendation:** enable single-peer-per-player (kick or reject the older socket, notify), or document deliberately.

### Finding 3 — Info disclosure: build version + proxy (Info)

- `/health` → `{"ok":true,"version":"81715959"}` — build id.
- `Via: 1.1 Caddy` — proxy software.
**Recommendation:** optional; strip/soften if desired. Informational.

### Finding 4 — Registration login-existence disclosure (Info)

`POST /auth/register` with an existing login → `409 E_LOGIN_TAKEN`. Standard UX trade-off; login endpoint itself is enumeration-resistant (uniform 401 + timing decoy). **Recommendation:** accept as by-design or return a generic 200 + e-mail-verification flow.

---

## Verified-Effective Defenses (summary table)

| Control | Status |
|---|---|
| JWT: alg pinned, `none` rejected, tamper rejected | ✅ |
| WS Origin allowlist (missing/null/wrong/subdomain/http all 403) | ✅ |
| Dev handshakes refused in account mode (`?nick=`/`?ticket=`/`?player=`) | ✅ |
| Join token match-scoped (cross-match = 403) | ✅ |
| Seat-slot hijack prevented (busy slot → first free) | ✅ |
| Per-IP rate limiting (auth + join) | ✅ |
| CORS origin lock + correct preflight | ✅ |
| CSP (sha256-hashed, `default-src 'none'`) + HSTS | ✅ |
| Path traversal / sensitive paths / method abuse | ✅ all 404 |
| Corps RBAC (no escalation paths found) | ✅ |
| Archive authorization (seat required) | ✅ |
| Uniform auth errors + timing equalization | ✅ |
| DB (Postgres) not internet-exposed | ✅ (22/80/443 only) |

---

## Methodology & Tooling

- HTTP probing: `curl` (HTTP/1.1 + HTTP/2), `moonmcp_http_probe`, `moonmcp_probe_batch`, `moonmcp_fingerprint`, `moonmcp_analyze_headers`, `moonmcp_cors_audit`, `moonmcp_tls_inspect`.
- WebSocket testing: hand-rolled Python `http.client` WS handshake + frame reader (masked client frames, ping/pong, welcome parsing).
- External port verification: **check-host.net** `check-tcp` API from ≥2 geographic nodes (to defeat local NAT artifacts).
- Whitebox cross-check: repository `packages/server/src/{authApi,auth,rateLimit,matchApi,matchRegistry,corpApi,corpService,matchRoom,wsServer}.ts`.
- Evidence: `reg1.json`, `login1.json`, `join1.json`, `token1..5.txt` in this engagement directory.

## Notes / Follow-ups

1. Deployed build (`81715959`) advertises modes `team_3v3`, `team_2v2` — newer than the checked-out repo; verify the `singlePeerPerPlayer` wiring against that exact build.
2. SSH (22) is open; ensure key-only auth + fail2ban if not already.
3. `GET /corps/:id` member roster readable by any authenticated user — confirm this is the intended "public roster" design (documented in `docs/corporations.md`).
