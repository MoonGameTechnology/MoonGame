#!/bin/bash
#
# Перевод хоста на автодеплой (ZTP-1.2): ОДИН раз, от root, на машине, поставленной
# install-ubuntu.sh.
#
#   cd /opt/moongame && sudo -u moongame git pull     # получить этот файл
#   sudo VOID_REGISTRY_USER=<логин> VOID_REGISTRY_TOKEN=<токен read:packages> \
#     bash /opt/moongame/deploy/install-autodeploy.sh
#
# Креды нужны, пока пакет образа в GHCR приватный; для публичного пакета их не передают.
# Повторный запуск безопасен: сделанное он узнаёт и не ломает.
#
# ЧТО ДЕЛАЕТ:
#   1. Заводит постоянный каталог состояния $STATE_DIR и переносит туда `server.env` и
#      `certs/` (на старом месте остаются ссылки — бэкап и ручные команды не ломаются).
#   2. Дописывает окно выкатки AUTODEPLOY_WINDOW (по умолчанию 04:00-07:00 по часам хоста).
#   3. Останавливает прежний юнит и ПЕРВЫЙ раз выкатывает свежий подписанный :main тем же
#      агентом, что потом работает по таймеру (`autoupdate.sh --bootstrap`). Это и есть
#      единственная ручная выкатка: точку отката агент сам не заводит никогда.
#   4. Только если сервер поднялся — ставит юниты: `moongame.service` поднимает стек на
#      дайджесте из точки отката (а не локальную сборку, как раньше, — иначе выкатка
#      жила бы до первой перезагрузки), `moongame-autoupdate.timer` раз в 5 минут
#      зовёт агента. И короткий /usr/local/bin/moongame, который зовёт deploy/moongame.sh
#      из текущей версии.
#
# Сервер при этом один раз перезапускается: на время перехода игроков отключит.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="moongame"
SERVICE_USER="${SERVICE_USER:-moongame}"
INSTALL_DIR="${INSTALL_DIR:-/opt/moongame}"
STATE_DIR="${STATE_DIR:-/var/lib/moongame}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"
REGISTRY="${VOID_REGISTRY:-ghcr.io}"
DEFAULT_WINDOW="04:00-07:00"
DOCKER_CONFIG_DIR="$STATE_DIR/docker"

say() { echo "[*] $*"; }
ok() { echo "[✓] $*"; }
die() {
  echo "[✗] $*" >&2
  exit 1
}

[ "$(id -u)" = 0 ] || die "запускать от root: sudo bash $0"
id "$SERVICE_USER" >/dev/null 2>&1 || die "нет пользователя $SERVICE_USER — хост ставился не install-ubuntu.sh?"

as_service() {
  sudo -u "$SERVICE_USER" env STATE_DIR="$STATE_DIR" DOCKER_CONFIG="$DOCKER_CONFIG_DIR" "$@"
}

# Хост с TLS-оверлеем (Caddy) фаза 1 не ведёт: агент обновляет только образ сервера, а
# стек с Caddy собирается из четырёх файлов и второго подписанного образа — это ZTP-2.2.
# Перевести такой хост наполовину значило бы после первой же выкатки потерять настройки
# TLS-оверлея у сервера. Поэтому отказ, а не полумера.
if grep -qE '^DOMAIN=[[:space:]]*[^[:space:]]' "$INSTALL_DIR/deploy/server.env" "$STATE_DIR/server.env" 2>/dev/null \
  || [ -n "$(docker ps -q --filter label=com.docker.compose.project=deploy --filter label=com.docker.compose.service=caddy 2>/dev/null)" ]; then
  die "на хосте TLS-оверлей (Caddy): автодеплой его пока не ведёт (ZTP-2.2). Обновление — как раньше, deploy/README.md"
fi

# ---- 1. каталог состояния ----
say "Каталог состояния: $STATE_DIR"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$STATE_DIR" "$STATE_DIR/releases"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$DOCKER_CONFIG_DIR"

