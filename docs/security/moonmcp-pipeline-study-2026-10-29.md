# MoonMCP — исследование поведения: находки и пробелы

- **Дата:** 2026-10-29 · **Версия сервера:** `server_status` build `a93e1405a2dd6a9881e2`, 232 tools, `compact_mode=false`
- **Deployment:** `MOONMCP_ALLOW_INTRUSIVE=false`, `MOONMCP_BLOCK_PRIVATE=true`, Shodan off / NVD on, rate_limit 10/s, concurrency 10
- **State:** `engagements/_moonmcp_state/` (memory.db персистентен между сессиями и агентами)
- **Активная программа на момент старта:** `rowi` (T-Bank Standoff365) — профильная машина `program_use` работает, наш стенд работал поверх через `scope_add`

---

## A. Найдки — как он себя ведёт на практике (проверено вызовами)

### A1. Ориентационный конвейер работает, но требует обязательного `tool_describe`
- `server_status` → `tool_catalog` (полная карта: 232 тулов, 9+ семей с counts) → `tool_search` («карточки», метаданные scope/intrusive/availability) → `tool_describe` (полные JSON-схемы).
- **Карточки — не контракты:** «Rank is not permission and does not reduce client-loaded schemas». Реально ловили расхождения:
  - `port_scan`: `ports` — **строка**, не массив;
  - `tool_describe`: параметр называется **`name`** (не `tool`);
  - `flag_record`: требует `project+target+evidence[]` (объекты с `ref+source_group`);
  - `hypothesis_record`: требует `flag_ids` ≥1 **реальных** флагов;
  - `run_start`: нет `scope`/`brief` — только `target/focus/бюджеты`;
  - `run_claim`: нужен `owner`;
  - `run_task_update`: **не принимает `run_id`** (только task).
- Вывод: workflow «search → describe → call» обязателен; первый поиск почти всегда возвращает карточку со схемой-ловушкой.

### A2. Scope и адресная политика
- `scope_add` работает для hostname/IP/URL; **labels отклоняются** («target must be a hostname, IP, or URL without credentials») — флаги на стенде пришлось адресовать `http://127.0.0.1:18080`, а не словесным ярлыком.
- `flag_record.target` валидируется жёстче, чем `scope_add` — два разных валидатора.
- **`target_key` нормализует URL → IP без порта:** корреляция флагов по «same_host» склеивает стенды `18080` и `18081` в один ключ (проверено: related вернул F12/f10 к флагу r2). Для мультистендов ключ теряет разделяющую информацию.
- **`MOONMCP_BLOCK_PRIVATE` блокирует send-тулы на 127.0.0.1 даже при in-scope scope_add** (`run_start` на стенд → `out_of_scope`). Обойти рантаймом нельзя — только env.

### A3. Intrusive-гейт — работает как заявлено
- `port_scan` на in-scope цель → `{"error":"disabled","detail":"intrusive tools are disabled. Enable with MOONMCP_ALLOW_INTRUSIVE=1."}` — отказ приходит **после** scope-проверки, с явным env-хинтом. 23 intrusive-тула (портиing, nuclei, smuggling, SSRF-metadata, race/logic/value/workflow probing) недоступны без env — для стендовых фаз нужен отдельный запуск с `MOONMCP_ALLOW_INTRUSIVE=1`.

### A4. Memory hub — персистентный и «дисциплинирующий»
- SQLite-хаб переживает сессии: на старте был **56 curated items** из прошлых engagements (45 findings, HTB-lessons и пр.).
- `memory_brief` даёт rollup: флаги, гипотезы, lessons по проекту/таргету; lesson от прошлой сессии уже записывал известные пробелы.
- **Evidence-discipline навязывается тулчейном:**
  - `flag_record` требует evidence-объекты (ref+source_group);
  - `hypothesis_record` отказывается без ≥1 supporting flag;
  - **`hypothesis_update(refuted)` отказывается без «completed check»** — нельзя просто декларировать опровержение («a failed check is inconclusive»);
  - Флаги создаются с `trust: "untrusted"` → promotion в findings вручную (`promote_lead`→`confirm_finding`→`cvss_score` по доктрине). «Correlations suggest checks; they never confirm a vulnerability».
