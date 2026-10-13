#!/bin/bash

#############################################################################
# Void Dominion — Настройка Nginx проксирования
#
# Если хочешь получить доступ к серверу через внешний IP и порт
# Использование:
#   sudo INTERNAL_IP=<IP-сервера> EXTERNAL_IP=<внешний-IP> EXTERNAL_PORT=<порт> bash deploy/setup-proxy.sh
#############################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Конфигурация
# Адреса задаются окружением (см. «Использование» выше): в репозитории нет адресов
# конкретного сервера.
INTERNAL_IP="${INTERNAL_IP:-}"
INTERNAL_PORT="${INTERNAL_PORT:-8788}"
EXTERNAL_IP="${EXTERNAL_IP:-}"
EXTERNAL_PORT="${EXTERNAL_PORT:-}"
if [ -z "$INTERNAL_IP" ] || [ -z "$EXTERNAL_IP" ] || [ -z "$EXTERNAL_PORT" ]; then
    log_error "Задай INTERNAL_IP, EXTERNAL_IP и EXTERNAL_PORT"
    exit 1
fi
# Значения подставляются в конфиг nginx, поэтому только IPv4 или имя хоста и число.
# IPv6 скрипт не поддерживает.
for v in "$INTERNAL_IP" "$EXTERNAL_IP"; do
    if ! [[ "$v" =~ ^[0-9A-Za-z][0-9A-Za-z.-]*$ ]]; then
        log_error "Недопустимый адрес: $v"
        exit 1
    fi
done
for v in "$INTERNAL_PORT" "$EXTERNAL_PORT"; do
    if ! [[ "$v" =~ ^[0-9]{1,5}$ ]] || [ "$v" -lt 1 ] || [ "$v" -gt 65535 ]; then
        log_error "Недопустимый порт: $v"
        exit 1
    fi
done

if [[ $EUID -ne 0 ]]; then
    log_error "Скрипт должен быть запущен от root"
    exit 1
fi

log_info "=========================================="
log_info "Настройка Nginx проксирования"
log_info "=========================================="
log_info "Внутренний адрес: $INTERNAL_IP:$INTERNAL_PORT"
log_info "Внешний адрес:    $EXTERNAL_IP:$EXTERNAL_PORT"
log_info "=========================================="
echo ""

# Установка Nginx
if ! command -v nginx &> /dev/null; then
    log_info "Установка Nginx..."
    apt-get update
    apt-get install -y nginx
    log_success "Nginx установлен"
else
    log_success "Nginx уже установлен"
fi

# Создание конфига
log_info "Создание конфигурации проксирования..."

# Прежний конфиг сохраняется: если новый не пройдёт nginx -t, рабочий вернётся на место.
HAD_SITE=0
if [ -f /etc/nginx/sites-available/moongame ]; then
    cp -a /etc/nginx/sites-available/moongame /etc/nginx/sites-available/moongame.prev
    HAD_SITE=1
fi
cat > /etc/nginx/sites-available/moongame << 'EOF'
# Void Dominion — проксирование внешнего доступа
#
# Проксирует запросы с http://__EXTERNAL_IP__:__EXTERNAL_PORT__
# на локальный сервер http://__INTERNAL_IP__:__INTERNAL_PORT__

upstream moongame_backend {
    server __INTERNAL_IP__:__INTERNAL_PORT__;
    keepalive 64;
}

server {
    # Слушаем внешний порт
    listen __EXTERNAL_PORT__;
    server_name __EXTERNAL_IP__;

    # Логирование
    access_log /var/log/nginx/moongame-access.log combined buffer=16k flush=1m;
    error_log /var/log/nginx/moongame-error.log warn;

    # Оптимизация для WebSocket
    client_max_body_size 10m;
    proxy_buffering off;

    location / {
        # Основное проксирование
        proxy_pass http://moongame_backend;

        # HTTP версия для сохранения соединения
        proxy_http_version 1.1;

        # WebSocket поддержка
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Заголовки для клиента
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Таймауты для долгоживущих соединений
        proxy_connect_timeout 60s;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;

        # Отключаем буферизацию для WebSocket
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # Health check endpoint (не требует проксирования)
    location /health {
        access_log off;
        proxy_pass http://moongame_backend;
        proxy_http_version 1.1;
    }
}

# Редирект HTTP → HTTPS (если нужно добавить SSL позже)
# server {
#     listen 80;
#     server_name __EXTERNAL_IP__;
#     return 301 https://$server_name:$server_port$request_uri;
# }
EOF
sed -i -e "s/__INTERNAL_IP__/$INTERNAL_IP/g" -e "s/__INTERNAL_PORT__/$INTERNAL_PORT/g" \
    -e "s/__EXTERNAL_IP__/$EXTERNAL_IP/g" -e "s/__EXTERNAL_PORT__/$EXTERNAL_PORT/g" \
    /etc/nginx/sites-available/moongame

# Включение сайта
if [ -L /etc/nginx/sites-enabled/moongame ]; then
    log_info "Конфиг уже включен"
else
    ln -sf /etc/nginx/sites-available/moongame /etc/nginx/sites-enabled/
    log_success "Конфиг включен"
fi

# Отключение default сайта если он есть
DEFAULT_REMOVED=0
if [ -L /etc/nginx/sites-enabled/default ]; then
    rm /etc/nginx/sites-enabled/default
    DEFAULT_REMOVED=1
    log_info "Default сайт отключен"
fi

# Проверка конфига
log_info "Проверка конфигурации Nginx..."
if nginx -t &>/dev/null; then
    log_success "Конфиг валиден"
    rm -f /etc/nginx/sites-available/moongame.prev
else
    log_error "Ошибка в конфиге Nginx! Возвращаю прежнюю конфигурацию."
    nginx -t
    if [ "$HAD_SITE" = 1 ]; then
        mv /etc/nginx/sites-available/moongame.prev /etc/nginx/sites-available/moongame
    else
        rm -f /etc/nginx/sites-available/moongame /etc/nginx/sites-enabled/moongame
    fi
    if [ "$DEFAULT_REMOVED" = 1 ]; then
        ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
    fi
    exit 1
fi

# Перезагрузка Nginx
log_info "Перезагрузка Nginx..."
systemctl restart nginx
systemctl enable nginx
log_success "Nginx перезагружен"

echo ""
log_success "=========================================="
log_success "Настройка завершена!"
log_success "=========================================="
echo ""
echo -e "${BLUE}Проверка доступа:${NC}"
echo ""
echo "1. Локально (внутри сети):"
echo "   curl http://$INTERNAL_IP:$INTERNAL_PORT"
echo ""
echo "2. Через Nginx проксирование:"
echo "   curl http://$EXTERNAL_IP:$EXTERNAL_PORT"
echo "   (если с внешней машины, нужен доступ к этому IP)"
echo ""
echo -e "${YELLOW}Логирование:${NC}"
echo "  Access: tail -f /var/log/nginx/moongame-access.log"
echo "  Error:  tail -f /var/log/nginx/moongame-error.log"
echo ""
echo -e "${YELLOW}Управление:${NC}"
echo "  Остановить:   sudo systemctl stop nginx"
echo "  Перезапустить: sudo systemctl restart nginx"
echo "  Статус:       sudo systemctl status nginx"
echo ""
