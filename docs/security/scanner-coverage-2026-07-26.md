# Отчёт: охват сканеров безопасности — 2026-07-26

> Глубокий анализ DevSecOps-пайплайна Void Dominion: инвентаризация сканеров,
> оценка охвата по OWASP Top 10, сильные/слабые стороны, предложения.
> Сверено с `.github/workflows/security.yml`, `.semgrep/rules/`, `.trivyignore`,
> `bearer.yml`, `Dockerfile`, `docs/security/pipeline.md`,
> `docs/security/image-pinning.md`, `docs/security/security-master-plan.md`.
>
> **Контекст стадии:** альфа, нет прода/пользователей, крит-путь к играбельности.
> Подход команды: неблокирующие сканеры копят находки в отчёте → отдельный флоу
> триажа. Это **осознанное** решение для скорости (см. `pipeline.md` «ratcheting»).

---

## 1. Инвентаризация сканеров

`security.yml` — **13 джоб**, покрывающих 7 классов безопасности. Параллельно
`ci.yml` прогоняет гейт + OSV-Scanner.

| # | Джоба | Класс | Инструмент | Блокирующий? | Пин образа | SARIF→Code Scanning |
|---|---|---|---|---|---|---|
| 1 | `check` | gate | lint+typecheck+test | информационный¹ | — | — |
| 2 | `semgrep` | SAST | Semgrep (p/typescript + p/javascript + p/security-audit + custom) | ✅ блокирующий | ✅ sha256 | ✅ |
| 3 | `codeql` | SAST (dataflow) | CodeQL (javascript-typescript) | информационный | — (action) | ✅ |
| 4 | `gitleaks` | Secret detection | Gitleaks v8.18.4 (`--no-git`) | ✅ блокирующий | ⚠️ **tag** | ✅ |
| 5 | `trufflehog` | Secret detection (history + verify) | TruffleHog (full history, `--json`) | информационный | ✅ sha256 | — (JSON) |
| 6 | `osv` | SCA | OSV-Scanner v1.9.1 (pnpm-lock + mobile/package-lock) | ✅ блокирующий | ⚠️ **tag** | ✅ |
| 7 | `trivy-fs` | SCA + IaC + secret | Trivy 0.58.2 (vuln,secret,misconfig) | ✅ блокирующий | ⚠️ **tag** | ✅ |
| 8 | `trivy-image` | Container scan | Trivy 0.58.2 image | ✅ блокирующий | ⚠️ **tag** | ✅ |
| 9 | `dast-zap` | DAST | OWASP ZAP baseline (живой сервер) | информационный | ✅ sha256 | — (HTML/JSON) |
| 10 | `sbom` | SBOM | Syft v1.20.0 (CycloneDX) | информационный | ⚠️ **tag** | — (CDX) |
| 11 | `zizmor` | Workflow security | zizmor (GitHub Actions SAST) | информационный | ✅ sha256 | ✅ |
| 12 | `scorecard` | Repo posture | OpenSSF Scorecard (только main) | информационный | — (action) | ✅ |
| 13 | `report` | aggregation | summarize-security.mjs | — | — | — |

¹ `check` дублируется блокирующим в `ci.yml`; в `security.yml` он информационный,
чтобы отчёт собирался всегда.

**Дополнительно:**
- `ci.yml`: OSV-Scanner по lockfile'ам (дублирует osv-джобу — defense-in-depth).
- `android.yml`: `cosign sign-blob` (keyless OIDC) — подпись APK.
- `bearer.yml`: конфиг для Bearer SAST (исключает `prototype/`), но **нет джобы**
  в `security.yml` — мёртвый конфиг (см. G-7).

**Кастомные Semgrep-правила (SEC-2)** — 5 правил под инварианты ядра:
- `core-no-date-now` — запрет `Date.now()`/`new Date()` в shared-core (детерминизм)
- `core-no-math-random` — запрет `Math.random()` в shared-core (детерминизм)
- `core-no-node-builtins` — запрет Node built-ins в shared-core (чистота ядра)
- `no-innerhtml-assignment` — XSS-синк в packages (CWE-79)
- `no-sql-string-interpolation` — SQLi в packages (CWE-89)

