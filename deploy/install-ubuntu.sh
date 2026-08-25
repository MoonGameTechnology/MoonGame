#!/bin/bash

#############################################################################
# Void Dominion — Ubuntu Server One-Click Installer
#
# Автоматическая установка проекта на Ubuntu с Docker Compose
# Использование: sudo bash deploy/install-ubuntu.sh
#
# Что устанавливает:
#   - Docker + Docker Compose
#   - Клонирует репозиторий
#   - Настраивает systemd сервис для автозапуска
#   - Запускает сервер
#############################################################################

set -e  # Exit on error

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Конфигурация (любую переменную можно переопределить окружением: VAR=... ./install-ubuntu.sh)
REPO_URL="${REPO_URL:-https://github.com/MoonGameTechnology/MoonGame.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
INSTALL_DIR="/opt/moongame"
SERVICE_USER="moongame"
SERVICE_NAME="moongame"
DOCKER_COMPOSE_FILE="$INSTALL_DIR/deploy/docker-compose.yml"
ENV_FILE="$INSTALL_DIR/deploy/server.env"

# Параметры сервера. INTERNAL_IP определяется автоматически; внешние адрес/порт
# зависят от роутера/провайдера — задай их окружением, если пробрасываешь наружу.
INTERNAL_IP="${INTERNAL_IP:-$(hostname -I | awk '{print $1}')}"
EXTERNAL_IP="${EXTERNAL_IP:-}"
EXTERNAL_PORT="${EXTERNAL_PORT:-}"
INTERNAL_PORT="${INTERNAL_PORT:-8788}"
TIME_SCALE="${TIME_SCALE:-100}"
POSTGRES_PASSWORD="moongame_dev_$(openssl rand -hex 8)"
# Секрет подписи join-токенов. Гард checkProductionReadiness требует ≥32 символов
# (MIN_SECRET_LEN), поэтому 32 байта hex = 64 символа — с запасом.
AUTH_JWT_SECRET="$(openssl rand -hex 32)"
# Origin, по которому игроки открывают игру — идёт в ALLOWED_ORIGINS (CSWSH-allowlist).
# Браузер присылает РОВНО тот origin, на котором открыта страница, поэтому внешний
# адрес (если он задан) добавляется вторым: через роутер это другой хост:порт.
ALLOWED_ORIGINS="http://$INTERNAL_IP:$INTERNAL_PORT"
if [ -n "$EXTERNAL_IP" ]; then
    ALLOWED_ORIGINS="$ALLOWED_ORIGINS,http://$EXTERNAL_IP:${EXTERNAL_PORT:-$INTERNAL_PORT}"
fi

# Функции для вывода
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Проверка, запущен ли скрипт от root
if [[ $EUID -ne 0 ]]; then
    log_error "Скрипт должен быть запущен от root (используй: sudo bash deploy/install-ubuntu.sh)"
    exit 1
fi

log_info "=========================================="
log_info "Void Dominion — Установка на Ubuntu"
log_info "=========================================="

# Проверка ОС
if ! grep -qi ubuntu /etc/os-release; then
    log_error "Этот скрипт работает только на Ubuntu"
    exit 1
fi

log_info "Обновление пакетов системы..."
apt-get update
apt-get upgrade -y

# Проверка и установка Docker.
# ВАЖНО: ключ репозитория ставится файлом в /etc/apt/keyrings + `signed-by`, а НЕ через
# `apt-key add`. apt-key объявлен устаревшим и УДАЛЁН начиная с Ubuntu 24.04, поэтому
# старый путь ронял установку на 24.04/26.04 ещё до первого apt-get install. Кодовое имя
# берём из VERSION_CODENAME (lsb_release может отсутствовать на минимальном образе).
if ! command -v docker &> /dev/null; then
    log_info "Установка Docker..."
    apt-get install -y ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    UBUNTU_CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $UBUNTU_CODENAME stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    log_success "Docker установлен"
else
    log_success "Docker уже установлен"
fi

# Compose нужен как ПЛАГИН (`docker compose`) — именно его зовут и systemd-юнит, и
# deploy/update.sh. Standalone-бинарь `docker-compose` здесь не используется нигде, поэтому
# он больше не качается: тот блок дёргал api.github.com без токена и при исчерпании
# лимита молча клал битый файл в /usr/local/bin.
if ! docker compose version &> /dev/null; then
    log_error "Плагин 'docker compose' недоступен — установи docker-compose-plugin и повтори"
    exit 1
fi
log_success "Docker Compose (плагин) на месте"

# Включение Docker демона при старте
systemctl enable docker
systemctl start docker