# Перенести файл или каталог состояния из клона и оставить на старом месте ссылку.
adopt() {
  local old="$1" new="$2"
  if [ -L "$old" ]; then
    return 0 # уже перенесено прошлым запуском
  fi
  if [ -e "$old" ] && [ -e "$new" ]; then
    die "$old и $new существуют оба — какой из них настоящий, решите руками и уберите второй"
  fi
  if [ -e "$old" ]; then
    mv "$old" "$new"
    ln -s "$new" "$old"
    ok "$old → $new (на старом месте ссылка)"
  fi
}

adopt "$INSTALL_DIR/deploy/server.env" "$STATE_DIR/server.env"
[ -f "$STATE_DIR/server.env" ] || die "нет server.env — сначала поставьте сервер install-ubuntu.sh"
chown "$SERVICE_USER:$SERVICE_USER" "$STATE_DIR/server.env"
chmod 600 "$STATE_DIR/server.env"

adopt "$INSTALL_DIR/deploy/certs" "$STATE_DIR/certs"
if [ ! -e "$STATE_DIR/certs" ]; then
  install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$STATE_DIR/certs"
fi

# Точка отката хоста, который уже жил на подписанном образе (`moongame update` с
# VOID_IMAGE писал её в корень клона).
if [ ! -s "$STATE_DIR/last-good-image" ] && [ -s "$INSTALL_DIR/.last-good-image" ]; then
  install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0644 "$INSTALL_DIR/.last-good-image" "$STATE_DIR/last-good-image"
  ok "точка отката перенесена: $(cat "$STATE_DIR/last-good-image")"
fi

# ---- 2. окно выкатки ----
if ! grep -qE '^AUTODEPLOY_WINDOW=' "$STATE_DIR/server.env"; then
  window="${AUTODEPLOY_WINDOW-$DEFAULT_WINDOW}"
  cat >> "$STATE_DIR/server.env" << EOF

# Автодеплой (ZTP-1.2). Окно выкатки по часам хоста, ЧЧ:ММ-ЧЧ:ММ (может переходить
# через полночь). Пусто — катить сразу после merge. Выкатка перезапускает сервер, и
# игроков отключает, поэтому по умолчанию — ночь.
AUTODEPLOY_WINDOW=$window
# AUTODEPLOY=0 — выключить автообновление (moongame update работает и тогда).
EOF
  ok "окно выкатки: ${window:-сразу} (часы хоста: $(date +%H:%M) $(date +%Z))"
fi

# Образ, за которым следит агент, и тег можно переопределить для стенда (свой реестр,
# своя ветка); на проде оба по умолчанию, ghcr.io/moongametechnology/moongame:main.
# Пишутся в server.env, а не в юнит: оттуда их читают и таймер, и `moongame update`.
for key in VOID_IMAGE_REPO VOID_TRACK_TAG; do
  value="${!key:-}"
  [ -n "$value" ] || continue
  sed -i "/^$key=/d" "$STATE_DIR/server.env"
  echo "$key=$value" >> "$STATE_DIR/server.env"
  ok "$key=$value"
done

# ---- реестр ----
if [ -n "${VOID_REGISTRY_USER:-}" ] && [ -n "${VOID_REGISTRY_TOKEN:-}" ]; then
  (
    umask 077
    printf 'VOID_REGISTRY_USER=%s\nVOID_REGISTRY_TOKEN=%s\n' "$VOID_REGISTRY_USER" "$VOID_REGISTRY_TOKEN" > "$STATE_DIR/registry.env"
  )
  chown "$SERVICE_USER:$SERVICE_USER" "$STATE_DIR/registry.env"
  chmod 600 "$STATE_DIR/registry.env"
  printf '%s' "$VOID_REGISTRY_TOKEN" | as_service docker login "$REGISTRY" -u "$VOID_REGISTRY_USER" --password-stdin >/dev/null
  ok "доступ к $REGISTRY сохранён (только для $SERVICE_USER)"
fi