Правила тестируются (`semgrep --test .semgrep/rules`) — редкая зрелость для инди.

---

## 2. Оценка охвата по OWASP Top 10 (2021)

| OWASP | Класс | Покрытие | Сканеры | Оценка |
|---|---|---|---|---|
| **A01 Broken Access Control** | AuthZ | частично | CodeQL (dataflow), ZAP (DAST), custom Semgrep (SQLi/innerHTML) | ★★★☆☆ — нет специализированного authz-сканера; полагается на CodeQL+ZAP |
| **A02 Cryptographic Failures** | Secrets/Crypto | хорошо | Gitleaks + TruffleHog (два движка секретов), Trivy secret | ★★★★☆ — двойной секрет-скан; но нет проверки crypto-алгоритмов |
| **A03 Injection** | SAST | хорошо | Semgrep (p/typescript + custom SQLi/innerHTML), CodeQL (dataflow), Trivy misconfig | ★★★★☆ — Semgrep+CodeQL перекрытие; custom правила под инварианты |
| **A04 Insecure Design** | Architecture | частично | zizmor (workflow design), Scorecard (posture), custom Semgrep (детерминизм) | ★★★☆☆ — нет threat-modeling автоматизации; инварианты ядра — кастомные правила |
| **A05 Security Misconfiguration** | IaC | хорошо | Trivy fs (misconfig), Trivy image, zizmor (workflow config) | ★★★★☆ — Dockerfile/yaml покрыты, **compose — нет** (см. поправку под таблицей) |
| **A06 Vulnerable Components** | SCA | отлично | OSV-Scanner (блокирующий) + Trivy fs/image (vuln) + SBOM (Syft) | ★★★★★ — тройное перекрытие, блокирующее |
| **A07 Auth Failures** | Auth | частично | ZAP (DAST baseline), CodeQL | ★★★☆☆ — нет специализированного auth-теста; ZAP baseline поверхностен |
| **A08 Integrity Failures** | Supply chain | отлично | SHA-pinned actions, digest-pinned образы (частично), SBOM, cosign на APK, `hashGameDataBundle` (runtime) | ★★★★☆ — сильный для альфы; **но 4 образа по tag** (gap) |
| **A09 Logging Failures** | Logging | не покрыто | — | ★☆☆☆☆ — нет сканера логирования; метрики есть, но не сканируются |
| **A10 SSRF** | SAST | частично | CodeQL (dataflow), Semgrep | ★★★☆☆ — CodeQL ловит dataflow; нет custom-правила |

**Общий охват OWASP: ★★★★☆ (4/5)** — для инди-альфы это **выше среднего**.
Слабые места: A09 (логирование), A01/A07 (authz/auth — только DAST+CodeQL).

> **Поправка 2026-07-30 (SEC-12/13).** Этот отчёт — снапшот на свою дату; две строки
> оказались завышены, исправлено по факту, а не переписыванием истории:
>
> - **A05.** «compose покрыт» — неверно: у Trivy misconfig нет формата Docker Compose
>   (Dockerfile/k8s/terraform/cloudformation/helm/ARM), так что рантайм-настройки
>   `deploy/docker-compose*.yml` не проверял никто. Хардненинг проставлен вручную,
>   держится чек-листом в `deploy/README.md`.
> - **A08.** К «4 образам по тегу» добавлялись `postgres`/`caddy` из `deploy/` — теперь
>   пинены по дайджесту и сканируются джобой `trivy-deps`. Плюс closed-loop на прод:
>   `image.yml` подписывает опубликованный образ (cosign), `deploy/verify-image.sh`
>   проверяет подпись до старта.

---

## 3. Сильные стороны

**1. Defense-in-depth с осознанным перекрытием.** Секреты — два движка
(Gitleaks + TruffleHog) + Trivy secret. SCA — OSV + Trivy fs + Trivy image.
SAST — Semgrep + CodeQL (разные методы: pattern-matching vs dataflow). Это не
дублирование ради дублирования — каждый движок имеет свои слепые зоны.