- **Автокорреляция:** флаг на 18081 вернул `related` c F12/F10/T15 флагами того же хоста — связывание по `target_key`.

### A5. Orchestration — полноценный каркас с бюджетами
- `run_start(target, focus, max_requests=1000, max_tool_calls=250, max_intrusive=25)` создаёт персистентный run с **5-ролевым графом задач** (coordinator→mapper→hypothesis→validator→reporter с priority 100→60 и depends_on), **7 coverage-элементов** и бюджетами.
- Проверено: `run_status` (бюджеты used/max, task counts, coverage %), `run_next` (детерминированная выдача), `run_claim` (атомарно: `claim_token` + `lease_until` + attempts), `run_artifact_add` (immutable, **sha256 + URI `moonmcp://runs/<id>/artifacts/<n>`**).
- После claim `run_next` возвращает `null` — lease-механика блокирует следующий до `run_task_update` (или expiry lease ≈3 мин).
- Проверка из A2: `run_start` на private-цель отказался по `MOONMCP_BLOCK_PRIVATE`, на публичную — работает.
- В `run_execute` — «Execute one allowed tool within a run with automatic budgets, receipts and evidence» (не доэкспериментировали — см. пробелы B7).

### A6. Знание-базы и AI-хантеры
- 22 knowledge-тула: injection/techniques/privesc/vuln/rootcause (~13 фундаментальных причин)/**playbooks Strix AI (51 файл)** + tooling-каталоги (sqlmap, ysoserial, GTFOBins…).
- **AI-хантеры**: `cve_patch_diff` (patch-diff gap analysis), `variant_search`, `version_vuln_check` — «Kimi K3» паттерны для 0day-рыбы.
- `deduplicate_findings`, `render_finding_md`, `export_csv`, `generate_remediation` — reporting-семейство готово к приёмке находок.

### A7. Память флага → гипотезы → refuted — полный цикл прошёл (T15)
- flag → hypothesis (с supports) → live test → `hypothesis_update(refuted)` — единственный камень: «refuted» требует завершённый check через собственный механизм (наблюдение, не баг — но UX трение).

---

## B. Пробелы (gaps) — что не покрыто или мешает

| # | Gap | Влияние | Обход/рекомендация |
|---|---|---|---|
| B1 | **`detect_prompt_injection` отсутствует** (ретирнут с hermes-pipeline; поиск по «prompt injection detect» не находит тул-анализа fetched content) | Нет автоматического сканирования HTML/JS/JSON целевых страниц на injection-паттерны против агента | Ручной скан (инъекционные regex, base64-блобы, zero-width) перед действием на непроверенный контент; переинтегрировать тул |
| B2 | **Private/loopback цели заблокированы send-тулам** (`MOONMCP_BLOCK_PRIVATE`, env-only) | Стенд/интранет цели (18080/18081, Docker-сети) недоступны инструментами moonmcp в принципе | Для стендов: либо env-релиз (`MOONMCP_BLOCK_PRIVATE=0` на контролируемом запуске), либо bash/python-стек; иначе тестируется только публичная поверхность |
| B3 | **Browser-тулы мертвы в этом деплое** (`playwright_package_missing` → `browser_open/browser_eval/browser_interact/screenshot/cspp_probe` недоступны) | Нет живого рендера/SPA-драйва: click-flow, client-side prototype pollution, скриншоты недоступны из коробки | `pip install playwright && playwright install chromium`; иначе — внешний playwright-харнесс (как в корп-смоук игры) |
| B4 | **scope_add не переживает рестарт** MCP/агента (persist только program-профили) | Runtime-скоуп теряется при перезапуске opencode | Фиксировать цели в `program_*` профилях или ре-add scope после рестарта |
| B5 | **target_key = IP (без порта/схемы)** в memory-корреляции | Два стенда на одном хосте сливаются в один бакет флагов/гипотез (проверено: related связал 18080 и 18081) | Включать порт в target_key или в теги флагов |
| B6 | **Нет raw-TCP/не-HTTP сенд-тулов** | Не-HTTP сервисы (игровые TCP-порты, сырые сокеты) — мимо moonmcp (lesson из HTB: «degrades to internal_error») | bash/nc/собственные харнессы |
| B7 | **run-фреймворк: lease-артефакты** — застрявшая «running» задача живёт до lease-expiry; `run_task_update` схема не совпадает с `run_claim` (не принимает run_id); `run_execute` не был прогнан в этой сессии | Полный цикл «claim→execute→update» требует ещё одного захода с описанием схем | `tool_describe` перед каждым оркестратор-тулом; тест `run_execute` на демо-ране |
| B8 | **Схемные расхождения search↔describe** (ports-строка, name/name-ключи, опциональные required) | Трение на каждом первом вызове тулов | Дисциплина describe-first; патчноут в registry |
| B9 | Shodan key не настроен (`host_intel`/`reverse_ip` деградируют без ключа) | OSINT-ветка неполная на этом деплое | Подключить SHODAN_API_KEY в env |
| B10 | **WS/GraphQL/OAuth-пробы заявлены, но на Void Dominion неприменимы напрямую** (нет GraphQL/OAuth surface; WS — кастомный протокол игры) — универсальные детекторы не заменяют ручную работу по кастомным протоколам | Покрытие кастомных WS-протоколов (наш матч-протокол) — только ручные харнессы | Держать ручные WS-харнессы; moonmcp — для стандартных поверхностей |
| B11 | `memory_brief.entities` пуст (knowledge-graph nodes не заполнялись в этой сессии) — граф работает, но требует `memory_add/memory_link` руками | Граф не построит связи сам | Ссылать флаги через `memory_link` (typed edges) для запросной структуры |

---

## C. Позитив: что moonmcp даёт поверх bash-стека
1. **Гейты вместо самодисциплины**: scope/intrusive/private/scope-validation — отказы структурные, с хинтами (не «пожалуйста, не надо»). Для authorized-пентестов это снимает риск заехать вне скоупа при усталости/при контексте-компакции.
2. **Персистентная память + evidence-дисциплина** — флаги/гипотезы переживают смену сессий; связность по хосту; ручная курация как контроль ложных находок.
3. **Оркестрация с бюджетами/coverage-гейтом/лидами** — resumable каркас для мульти-агентных заходов (координатор/маппинг/гипотезы/валидация/репорт).
4. **Знание-базы локально** — injection/privesc/rootcause/playbooks без сети; AI-хантеры для 0day-рыбы.

## D. Статус объектов в памяти (на момент файла)
- Run `a62f0fe5e50c4700` (orchestration demo, prod-таргет): задача 1 в `running` с lease (истекает ~3 мин → run_next снова выдаст); artifact №1 записан (sha256 `76558a05…`).
- Флаги: `flag_0e17…` (F11 e2e), `flag_dea9…` (F12), `flag_ec9d…` (F10), `flag_476c…` (T15) — trust=untrusted, требуют курирования/promote при оформлении отчёта.
- Гипотеза `hyp_cc5f…` (T15 soulbound laundering) — `proposed`; для закрытия нужно проверить через `confirm_finding`/check-механизм и перевести в `refuted` (текущий блокер — «refuted требует completed check»).
- Lessons (curated) уже покрывают: private-scope, raw-TCP, не-HTTP-деградацию — этот файл их консолидирует и расширяет (B1–B11).

## E. Рекомендации по конвейеру
1. **Стенд-фазы**: запускать MCP с `MOONMCP_BLOCK_PRIVATE=0 MOONMCP_ALLOW_INTRUSIVE=1` на выделенной авторизованной сессии — иначе только bash.
2. **Промоутить флаги** (F12/F10/F13/F11) через `promote_lead/confirm_finding/cvss_score` при финальном отчёте — тогда память станет источником curated findings для следующих сессий.
3. **Дописать `detect_prompt_injection`** (или KB-хук над fetched content) — пробел B1 — единственный hole из старого конвейера hermes.
4. **Playwright** в окружение MCP — оживить 5 browser-тулов + cspp_probe.
5. **Port-aware target_key** в memory-корреляции (мелкий патч, убирает ложные merge).
6. **run_task_update/run_execute** схемы — прогнать демо-цикл до конца и зафиксировать в lessons.
---

## A8. Поздняя сессия — дополнительные проверенные поведения (после первой ревизии файла)

| Поведение | Проверено живьём |
|---|---|
| **`run_execute` end-to-end** | invocation `7605c866…`, state `completed`, инлайн-данные, **бюджеты списываются** (requests 1/50, tool_calls 1/25); `arguments` = РАВная схема внутреннего тула (`http_probe` ← `target`, не `url`) |
| **Lease-expiry авто-блок** | задача после ~3 мин lease уходит в `blocked` с текстом «outcome unknown. Reconcile evidence before retry»; `run_next` → null; `run_recover/run_reconcile` — единственный путь разблокировки |
| **`oast_selfhost` + `oast_generate`** | поднят локальный кэтчер 127.0.0.1:34649; заминчён канари `57d0eab7…` с http/https-URL (blind-chain готов к использованию) |
| **`probe_batch` как детектор прод-флапа** | поймал живой 502-инцидент прода (Caddy жив, апстрим мёртв) — F9 evidence #7/8; параллельные пробы 2 URL |
| **`jwt_analyze`** | декод prod-токена: structure ok, единственный флаг «HS256 weak-secret caveat» — консистентно с ручным аудитом; iss/aud/pwfp/exp показаны |
| **`memory_brief`/`analysis_brief`** | rollup по проекту+таргету: флаги/гипотезы/lessons; entities пусты (граф требует ручного `memory_link`) |
| **`http_probe` на прод** | полный header-набор + body, без утечек |
| **Related-корреляция продолжила работать** | каждый новый флаг вернул список уже существующих по host |

## D2. Полный ledger флагов этой сессии (memory.db, `engagements/_moonmcp_state/`)

| Флаг | О чём |
|---|---|
| `flag_ec9d840e…` | F10 reconnect-churn budget |
| `flag_dea9e2af…` | F12 XFF-bypass (TRUST_PROXY=1) |
| `flag_476c4378…` | T15 laundering closed (refuted гипотеза) |
| `flag_0e177a18…` | F11 erasure worker e2e |
| `flag_bd91ac82…` | **F16 material duplication (HIGH)** |
| `flag_26968dbd…` | F14 entry-window awake-sim-time |
| `flag_90bc18dd…` | Second-pass L2-battery wave-1 |

Гипотеза: `hyp_cc5f…` (T15) — `proposed`, для перевода в `refuted` нужен check через `confirm_finding`-механизм.

## D3. Сессионный разрыв (2026-11-04)
- Операторский бокс перезапустился: **memory.db пережил** (флаги и гипотезы на месте), moonmcp вернулся в каталог с полным набором тулов.
- Авторский стенд/tmpfs погиб (см. §19 отчёта) — флаги стенда остались единственным напоминанием о state 18080/18081.
- Инфра-вывод: `MOONMCP_STATE_DIR` + sqlite = единственная часть сессии, пережившая перезагрузку. Работает именно так, как задокументировано.

## B12. Поздние пробелы (дополнение к списку)
- **B12-1**: `flag_record.target` и `run_start.target` валидируются РАЗНЫМИ валидаторами (labels ок для run-фокуса, нет для флагов) — унифицировать.
- **B12-2**: `hypothesis_update(refuted)` требует check-механику, но не даёт прямого поля «observations completed» — UX-дыра для легитимных ручных опровержений (наш T15 case дошёл до refuted только флагом, не через гипотезу).
- **B12-3**: `run_execute.arguments` — сырой слепок без подсказки, какие поля нужны внутреннему тулу: `tool_describe(внутренний тул)` обязателен в том же шаге.
- **B12-4**: probe_batch/http_probe на флапающий прод вернули 502 молча (без ретрая/эскалации) — для наблюдения за деградацией нужен polling-хелпер с retry-статистикой.