# ---- 3. первая выкатка ----
# Прежний юнит держит `docker compose up` на ЛОКАЛЬНОЙ сборке и с Restart=always: оставь
# его работать, и через десять секунд после подъёма подписанного образа он вернул бы
# сервер на свою сборку. Поэтому сначала он останавливается.
LEGACY_UNIT=0
if [ -f "$SYSTEMD_DIR/$SERVICE_NAME.service" ] && ! grep -q 'stack.sh' "$SYSTEMD_DIR/$SERVICE_NAME.service"; then
  LEGACY_UNIT=1
  say "Останавливаем прежний юнит (сборка на хосте)..."
  systemctl stop "$SERVICE_NAME" || true
fi

say "Первая выкатка подписанного :main (подпись → подъём → проверка здоровья)..."
if ! as_service bash "$HERE/autoupdate.sh" --bootstrap; then
  if [ "$LEGACY_UNIT" = 1 ] && [ ! -s "$STATE_DIR/last-good-image" ]; then
    say "Возвращаем прежний юнит, чтобы сервер не остался лежать..."
    systemctl start "$SERVICE_NAME" || true
  fi
  die "первая выкатка не удалась — автодеплой НЕ включён. Журнал: $STATE_DIR/deploy-history"
fi
[ -e "$STATE_DIR/current/deploy/stack.sh" ] || die "после выкатки нет $STATE_DIR/current — автодеплой НЕ включён"

# ---- 4. юниты и команда ----
say "Ставим юниты..."
cat > "$SYSTEMD_DIR/$SERVICE_NAME.service" << EOF
[Unit]
Description=Void Dominion Game Server (signed image, autodeploy)
Documentation=https://github.com/MoonGameTechnology/MoonGame/blob/main/docs/zero-touch-prod/README.md
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
# Юнит только ПОДНИМАЕТ стек на дайджесте из точки отката и выходит; за упавшим
# контейнером следит docker (restart: unless-stopped). Версия deploy/ — по ссылке
# current, которую агент переключает атомарно; сам юнит агент не трогает.
Type=oneshot
RemainAfterExit=yes
User=$SERVICE_USER
Environment=STATE_DIR=$STATE_DIR
Environment=DOCKER_CONFIG=$DOCKER_CONFIG_DIR
ExecStart=/bin/bash $STATE_DIR/current/deploy/stack.sh up
ExecStop=/bin/bash $STATE_DIR/current/deploy/stack.sh down
TimeoutStartSec=600

[Install]
WantedBy=multi-user.target
EOF

cat > "$SYSTEMD_DIR/$SERVICE_NAME-autoupdate.service" << EOF
[Unit]
Description=Void Dominion autodeploy: roll out the newest signed :main
Documentation=https://github.com/MoonGameTechnology/MoonGame/blob/main/docs/zero-touch-prod/README.md
After=docker.service network-online.target $SERVICE_NAME.service
Wants=network-online.target

[Service]
Type=oneshot
User=$SERVICE_USER
Environment=STATE_DIR=$STATE_DIR
Environment=DOCKER_CONFIG=$DOCKER_CONFIG_DIR
ExecStart=/bin/bash $STATE_DIR/current/deploy/autoupdate.sh
TimeoutStartSec=1800
EOF

cat > "$SYSTEMD_DIR/$SERVICE_NAME-autoupdate.timer" << EOF
[Unit]
Description=Void Dominion autodeploy every 5 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF

cat > "$BIN_DIR/moongame" << EOF
#!/bin/bash
# Хост на автодеплое (install-autodeploy.sh): команда живёт в текущей версии deploy/.
exec env STATE_DIR="$STATE_DIR" bash "$STATE_DIR/current/deploy/moongame.sh" "\$@"
EOF
chmod 755 "$BIN_DIR/moongame"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME.service" >/dev/null
systemctl start "$SERVICE_NAME.service"
systemctl enable --now "$SERVICE_NAME-autoupdate.timer" >/dev/null

echo ""
ok "Автодеплой включён."
echo "    Сейчас запущено:  $(cat "$STATE_DIR/last-good-image")"
echo "    Окно выкатки:     $(grep -m1 -E '^AUTODEPLOY_WINDOW=' "$STATE_DIR/server.env" | cut -d= -f2-) (часы хоста)"
echo "    История:          moongame history"
echo "    Выкатить сейчас:  moongame update"
echo "    Выключить:        AUTODEPLOY=0 в $STATE_DIR/server.env"