# Создание пользователя для сервиса
if ! id "$SERVICE_USER" &>/dev/null; then
    log_info "Создание пользователя $SERVICE_USER..."
    useradd -m -d /home/$SERVICE_USER -s /bin/bash $SERVICE_USER
    usermod -aG docker $SERVICE_USER
    log_success "Пользователь создан"
else
    log_success "Пользователь $SERVICE_USER уже существует"
    usermod -aG docker $SERVICE_USER
fi

# Создание директории проекта
log_info "Подготовка директории установки..."
if [ -d "$INSTALL_DIR" ]; then
    log_warning "Директория $INSTALL_DIR уже существует"
    read -p "Заменить существующую установку? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$INSTALL_DIR"
    else
        log_error "Установка отменена"
        exit 1
    fi
fi

mkdir -p "$INSTALL_DIR"
chown $SERVICE_USER:$SERVICE_USER "$INSTALL_DIR"

# Клонирование репозитория
log_info "Клонирование репозитория..."
cd "$INSTALL_DIR"
git clone --branch $REPO_BRANCH $REPO_URL .
chown -R $SERVICE_USER:$SERVICE_USER "$INSTALL_DIR"
log_success "Репозиторий клонирован"

# Конфиг сервера. ВАЖНО: файл называется server.env, а НЕ .env — значит docker compose
# сам его не подхватит (он читает только .env рядом с проектом). Systemd-юнит ниже
# отдаёт его через EnvironmentFile, а все ПРЯМЫЕ вызовы compose обязаны передавать
# --env-file "$ENV_FILE" явно, иначе интерполяция ${POSTGRES_PASSWORD:-void} молча
# подставит дефолт, и стек поднимется с другим паролем, чем под systemd.
log_info "Создание конфигурации сервера..."
cat > "$ENV_FILE" << EOF
# Void Dominion — Конфигурация сервера

# Порт
PORT=$INTERNAL_PORT

# Ускорение времени для разработки (1 = реальное время)
TIME_SCALE=$TIME_SCALE

# Количество матчей
MATCHES=1

# Пароль PostgreSQL
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# Релизная постура (как в docker-compose): гейт действий + блокировка мест.
# Для локальной отладки можно временно выставить 0/0 — но не на плейтесте с людьми.
GATE=1
SEAT_LOCK=1

# Секрет подписи join-токенов (сгенерирован установщиком, уникален для этой машины).
# Держи его СТАБИЛЬНЫМ: смена секрета обесценивает выданные билеты, и все игроки
# логинятся заново.
AUTH_JWT_SECRET=$AUTH_JWT_SECRET

# Origin-allowlist против CSWSH: без него браузер отдаст сессию на wss:// с чужой
# страницы. Значение — ровно тот адрес, с которого игроки открывают игру.
ALLOWED_ORIGINS=$ALLOWED_ORIGINS

# ПОСТУРА. PROD=1 — это fail-secure гард (checkProductionReadiness): под ним сервер
# ОТКАЗЫВАЕТСЯ стартовать, пока не включены auth + gate + seat-lock + TLS. Этот
# установщик поднимает стек по ПЛАЙНОМУ HTTP в локальной сети, TLS здесь нет — значит
# под PROD=1 сервер честно падал бы в цикл перезапуска. Поэтому здесь явный dev-режим.
#
# GATE и SEAT_LOCK выше при этом ОСТАЮТСЯ включёнными — они не зависят от PROD.
# Отключается только загрузочная проверка, а не валидация действий и билеты на места.
#
# ПЕРЕД ВЫХОДОМ В ИНТЕРНЕТ: подними TLS (deploy/docker-compose.tls.yml + DOMAIN),
# поставь ALLOWED_ORIGINS=https://<домен> и верни PROD=1.
# Не выставляй TRUST_PROXY=1 «чтобы гард замолчал» без реального прокси перед сервером:
# тогда сервер поверит заголовку X-Forwarded-For от клиента, и лимиты по IP обойдёт кто угодно.
PROD=0
EOF

chown $SERVICE_USER:$SERVICE_USER "$ENV_FILE"
chmod 600 "$ENV_FILE"
log_success "Конфигурация создана"

# Создание systemd сервиса для управления
log_info "Настройка автозапуска (systemd)..."
cat > /etc/systemd/system/$SERVICE_NAME.service << EOF
[Unit]
Description=Void Dominion Game Server
Documentation=https://github.com/MoonGameTechnology/MoonGame
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR/deploy
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
EnvironmentFile=$ENV_FILE

# Запуск сервера
ExecStart=/usr/bin/docker compose up --remove-orphans