**2. Ratcheting-гейт (SEC-1).** 5 сканеров блокирующие (Semgrep, Gitleaks, OSV,
Trivy fs, Trivy image). Базовая линия — 0 находок. Fail-secure: сканер, который
не отработал (exit 125/126/127), тоже блокирует. Сентинелы `status-<key>.json`
+ summarizer — анти fail-open (F-08).

**3. Кастомные Semgrep-правила под инварианты ядра (SEC-2).** 5 правил, и они
тестируются (`semgrep --test .semgrep/rules`) — редкая зрелость для инди.

**4. Supply-chain integrity.** Actions SHA-pinned с `# vN` для читаемости.
Dockerfile базовые образы — digest-pinned. APK подписан cosign (keyless OIDC).
`hashGameDataBundle` — runtime-целостность контента (MP-4). SBOM (Syft,
CycloneDX) — для "затронуты ли мы новым CVE".

**5. Pipeline hardening (SEC-3).** `persist-credentials: false` на каждом
checkout. `${{ steps.*.outcome }}` читается через `env:` (анти
template-injection). `permissions: {}` по умолчанию, каждая джоба объявляет
только нужное. zizmor проверяет сам пайплайн.

**6. Единый отчёт.** `summarize-security.mjs` собирает все сентинелы в один
отчёт, постит sticky PR-комментарий (или commit-comment). Таблица
"scan-confirmation" — лидирует с подтверждением, что каждый сканер реально
отработал.

---

## 4. Слабые места и пробелы (с приоритетом)

### 🔴 Критичные (supply-chain риск)

**G-1. 4 образа сканеров пинены по tag, не по sha256.**
- `gitleaks:v8.18.4`, `osv-scanner:v1.9.1`, `trivy:0.58.2`, `syft:v1.20.0`
- 6 TODO-комментариев в `security.yml` признают это.
- **Риск:** tag mutable — атакующий может перезаписать образ (registry
  compromise / MITM). Сканер с бэкдором не сертифицирует код, а
  компрометирует CI-раннер.
- **Фикс:** скилл `refresh-scanner-digests` — снять дайджесты живым запросом к
  реестру, заменить tag→digest. ~30 минут работы. **Первый приоритет.**

### 🟡 Средние (охват/зрелость)

**G-2. CodeQL — информационный, не блокирующий.**
- CodeQL (dataflow SAST) находит реальные инъекции через taint-анализ, но
  `continue-on-error: true` — находки не блокируют PR.
- **Риск:** CodeQL может найти реальную SQLi/XSS, но PR смерджится.
- **Фикс:** после триажа текущих находок (если 0) — перевести в блокирующий
  (убрать `continue-on-error`, добавить gate-шаг как у Semgrep). Требует
  проверки: `codeql-out/**/*.sarif` должен быть пуст.
- **Примечание:** на текущей стадии (альфа, нет прода) осознанно информационный
  для скорости — см. «Подход команды» в шапке. Перевести в блокирующий перед
  боевым деплоем.

**G-3. TruffleHog — информационный, не блокирующий.**
- TruffleHog сканирует **git-историю** (Gitleaks — только `--no-git`, текущее
  дерево). Это единственный сканер, ловящий секрет, утёкший в старом коммите и
  потом удалённый.
- **Риск:** утёкший в истории секрет не блокирует PR.
- **Фикс:** после триажа — перевести в блокирующий. Но TruffleHog `--no-update`
  может возвращать ненулевой exit при найденных (но верифицированных как
  false-positive) секретах — нужен careful triage.

**G-4. DAST (ZAP) — информационный, baseline-only.**
- ZAP baseline — пассивный сканер (без active attacks). Поднимает
  `pnpm dev:server` in-memory (auth/gate off — F1).
- **Риск:** DAST не проверяет authenticated поверхности (match API, AvA, corp
  API). Baseline ловит только заголовки/SSL/redirect-проблемы.
- **Фикс:** добавить authenticated ZAP scan (спин-ап с `AUTH_JWT_SECRET`, логин
  через `/auth/register`→`/auth/login`, токен в сессии). Кирпич SEC-6.2 уровня.

