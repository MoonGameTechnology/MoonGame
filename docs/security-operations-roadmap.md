# Независимые контуры бэкапов, логов, SIEM и реагирования

Решение владельца: 2026-10-12. **План с частично реализованным фундаментом**
(backup bundle v1 — 2026-10-13); живые площадки не проверены.
Владельцы задач — [SE-3.4/3.5, SE-8.1/8.4/8.5, SE-9.2](secure-environment-roadmap.md);
связанные [OPS-0/1](operations-roadmap.md), [MSVC-7/8/9](service-resilience-roadmap.md),
[служебные дела](staff-case-roadmap.md) и [карта сервисов](service-architecture-map.md).

## Что уже есть

- `deploy/backup.sh`/`restore.sh`: age-шифрование, проверка полноты/целостности,
  транзакционный restore и учения в CI. В legacy-формате архив и checksum-sidecar
  публикуются раздельно; общей атомарности пары нет. SE-3.4 частичный: PITR и
  фактические RTO/RPO работающего стенда не подтверждены.
- SE-3.5 частичный с 2026-10-13: opt-in `BACKUP_FORMAT=bundle-v1` создаёт один
  `.vdbak` с age-ciphertext и Ed25519-подписью manifest. Exclusive publication
  сохраняет существующие ID; restore сверяет внешний trusted key и ожидаемые
  domain/producer/backupId, затем проверяет скопированные в private staging байты
  до расшифровки/БД. Права на приватный signing key проверяются до чтения;
  уборка аварийных остатков требует exclusive `flock` и сохраняет активные
  shared-lock задания и готовые копии. Off-host repository и immutable retention
  ещё отсутствуют.
  [Настройка и ограничения](../deploy/README.md#подписанный-комплект-v1).
- Типизированный security JSONL и локальный `security.alert`; центральный сбор,
  внешний получатель, SIEM и runtime-response пока не построены.
- CI SAST/SCA/DAST/image scans проверяют выпуск. Они не являются SIEM наблюдения
  за работающей игрой и не подтверждают runtime реагирование.

## Отдельные среды и владельцы

[Карта PNG](diagrams/security-operations.png) · [PDF](diagrams/security-operations.pdf) ·
[SVG](diagrams/security-operations.svg) · [DOT](diagrams/security-operations.dot).

| Контур | Сервис/роль и данные | Граница |
| --- | --- | --- |
| Игровые домены | Game/Auth, Inventory, Auction, Corp, Staff; первичные данные/receipts | Свои runtime/data ACL; backup/restore/response credentials в игре отсутствуют |
| Наблюдаемость | Collector/spool, log/audit store, метрики/поиск | Отдельная среда/пулы; producer пишет свой поток, сотрудник не удаляет историю |
| Security analytics | SIEM, detections, incident records | Отдельная среда/identity от игры и пультов; чтение разрешённых security-потоков |
| Реагирование | Incident/runbook admission и ограниченные response workers | Отдельный management-контур; у detector нет общего shell/DB-admin |
| Backup | Доменные jobs, WAL/base backup, encrypted repository | Repository вне игрового хоста/его общего admin-доступа; write/retention/delete/restore роли раздельны |
| Restore/forensics | Изолированный lab и target | Отдельный target, контролируемый key-release, read-only анализ; живые аккаунты не цель учения |

Контуры развёртываются независимо. Для recovery/audit недостаточно второго
контейнера на игровом хосте: нужны другие ресурсы хранения и границы доступа,
проверенные при потере/захвате игрового хоста. Сеть, account/project и retention
выбираются под площадку; отдельный кластер на каждый фильтр, Kafka, Kubernetes,
service mesh или конкретный SIEM-вендор не обязательны. Один общий root-credential
не считается изоляцией; namespaces, quotas и secrets разделяются.

## Backup и восстановление — SE-3.4/3.5, SE-9.2

**Полный целевой контракт ниже остаётся планом.** Реализованный manifest v1
связывает domain, producer, backupId, время создания, формат, длину и SHA-256
ciphertext. Он пока не содержит schema/image/data pins и snapshot/WAL interval.
Trusted verify-key и ожидаемая identity/ID задаются снаружи; подпись подтверждает
происхождение от signer и неизменность, но не свежесть или корректность данных.
Backup signing key отличается от приватного age restore-key; создание комплекта
не требует restore-key. Внешний TLS-транспорт, immutable IAM/retention,
freshness-мониторинг, controlled key-release и независимый restore lab ещё нужны.
`BACKUP_KEEP_DAYS` обслуживает только legacy-архивы; `.vdbak` не удаляются им,
но остаются удаляемыми владельцем локальных файлов.

- Автоматические jobs работают по расписанию/policy и не ждут ручного тикета.
  Backup-role читает свой домен и явно нужную WAL/replication область, не меняет
  данные. Передача в repository — TLS с проверкой peer.
- Шифрование до отправки. Приватный restore-key отсутствует в игровом runtime,
  пультах, SIEM и постоянных backup jobs. Release ключа в restore job отдельно
  авторизован, ограничен по сроку и аудируется независимо.
- Writer создаёт новые объекты без удаления/замены старых версий или изменения
  retention. Versioning/immutable lock/lifecycle управляются отдельной ролью.
  Захват runtime или backup writer не должен позволять уничтожить старые копии.
- Manifest связывает домен, snapshot/WAL interval, schema/image/data pins, digest,
  время/identity job и происхождение. Подпись/аттестация manifest и protected
  version-history проверяются перед restore; checksum не заменяет аутентичность.
- У каждого домена — RPO/RTO, возраст последней восстановимой копии, WAL lag,
  ошибки доставки/key/manifest. Значения измеряются на целевом учении, прежняя
  локальная скорость не объявляется prod SLO.
- Restore сначала в отдельный target: схема/ACL, снимки, receipts/ledger и pins
  сверяются. Учение включает потерю игрового хоста, повреждённый/обрезанный архив,
  недоступные repository/key и WAL-gap.
- Независимые БД требуют согласованного recovery plan: точки восстановления,
  freeze writers и reconciliation trade/settlement/result/grant receipts.
  Произвольный rollback одной БД не доказывает сохранность всей экономики.
  Restore Staff/authority не возрождает отозванные права: новая fencing эпоха,
  сверка revocations/policy с защищённым авторитетным источником до admission.
  Accepted commands/квоты сверяются с доменными receipts без повторной выдачи.

## Логи и аудит — SE-8.1, OPS-0.1

Versioned события несут source identity, eventId, permitted correlation IDs,
case/action/incident и outcome. Tokens/keys, сырые payload и произвольный PII
не попадают в поток. Чтения сотрудников, retention и redaction имеют свою policy.
Runtime отправляет только свой поток по authenticated ingress.

Телеметрия передаётся асинхронно через bounded buffers/spool; потеря/семплинг
некритичного потока объявляются и измеряются. Критичный audit/receipt owner пишет
атомарно с эффектом, затем доставляет в независимый append-only store с dedup/replay.
Отказ collector/SIEM не тормозит горячий путь боя и не теряет сохранённое событие.
Рост backlog/spool контролируется; при exhaustion новые sensitive actions
ограничиваются до принятия, история не удаляется. Collector/store не имеют права
запускать команды в игровых доменах.

## SIEM и реагирование — SE-8.4/8.5

SIEM читает разрешённые потоки и создаёт incidents: необычные staff grants,
отказы scope/epoch, массовые санкции/компенсации, попытки удалить audit/backup,
смена ролей/ключей, auth/rate/network и отсутствие heartbeat/доставки. Нужны каталог
detections, позитивные/негативные тесты, suppression с owner/TTL и оценка false
positives. Alert не объявляется доказанным нарушением.

Response — отдельный исполнитель предопределённых runbooks. У detector нет общего
Docker/SSH/SQL, прав банить игроков или менять ценности. Policy задаёт допустимые
автоматические действия, ресурс, предел воздействия, actionId и остановку/откат.
Ручные/чувствительные операции требуют полномочий инфраструктурного оператора и
предусмотренного независимого одобрения. Эти права не выдаются модератору через
обычный support ticket.

Response имеет собственные incident/runbook admission, policy/epochs, scoped
credentials, receipt/status и аудит; вход — management gateway MSVC-8. Разрешения
ограничены конкретным job/ресурсом: например отзыв определённой identity, изоляция
одного домена или controlled recovery. Mass-ban, удаление данных и restore поверх
prod не являются общей автоматической реакцией на произвольный алерт. Широкие/
деструктивные действия задаются отдельным проверенным runbook с явными полномочиями.
Автоматический retry разрешён только при подтверждённой idempotency/status у target.
Для действий без такого контракта потеря ответа оставляет неизвестный исход и
требует сверки оператором; «exactly once для произвольного SSH-скрипта» не обещается.

Incident admission/journal и responder работают независимо от Staff/Support и
игрового хоста. Incident → staff-case — асинхронная корреляция; отказ Staff не
стирает actor/основание/policy/approval/outcome и не снимает авторизацию. Если SIEM
недоступен, заранее разрешённый ручной runbook доступен через независимый management.
При отказе обязательного incident admission новая response команда не принимается;
принятые статусы/восстановление сохраняются. Это не скрытый super-admin.
Incident/runbook journal принадлежит response admission, не SIEM DB; ручной путь
и management identity/авторизация независимы от игрового Auth и staff-directory.
Workload executor получает только назначенный actionId/lease, не право менять policy.

## Матрица отказов и приёмка

| Отказ | Сохраняется | Ограничение |
| --- | --- | --- |
| Collector/log search | Обычная игра и локальные подтверждённые audit/receipts | Bounded backlog; lost telemetry видима, новые sensitive actions ограничиваются при exhaustion |
| SIEM | Игра, заранее разрешённые ручные response runbooks | Детект задерживается; внешний heartbeat/pipeline контроль и incident журнал продолжаются |
| Response executor | Игра, детект и durable incidents | Принятые actions восстанавливаются по ID, новые без admission не исполняются |
| Backup job/repository | Игра и текущая БД | Алерт на RPO/возраст; успешная копия не обещается до restore-проверки |
| Staff/Support | Игра, автоматические backup jobs, infra incident/response | Новые игровые staff-команды приостановлены, incident журнал независим |
| Игровой хост/credentials | Off-host audit/repository и отдельный security/management | Recovery проверяется учением; общий cloud/root остаётся общей точкой риска |

До rollout проверяются default-deny/roles, запреты удалить архивы/аудит от имени
producer/сотрудника, отсутствие restore-key в runtime, spoof/replay logs, потеря
response commit-ответа и отказ всех контуров на своих синтетических ресурсах.
Потоки имеют общую корреляцию, но собственные состояния/права; они не становятся
общей обязательной зависимостью боя.

## Последовательность внедрения

1. **SE-3.5 и SE-8.1:** независимые архивы/ключи и audit/log delivery;
   restore-учение SE-9.2 подтверждает копии до расширения операций с ценностями.
2. **SE-8.5 / MSVC-8:** собственное incident admission, ограниченные исполнители
   и проверенные ручные runbooks; аварийный management не ждёт появления SIEM.
3. **SE-8.4:** SIEM читает разрешённые потоки, проверяются detections/heartbeat
   и ложные срабатывания; сначала наблюдение и объяснимые incidents.
4. Автоматические response triggers подключаются только к принятым runbooks
   после проверки scope/approval/status и воздействия на синтетических ресурсах.

Каждый rollout проходит сетевые/credential пробы MSVC-7/9 и своё учение отказа.
Зелёный документ или локальный backup-тест не закрывают эти задачи на живом стенде.