# Остановка
ExecStop=/usr/bin/docker compose down

# Автоматический перезапуск при ошибке
Restart=always
RestartSec=10
StartLimitInterval=60
StartLimitBurst=3

# Логирование
StandardOutput=journal
StandardError=journal
SyslogIdentifier=moongame

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $SERVICE_NAME.service
log_success "Systemd сервис настроен"

# Скрипта обновления здесь НЕТ — и не должно быть (OPS-1). Раньше `update-dev.sh`
# генерировался тут heredoc'ом и писался на диск ОДИН раз, при установке: починка
# самого механизма обновления до развёрнутой машины не доезжала — `moongame update`
# тянул свежий код, но продолжал исполнять свою старую копию (так на живой машине
# остался сломанный на «dubious ownership» скрипт уже после того, как фикс влился).
# Теперь механизм обновления — обычный файл репозитория `deploy/update.sh`, приезжает
# клоном выше и обновляется вместе с остальным кодом. Хелпер ниже только зовёт его.

# Создание хелпера для управления
log_info "Создание управляющих команд..."
cat > /usr/local/bin/moongame << 'HELPEREOF'
#!/bin/bash

SERVICE_NAME="moongame"
INSTALL_DIR="/opt/moongame"

case "$1" in
    start)
        sudo systemctl start $SERVICE_NAME
        echo "Сервер запущен"
        ;;
    stop)
        sudo systemctl stop $SERVICE_NAME
        echo "Сервер остановлен"
        ;;
    restart)
        sudo systemctl restart $SERVICE_NAME
        echo "Сервер перезапущен"
        ;;
    status)
        sudo systemctl status $SERVICE_NAME
        ;;
    logs)
        sudo journalctl -u $SERVICE_NAME -f
        ;;
    update)
        bash $INSTALL_DIR/deploy/update.sh
        ;;
    shell)
        cd $INSTALL_DIR
        bash
        ;;
    *)
        echo "Void Dominion — управление сервером"
        echo ""
        echo "Использование: moongame [команда]"
        echo ""
        echo "Команды:"
        echo "  start       — запустить сервер"
        echo "  stop        — остановить сервер"
        echo "  restart     — перезапустить сервер"
        echo "  status      — статус сервера"
        echo "  logs        — вывести логи (Ctrl+C для выхода)"
        echo "  update      — обновить код и перезапустить"
        echo "  shell       — оболочка в директории проекта"
        echo ""
        ;;
esac
HELPEREOF

chmod +x /usr/local/bin/moongame
log_success "Команды CLI установлены"

# Запуск сервера
log_info "Запуск Docker контейнеров..."
log_warning "Это займет время (~2-3 минуты) при первом запуске..."
cd "$INSTALL_DIR/deploy"
sudo -u $SERVICE_USER docker compose --env-file "$ENV_FILE" up -d --build

# Проверка здоровья сервера
log_info "Проверка здоровья сервера..."
sleep 10

for i in {1..30}; do
    if curl -sf http://localhost:$INTERNAL_PORT/health &>/dev/null; then
        log_success "Сервер готов к работе!"
        break
    fi
    if [ $i -eq 30 ]; then
        log_error "Сервер не отвечает (проверь: moongame logs)"
        exit 1
    fi
    echo -n "."
    sleep 1
done

# Финальная информация
echo ""
log_success "=========================================="
log_success "Установка завершена!"
log_success "=========================================="
echo ""
echo -e "${BLUE}🎮 Доступ к серверу:${NC}"
echo "  Локально:  http://$INTERNAL_IP:$INTERNAL_PORT"
if [ -n "$EXTERNAL_IP" ]; then
    echo "  Снаружи:   http://$EXTERNAL_IP:${EXTERNAL_PORT:-$INTERNAL_PORT} (требует проксирования)"
fi
echo ""
echo -e "${BLUE}⚙️  Управление:${NC}"
echo "  Логи:           moongame logs"
echo "  Статус:         moongame status"
echo "  Обновление:     moongame update"
echo "  Перезапуск:     moongame restart"
echo "  Оболочка:       moongame shell"
echo ""
echo -e "${BLUE}📋 Информация о базе:${NC}"
echo "  PostgreSQL Пароль: $POSTGRES_PASSWORD"
echo "  (сохранен в $ENV_FILE)"
echo ""
echo -e "${YELLOW}⚠️  Для проксирования внешнего адреса:${NC}"
echo "  На роутере или nginx: перенаправь внешний порт → $INTERNAL_IP:$INTERNAL_PORT"
echo ""
echo -e "${GREEN}✓ Сервер готов!${NC}"
echo ""