**G-5. Нет отдельного authz-сканера.**
- A01 (Broken Access Control) — покрыт только CodeQL (dataflow) + ZAP
  (baseline). Нет специализированного теста "может ли игрок A действовать как
  игрок B".
- **Риск:** IDOR / cross-player access не ловится автоматически.
- **Фикс:** добавить integration-тесты authz (уже есть `sessionGate.test.ts`,
  `seatLock.test.ts` — но нет fuzz-теста "случайный playerId против случайного
  action"). Можно через property-тест.

**G-6. A09 (Logging Failures) — не покрыта.**
- Нет сканера, проверяющего, что security-события логируются, а секреты — не
  логируются.
- **Риск:** `console.log(token)` или `process.stderr.write(secret)` не ловится.
- **Фикс:** Semgrep-правило `no-secret-in-log` (запрет `console.log`/
  `process.stdout` с переменными, содержащими `token`/`secret`/`password`/`jwt`
  в имени). ~15 строк YAML.

### 🟢 Низкие (косметика/процесс)

**G-7. `bearer.yml` существует, но Bearer не в пайплайне.**
- Конфиг есть (`scan: skip-path: [prototype]`), но джобы `bearer` в
  `security.yml` нет. Bearer — ещё один SAST-движок (AI-based, CWE-фокус).
- **Фикс:** либо добавить джобу (усиление SAST), либо удалить `bearer.yml` (если
  осознанно убран). Сейчас — мёртвый конфиг.

**G-8. `.gitleaks.toml` не создан.**
- Документ говорит "НЕ созданы намеренно: подавлять нечего". Это правильно для
  чистого состояния, но при появлении тестовых фикстур с псевдо-секретами
  (например, в `auth.test.ts`) — Gitleaks может дать false positive. Стоит
  создать превентивно с allowlist для тестовых файлов.
- **Фикс:** `.gitleaks.toml` с `[[allowlists]]` для `**/*.test.ts` (псевдо-секреты
  в тестах).

**G-9. Scorecard — только на main.**
- `if: github.ref == 'refs/heads/main'` — правильно для posture-проверок, но
  означает, что PR не видит Scorecard-регрессов.
- **Фикс:** оставить как есть (Scorecard на main — best practice), но добавить
  уведомление в PR-комментарий при regress.

**G-10. Нет Dependabot/Renovate.**
- SCA-сканеры ловят CVE в lockfile, но нет автоматического PR на обновление
  зависимостей.
- **Фикс:** включить Dependabot (`github/dependabot.yml`) для npm — еженедельный
  PR на обновление. Дополнительно — `dependabot-security-updates` для GitHub
  Actions.

---

## 5. Сводная оценка

| Измерение | Оценка | Комментарий |
|---|---|---|
| **Покрытие классов** | ★★★★☆ | 7 классов (SAST/SCA/Secret/IaC/Container/DAST/SBOM) + workflow/posture. Нет logging-сканера |
| **OWASP Top 10** | ★★★★☆ | 8/10 покрыты хорошо; A09 не покрыт, A01/A07 — частично |
| **Defense-in-depth** | ★★★★★ | Перекрытие движков в каждом классе (Semgrep+CodeQL, Gitleaks+TruffleHog, OSV+Trivy) |
| **Gating discipline** | ★★★★☆ | 5 блокирующих, ratcheting, fail-secure, сентинелы. CodeQL/TruffleHog ещё информационные |
| **Supply-chain** | ★★★★☆ | SHA-pinned actions, cosign, SBOM, hashGameDataBundle. **Но 4 образа по tag — gap** |
| **Custom rules** | ★★★★★ | 5 правил под инварианты ядра + unit-тесты правил — редкая зрелость |
| **Pipeline hardening** | ★★★★★ | persist-credentials, template-injection prevention, least-privilege permissions, zizmor |
| **Reporting** | ★★★★☆ | Единый отчёт, sticky PR-комментарий, SARIF→Code Scanning. TruffleHog/ZAP не в SARIF |

**Общий вердикт: ★★★★☆ (4/5)** — для инди-альфы это **очень сильный**
DevSecOps-пайплайн, выше большинства коммерческих проектов малого масштаба.
Главный gap — 4 непиненных образа (G-1), это единственный критичный пункт.

---

## 6. Предложения (приоритизированы)

| # | Предложение | Приоритет | Усилие | Зона | Когда |
|---|---|---|---|---|---|
| **1** | Перепиновать 4 образа (gitleaks/osv/trivy/syft) по sha256 | 🔴 критичный | 30 мин | `[sec]` | сейчас |
| **2** | Перевести CodeQL в блокирующий после триажа | 🟡 средний | 1 ч | `[sec]` | перед продом |
| **3** | Добавить Semgrep-правило `no-secret-in-log` (A09) | 🟡 средний | 30 мин | `[sec]` | следующий триаж |
| **4** | Перевести TruffleHog в блокирующий после триажа | 🟡 средний | 1 ч | `[sec]` | перед продом |
| **5** | Authz property-тест (случайный playerId × action) | 🟡 средний | 2 ч | `[core]` `[srv]` | перед продом |
| **6** | Authenticated ZAP scan (SEC-6.2) | 🟡 средний | 4 ч | `[sec]` | перед продом |
| **7** | Включить Dependabot для npm + actions | 🟢 низкий | 15 мин | `[sec]` | когда-нибудь |
| **8** | Создать `.gitleaks.toml` с allowlist для тестов | 🟢 низкий | 15 мин | `[sec]` | при первом FP |
| **9** | Удалить или активировать `bearer.yml` | 🟢 низкий | 5 мин | `[sec]` | когда-нибудь |

---

## 7. Оценка подхода «неблокирующие сканеры → отчёт → отдельный флоу»

Командный подход (неблокирующие сканеры копят находки, блокирующие — стоп-краны)
**правильный для текущей стадии** (альфа, нет прода, крит-путь к играбельности).
Это не «отключили безопасность», а «осознанно разделили критичное (блокирует) и
некритичное (копится)».

**Условия, при которых подход работает (все соблюдены):**
- ✅ критичное блокирует (5 сканеров: Semgrep, Gitleaks, OSV, Trivy fs/image)
- ✅ находки не теряются (отчёт + sticky PR-комментарий + artifact)
- ✅ fail-secure для упавших сканеров (сентинелы `status-<key>.json`)
- ✅ подавления с обоснованием (`.trivyignore` с датой + причиной)
- ✅ путь к ужесточению описан (ratcheting в `pipeline.md`)

**Риски подхода и митигации:**
1. **Накопленный долг растёт.** Если CodeQL находит 5 находок за PR, и мерджится
   20 PR — в отчёте 100 находок. Разобрать 100 — дороже, чем 5 за раз.
   → Митигация: порог срабатывания («если >N находок класса X — поднимаем
   приоритет триажа»); регулярный «security-triage day» (раз в спринт).
2. **«Неблокирующий» ≠ «безопасный».** CodeQL может найти реальную SQLi, и PR
   мерджится — SQLi живёт в main. Для альфы (нет данных) — приемлемо.
   → Митигация: разделить по severity — HIGH/CRITICAL блокируют сразу (как
   Gitleaks для секретов), MEDIUM/LOW — в отчёт.
3. **«Потом» должно быть запланировано.** Подход работает, только если
   «отдельный флоу» случается. У вас в `backlog.md` есть `Блок SEC` — это тот
   флоу. Главное — брать кирпичи, а не только складывать новые.

**Когда пересматривать подход:** перед переходом к **боевому деплою с реальными
пользователями**. Как только появляются аккаунты/данные/платёжи — неблокирующие
сканеры должны стать блокирующими (с severity-порогом). Это зафиксировано в
`security-master-plan.md` как «построено ≠ включено» — ровно тот разрыв.

---

_Сверено с кодом: `.github/workflows/security.yml` (13 джоб, 5 sha256-пинов, 6
TODO), `.semgrep/rules/*.yaml` (5 правил), `.trivyignore` (13 CVE, дата ревью
2026-07-10), `bearer.yml`, `Dockerfile` (digest-pinned base images),
`docs/security/pipeline.md`, `docs/security/image-pinning.md`,
`docs/security/security-master-plan.md`._