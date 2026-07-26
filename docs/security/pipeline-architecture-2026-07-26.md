# Отчёт: архитектура CI/CD-пайплайна — 2026-07-26

> Оценка того, **как построен** пайплайн (не «что сканирует» — это
> `scanner-coverage-2026-07-26.md`, а «насколько архитектурно правильно»).
> Сверено с `.github/workflows/ci.yml`, `.github/workflows/security.yml`,
> `.github/workflows/android.yml`, `.github/workflows/pages.yml`,
> `docs/security/pipeline.md`, `docs/security/security-master-plan.md`.
>
> **Контекст стадии:** альфа, нет прода/пользователей, крит-путь к играбельности.
> Подход команды: неблокирующие сканеры копят находки → отдельный флоу триажа.

---

## 1. Структура пайплайна

Четыре workflow в `.github/workflows/`:

| Workflow | Триггер | Роль | Concurrency |
|---|---|---|---|
| `ci.yml` | push to main + PR | **Гейт** (блокирующий): lint+typecheck+test+docs-check + OSV-Scanner, против сервисного Postgres | нет |
| `security.yml` | push **любая ветка** + workflow_dispatch | **Security-скан**: 13 джоб (SAST/SCA/Secret/IaC/Container/DAST/SBOM/workflow/posture) + report | `security-${{ github.ref }}`, cancel-in-progress |
| `android.yml` | push (paths: mobile/**) + tag `alpha*` | **APK-сборка** + cosign-подпись + rolling-релиз | нет |
| `pages.yml` | push to main (paths: docs) | **GitHub Pages** (статический сайт из docs) | нет |

**Разделение ролей правильное.** `ci.yml` — быстрый гейт (блокирующий, с Postgres
для durable-тестов). `security.yml` — тяжёлый security-скан (13 параллельных джоб,
ratcheting). `android.yml` — отдельный релизный контур. Не «всё в одном» — каждый
workflow имеет свою цель, свой триггер, свои permissions.

---

## 2. Что построено архитектурно верно

### 2.1. Параллелизм джоб + always-агрегация

Все 12 скан-джоб в `security.yml` идут **параллельно** (нет `needs` между ними).
`report`-джоба собирает через `needs: [...]` + `if: always()`. Это значит:
- один упавший сканер не блокирует остальные,
- отчёт собирается всегда, даже если половина джоб упала.

Архитектурно — правильно. Последовательное выполнение заняло бы ~40 мин вместо
~8 мин параллельных; `always()` гарантирует, что отчёт не теряется.

### 2.2. Sentinel-паттерн (анти fail-open)

Каждая джоба пишет `status-<key>.json` с реальным exit-code/outcome **после** скана.
`summarize-security.mjs` строит таблицу «сканер подтверждён / ⚠️ NOT confirmed».

Это решает реальную проблему: сканер молча упал (образ не скачался, OOM, timeout),
джоба `continue-on-error: true` — и в отчёте «0 находок», хотя скан не отработал.
Сентинел делает это видимым. **Это паттерн уровня enterprise**, редко встречается
даже в коммерческих проектах.

### 2.3. Ratcheting-гейт

Не «включили всё блокирующим в день 1 и получили красный CI с сотней находок».
Базовая линия 0 → блокирующие только оттриаженные сканеры (Semgrep, Gitleaks, OSV,
Trivy fs/image) → путь к ужесточению описан в `pipeline.md`. Это **правильная
стратегия внедрения** security-гейта — академически (OWASP SAMM, BSIMM) и практически.

### 2.4. Defense-in-depth с осознанным перекрытием

SAST: Semgrep (pattern) + CodeQL (dataflow) — разные методы. Secrets: Gitleaks
(tree) + TruffleHog (history+verify) + Trivy (fs) — разные поверхности. SCA:
OSV + Trivy fs + Trivy image — разные источники. Это не дублирование — каждый
движок имеет слепые зоны, которые закрывает другой.

### 2.5. Supply-chain hygiene

- Actions SHA-pinned (`@<sha> # vN` для читаемости).
- Образы — digest-pinned (5 из 9; 4 по tag — gap, см. §4).
- `persist-credentials: false` на каждом checkout.
- `permissions: {}` по умолчанию, каждая джоба объявляет только нужное.
- Template-injection prevention (`env:` вместо inline `${{ }}`).
- zizmor проверяет сам пайплайн.
- APK подписан cosign (keyless OIDC).

Это **сам пайплайн как поверхность атаки** — часто забывают, у вас закрыто.

### 2.6. SARIF → Code Scanning

8 из 13 джоб грузят SARIF в GitHub Code Scanning. Находки видны в
`Security → Code scanning alerts` с triage-возможностями (dismiss/suppress с
причиной), с привязкой к коду. Не «SARIF-файл в артефакте, который никто не
открывает» — а нативный GitHub UX.

### 2.7. Postgres-сервис в ci.yml

`ci.yml` поднимает `postgres:16` как service-контейнер и выставляет
`DATABASE_URL`, чтобы durable-тесты (`store.test.ts`, gated за `DATABASE_URL`)
реально бежали в CI, а не пропускались. Это правильно — production persistence
path exercised, не только in-memory.

---

## 3. Архитектурные нюансы (не баги, но стоит понимать)

### 3.1. `report`-джоба: широкие permissions + untrusted-артефакты

`report` требует `contents: write` + `pull-requests: write` + `issues: write`
(для sticky PR-комментария и commit-comment). Это нужно, но означает: джоба с
широкими правами работает с артефактами из всех сканеров. Если бы сканер
скомпрометирован (образ с бэкдором), он мог бы подсунуть вредоносный SARIF/JSON
в артефакт.

**Реальный риск:** минимальный — `report` только читает артефакты и постит
комментарий через `actions/github-script`, не выполняет код из артефактов. Но
`contents: write` на джобе, которая читает untrusted-артефакты — стоит держать
в уме. На проде можно разделить: `report` (read-only + post comment) и
`commit-status` (write) — отдельные джобы.

### 3.2. `trivy-image` собирает образ через `docker build` на раннере

Правильно для скана собранного образа, но означает: Dockerfile-инъекция (если
бы `COPY` подхватил вредоносный файл) исполнится на раннере. У вас
`persist-credentials: false` — токен не утекает, но `docker build` с
`RUN pnpm install` — это выполнение кода из lockfile/манифеста.

**Риск:** низкий на GitHub-hosted runner (виртуальная машина уничтожается после
job). На self-hosted — выше. На инди-альфе приемлемо; на проде стоит
multi-stage с build-аргументами и pinned-build.

### 3.3. `dast-zap` поднимает сервер на раннере (`--network host`)

ZAP достигает `localhost:8787` — правильно для DAST. Но `--network host` означает,
что ZAP-контейнер имеет доступ к сети раннера. Если бы ZAP-образ был
скомпрометирован — он мог бы сканировать не только `localhost:8787`, но и другие
сервисы раннера (metadata, другие контейнеры).

**Риск:** на GitHub-hosted runner изолировано (VM уничтожается после job). На
self-hosted — стоит `--network host` заменить на explicit port mapping.

### 3.4. Нет `timeout-minutes` на джобах

Если сканер зависнет (образ не качается, ZAP бесконечно сканирует) — джоба будет
идти до таймаута GitHub Actions (6 часов по умолчанию). Это не баг, но
`timeout-minutes: 15` на каждой скан-джобе — хорошая практика, экономит минуты
билда и предотвращает зависшие джобы.

**Фикс:** добавить `timeout-minutes: 15` (scan-джобы) / `30` (dast-zap, trivy-image)
на каждую джобу. ~5 минут правок.

### 3.5. `concurrency` асимметрия

`security.yml` — `concurrency: cancel-in-progress: true`. `ci.yml` — нет `concurrency`.
Это означает: новый push на ту же ветку отменяет идущий security-скан, но НЕ
отменяет гейт. Асимметрия:

- **Security-скан отменяемый.** Если вы запушли фикс секретной находки, а
  предыдущий скан ещё шёл — он отменится. Следующий push запустит новый скан,
  так что находка поймается. Но если это был последний push перед мерджем — скан
  может не дойти.
- **Гейт не отменяемый.** Каждый push ждёт полного `pnpm run check`.

**Фикс:** выровнять — либо оба `cancel-in-progress: true` (скорость), либо оба
без `concurrency` (надёжность). Для security-скана `cancel-in-progress: false`
безопаснее (скан всегда доходит), но медленнее. Компромисс: `cancel-in-progress: true`
на обоих + `workflow_dispatch` для ручного досканирования перед мерджем.

### 3.6. `check`-джоба в `security.yml` дублирует `ci.yml`

Осознанный дубликат (чтобы `report` имел сентинел `check` в отчёте). Но означает:
на каждый push — два полных `pnpm run check` (один в `ci.yml`, один в `security.yml`).
Это ~2× минуты CI.

**Фикс:** `security.yml` `check` делает только lint+typecheck (без test, который
дорогой и уже в `ci.yml`). Или — `security.yml` `check` читает результат `ci.yml`
через workflow_run-trigger (но это сложнее). Косметика.

---

## 4. Сравнение с best practices

| Практика | У вас | Best practice | Статус |
|---|---|---|---|
| Actions SHA-pinned | ✅ | ✅ | done |
| Образы digest-pinned | ⚠️ 4 по tag | ✅ все по digest | gap (G-1 из scanner-coverage) |
| `permissions: {}` по умолчанию | ✅ | ✅ | done |
| `persist-credentials: false` | ✅ | ✅ | done |
| Template-injection prevention | ✅ (`env:`) | ✅ | done |
| Ratcheting gate | ✅ | ✅ (BSIMM/OWASP SAMM) | done |
| Sentinel-паттерн (anti fail-open) | ✅ | редко даже в enterprise | done |
| SARIF → Code Scanning | ✅ | ✅ | done |
| Defense-in-depth (overlapping engines) | ✅ | ✅ | done |
| Postgres-service для durable-тестов | ✅ | ✅ | done |
| `timeout-minutes` на джобах | ❌ | ✅ | стоит добавить |
| `concurrency` consistency | ⚠️ асимметрия | ✅ | выровнять |
| Dependabot/Renovate | ❌ | ✅ | стоит включить |
| Signed builds (cosign) | ✅ APK | ✅ (контейнеры — когда прод) | done для альфы |

---

## 5. Вердикт

**Пайплайн построен архитектурно правильно.** Это не «набросали сканеров» — это
продуманная система с:

- разделением ролей (ci/security/android/pages),
- ratcheting-стратегией внедрения,
- sentinel-паттерном против fail-open,
- defense-in-depth с осознанным перекрытием,
- supply-chain hygiene,
- SARIF-интеграцией в GitHub UX,
- Postgres-сервисом для durable-тестов.

**Уровень: выше среднего для инди-альфы, сопоставим с малой коммерческой командой.**

Главные архитектурные нюансы (не баги):
1. `timeout-minutes` отсутствует — стоит добавить (5 мин правок).
2. `concurrency` асимметрична — стоит выровнять (5 мин правок).
3. 4 образа по tag — supply-chain gap (G-1 из scanner-coverage, 30 мин).
4. `check`-джоба дублирует `ci.yml` — косметика, можно оптимизировать.

Всё остальное — на месте. Пайплайн готов к росту: когда появится прод, нужно
(1) перевести неблокирующие сканеры в блокирующие с severity-порогом,
(2) подписать контейнеры cosign, (3) добавить authenticated DAST — но это
описано в `security-master-plan.md` как «построено ≠ включено».

---

## 6. Предложения (архитектурная гигиена)

| # | Предложение | Приоритет | Усилие | Зона |
|---|---|---|---|---|
| **A-1** | Добавить `timeout-minutes` на скан-джобы (15/30 мин) | 🟡 средний | 5 мин | `[sec]` |
| **A-2** | Выровнять `concurrency` (ci.yml + security.yml) | 🟡 средний | 5 мин | `[sec]` |
| **A-3** | Перепиновать 4 образа по sha256 (G-1 из scanner-coverage) | 🔴 критичный | 30 мин | `[sec]` |
| **A-4** | Оптимизировать `check` в security.yml (lint+typecheck без test) | 🟢 низкий | 10 мин | `[sec]` |
| **A-5** | Включить Dependabot для npm + actions | 🟢 низкий | 15 мин | `[sec]` |

A-1 и A-2 — 10 минут суммарно, чисто архитектурная гигиена. A-3 — единственный
критичный пункт (supply-chain). Остальное — косметика.

---

_Сверено с кодом: `.github/workflows/ci.yml`, `.github/workflows/security.yml`
(13 джоб, concurrency, permissions), `.github/workflows/android.yml` (cosign),
`.github/workflows/pages.yml`, `docs/security/pipeline.md`,
`docs/security/security-master-plan.md`._