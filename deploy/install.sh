#!/usr/bin/env bash
# Установка сайта «Любовь в цифрах» на чистый сервер Ubuntu 22.04/24.04 одной командой:
#
#   curl -fsSL https://raw.githubusercontent.com/Serg1306/kot13061970-gmail.com/claude/keen-lamport-4oxlbx/deploy/install.sh | sudo bash
#
# Скрипт можно запускать повторно: он обновит сайт до свежей версии и не тронет данные пользователей и настройки.
# После установки доступны команды:
#   lyubov-tkassa     — ввести данные терминала Т-Кассы (пароль вводится на сервере, никуда не отправляется)
#   lyubov-sms        — вход по номеру телефона: ключ SMS.ru для СМС с кодом
#   lyubov-mail       — настроить почту для кодов входа (Яндекс)
#   lyubov-domain     — подключить домен и HTTPS
#   lyubov-update     — обновить сайт до последней версии
#   lyubov-backup     — сделать резервную копию (делается и сама каждую ночь)
set -euo pipefail

REPO="${LYUBOV_REPO:-https://github.com/Serg1306/kot13061970-gmail.com.git}"
BRANCH="${LYUBOV_BRANCH:-claude/keen-lamport-4oxlbx}"
APP=/opt/lyubov
DATA=/var/lib/lyubov/data
BACKUPS=/var/backups/lyubov
ENV_FILE="$APP/.env"

say()  { printf '\n\033[1;35m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
ask()  { local q="$1" def="${2:-}" a; read -r -p "$q${def:+ [$def]}: " a </dev/tty || true; printf '%s' "${a:-$def}"; }

[ "$(id -u)" = 0 ] || { echo "Запустите от имени root (через sudo)."; exit 1; }
grep -qi ubuntu /etc/os-release || warn "Скрипт проверен на Ubuntu; на другой системе могут быть отличия."

say "1/8. Устанавливаю программы (это займёт пару минут)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git nginx sqlite3 ufw certbot python3-certbot-nginx ca-certificates >/dev/null
need_node=1
if command -v node >/dev/null; then
  v=$(node -p 'process.versions.node.split(".").map(Number).reduce((a,b,i)=>a+b*[1e6,1e3,1][i],0)')
  [ "$v" -ge 22005000 ] && need_node=0
fi
if [ "$need_node" = 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node.js $(node --version), nginx, certbot установлены"

say "2/8. Включаю защиту (межсетевой экран: открыты только SSH и сайт)"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ok "Межсетевой экран включён"

say "3/8. Скачиваю сайт"
id lyubov >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin lyubov
mkdir -p "$DATA" "$BACKUPS"
# папка принадлежит пользователю lyubov, а git запускается от root — разрешаем явно
git config --global --get-all safe.directory | grep -qx "$APP" || git config --global --add safe.directory "$APP"
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch -q origin "$BRANCH"
  git -C "$APP" reset -q --hard "origin/$BRANCH"
else
  rm -rf "$APP.tmp"
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$APP.tmp"
  mkdir -p "$APP"
  cp -a "$APP.tmp/." "$APP/"
  rm -rf "$APP.tmp"
fi
chown -R lyubov:lyubov "$APP" /var/lib/lyubov
ok "Сайт в $APP (ветка $BRANCH, версия $(git -C "$APP" rev-parse --short HEAD))"

say "4/8. Настройки"
IP=$(curl -fsS4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
if [ ! -f "$ENV_FILE" ]; then
  ADMIN=$(ask "Почта модератора (для входа в admin.html)" "kot13061970@gmail.com")
  cat > "$ENV_FILE" <<EOF
PORT=8080
HOST=127.0.0.1
DATA_DIR=$DATA
PUBLIC_URL=http://$IP
ADMIN_EMAILS=$ADMIN

# Почта для кодов входа: настраивается командой lyubov-mail
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# СМС с кодом входа по номеру телефона (SMS.ru): настраивается командой lyubov-sms
SMS_RU_API_ID=
SMS_PREFIXES=7
SMS_DAILY_LIMIT=300

DEV_CODES=0
AUTO_APPROVE=0
PUSH_ENABLED=0
METRIKA_ID=

# Т-Касса: настраивается командой lyubov-tkassa
TKASSA_TERMINAL=
TKASSA_PASSWORD=
TKASSA_RECEIPT=0
TKASSA_TAXATION=usn_income
TKASSA_TAX=none
EOF
  ok "Создан файл настроек $ENV_FILE"
else
  ok "Файл настроек уже есть — не трогаю"
  # Редакцию согласий задаёт сам сайт: строка из прошлых установок больше не нужна.
  sed -i '/^CONSENT_VERSION=/d' "$ENV_FILE"
fi
chown lyubov:lyubov "$ENV_FILE"; chmod 600 "$ENV_FILE"

say "5/8. Автозапуск сайта"
cat > /etc/systemd/system/lyubov.service <<EOF
[Unit]
Description=Любовь в цифрах
After=network.target

[Service]
User=lyubov
Group=lyubov
WorkingDirectory=$APP
ExecStart=/usr/bin/node --no-warnings server/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=/var/lib/lyubov

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q lyubov
systemctl restart lyubov
sleep 2
systemctl is-active -q lyubov && ok "Сайт запущен" || { warn "Сайт не запустился, журнал:"; journalctl -u lyubov -n 30 --no-pager; exit 1; }

say "6/8. Веб-сервер nginx"
if [ ! -f /etc/nginx/sites-available/lyubov ]; then
  cat > /etc/nginx/sites-available/lyubov <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    client_max_body_size 10m;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
EOF
fi
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/lyubov /etc/nginx/sites-enabled/lyubov
nginx -t -q && systemctl reload nginx
ok "nginx настроен"

say "7/8. Резервные копии и служебные команды"
cat > /usr/local/bin/lyubov-backup <<EOF
#!/bin/sh
set -e
D=$DATA
B=$BACKUPS
STAMP=\$(date +%Y-%m-%d_%H%M)
sqlite3 "\$D/lvc.sqlite" ".backup '\$B/lvc-\$STAMP.sqlite'"
tar -czf "\$B/files-\$STAMP.tar.gz" -C "\$D" \$(cd "\$D" && ls -d uploads private vapid.json secret.key 2>/dev/null)
find "\$B" -type f -mtime +14 -delete
echo "Копия готова: \$B (\$STAMP)"
EOF
echo '30 3 * * * root /usr/local/bin/lyubov-backup >/dev/null' > /etc/cron.d/lyubov-backup

# Общая функция: записать значение в .env
cat > /usr/local/lib/lyubov-env.sh <<EOF
ENV_FILE="$ENV_FILE"
setenv() { local k="\$1" v="\$2"; if grep -q "^\$k=" "\$ENV_FILE"; then
  python3 - "\$ENV_FILE" "\$k" "\$v" <<'PY'
import sys
p,k,v=sys.argv[1:]
lines=open(p,encoding='utf-8').read().splitlines()
lines=[f"{k}={v}" if l.startswith(k+"=") else l for l in lines]
open(p,'w',encoding='utf-8').write("\n".join(lines)+"\n")
PY
else echo "\$k=\$v" >> "\$ENV_FILE"; fi; }
EOF

cat > /usr/local/bin/lyubov-tkassa <<'EOF'
#!/usr/bin/env bash
# Ввод данных терминала Т-Кассы. Пароль вводится здесь, на сервере, и никуда не отправляется.
set -e
. /usr/local/lib/lyubov-env.sh
echo "Данные возьмите в личном кабинете Т-Бизнеса: Интернет-эквайринг → Магазины → ваш магазин → Терминалы."
echo "Для проверки сначала введите тестовый терминал (в конце его имени DEMO), потом боевой."
read -r -p "TerminalKey: " K </dev/tty
read -r -s -p "Пароль терминала (ввод не отображается): " P </dev/tty; echo
read -r -p "Подключена онлайн-касса и нужно передавать чеки? (да/нет) [нет]: " R </dev/tty
case "${R:-нет}" in д*|y*) R=1 ;; *) R=0 ;; esac
setenv TKASSA_TERMINAL "$K"; setenv TKASSA_PASSWORD "$P"; setenv TKASSA_RECEIPT "$R"
if [ "$R" = 1 ]; then
  read -r -p "Система налогообложения (osn, usn_income, usn_income_outcome, patent) [usn_income]: " X </dev/tty
  setenv TKASSA_TAXATION "${X:-usn_income}"
fi
systemctl restart lyubov
echo
echo "Готово. Адреса уведомлений и возврата сайт передаёт Т-Кассе сам, в кабинете их указывать не нужно."
case "$K" in *DEMO|*demo) echo "Сейчас включён ТЕСТОВЫЙ терминал. После проверки запустите команду ещё раз с боевым терминалом.";; esac
EOF

cat > /usr/local/bin/lyubov-mail <<'EOF'
#!/usr/bin/env bash
# Почта для кодов входа. Для Яндекса нужен «пароль приложения»: id.yandex.ru → Безопасность → Пароли приложений → Почта.
set -e
. /usr/local/lib/lyubov-env.sh
read -r -p "Адрес почты на Яндексе, с которой будут уходить письма: " U </dev/tty
read -r -s -p "Пароль приложения (ввод не отображается): " P </dev/tty; echo
setenv SMTP_HOST smtp.yandex.ru; setenv SMTP_PORT 465; setenv SMTP_USER "$U"; setenv SMTP_PASS "$P"
setenv SMTP_FROM "Любовь в цифрах <$U>"
systemctl restart lyubov
echo "Готово. Попробуйте войти на сайт — код должен прийти на почту."
EOF

cat > /usr/local/bin/lyubov-sms <<'EOF'
#!/usr/bin/env bash
# Вход по номеру телефона: СМС с кодом через SMS.ru. Ключ остаётся на сервере.
#   lyubov-sms                — спросит ключ
#   lyubov-sms КЛЮЧ           — ключ сразу после команды
#   lyubov-sms КЛЮЧ 500       — и суточный лимит кодов
set -e
. /usr/local/lib/lyubov-env.sh
K="${1:-}"
if [ -z "$K" ]; then
  echo "Ключ возьмите в кабинете sms.ru: «Программистам» → api_id."
  read -r -p "Вставьте api_id (правая кнопка мыши) и нажмите Enter: " K </dev/tty
fi
K=$(printf '%s' "$K" | tr -d '[:space:]')
if ! printf '%s' "$K" | grep -Eq '^[A-Za-z0-9-]{16,}$'; then
  echo "Это не похоже на api_id (он вида XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX). Ничего не сохранено, запустите lyubov-sms ещё раз."; exit 1
fi
B=$(curl -fsS --max-time 15 "https://sms.ru/my/balance?api_id=$K&json=1" || true)
if printf '%s' "$B" | grep -q '"status": *"OK"'; then
  echo "Ключ подходит. Баланс SMS.ru: $(printf '%s' "$B" | grep -o '"balance": *[0-9.]*' | grep -o '[0-9.]*$') ₽"
else
  echo "SMS.ru не принял ключ: $B"; echo "Проверьте api_id в кабинете sms.ru. Ничего не сохранено."; exit 1
fi
L="${2:-}"
if [ -z "$1" ]; then read -r -p "Не больше скольких кодов в сутки на весь сайт (защита баланса) [300]: " L </dev/tty; fi
case "$L" in ''|*[!0-9]*) L=300 ;; esac
setenv SMS_RU_API_ID "$K"; setenv SMS_DAILY_LIMIT "$L"
grep -q '^SMS_PREFIXES=' "$ENV_FILE" || setenv SMS_PREFIXES 7
systemctl restart lyubov
echo "Готово. На сайте вход теперь по номеру телефона, по почте — запасной вариант. Лимит: $L кодов в сутки."
echo "Коды уходят только на номера +7 (Россия и Казахстан). Другие страны: строка SMS_PREFIXES в $ENV_FILE, например 7,375,998."
EOF

cat > /usr/local/bin/lyubov-domain <<'EOF'
#!/usr/bin/env bash
# Подключение домена и бесплатного сертификата HTTPS (Let's Encrypt, продлевается сам).
set -e
. /usr/local/lib/lyubov-env.sh
read -r -p "Домен (например lyubov-v-cifrah.ru): " D </dev/tty
D=$(echo "$D" | sed 's#^https\?://##; s#/.*##' | tr 'A-Z' 'a-z')
IP=$(curl -fsS4 https://ifconfig.me)
R=$(getent ahostsv4 "$D" | awk 'NR==1{print $1}')
if [ "$R" != "$IP" ]; then
  echo "Домен $D пока указывает на «${R:-никуда}», а сервер — $IP."
  echo "В управлении доменом создайте A-записи: «@» → $IP и «www» → $IP. Через 15–60 минут запустите lyubov-domain снова."
  exit 1
fi
NAMES="-d $D"; WWW=$(getent ahostsv4 "www.$D" | awk 'NR==1{print $1}'); [ "$WWW" = "$IP" ] && NAMES="$NAMES -d www.$D"
sed -i "s/server_name .*;/server_name $D www.$D;/" /etc/nginx/sites-available/lyubov
nginx -t -q && systemctl reload nginx
ADMIN=$(grep '^ADMIN_EMAILS=' "$ENV_FILE" | cut -d= -f2- | cut -d, -f1)
certbot --nginx $NAMES --redirect -m "$ADMIN" --agree-tos -n
setenv PUBLIC_URL "https://$D"
systemctl restart lyubov
echo
echo "Готово: https://$D"
EOF

cat > /usr/local/bin/lyubov-update <<EOF
#!/bin/sh
set -e
/usr/local/bin/lyubov-backup
git -C "$APP" fetch -q origin "$BRANCH" && git -C "$APP" reset -q --hard "origin/$BRANCH"
chown -R lyubov:lyubov "$APP"
systemctl restart lyubov
echo "Сайт обновлён до версии \$(git -C "$APP" rev-parse --short HEAD)"
EOF
rm -f /usr/local/bin/lyubov-robokassa
chmod +x /usr/local/bin/lyubov-backup /usr/local/bin/lyubov-tkassa /usr/local/bin/lyubov-sms /usr/local/bin/lyubov-mail /usr/local/bin/lyubov-domain /usr/local/bin/lyubov-update
ok "Команды lyubov-tkassa, lyubov-sms, lyubov-mail, lyubov-domain, lyubov-update, lyubov-backup готовы"

say "8/8. Проверка"
if curl -fsS http://127.0.0.1/api/config | grep -q '"live":true'; then ok "Сайт работает: http://$IP/"; else warn "Сайт не ответил, журнал: journalctl -u lyubov -n 50"; fi

cat <<EOF

Готово! Дальше по порядку:
  1. lyubov-domain     — когда купите домен и направите его на $IP
  2. lyubov-mail       — чтобы коды входа приходили на почту
  3. lyubov-sms        — вход по номеру телефона (СМС через SMS.ru)
  4. lyubov-tkassa     — когда подключите интернет-эквайринг Т-Кассы
Модерация: http://$IP/admin.html (вход по почте модератора).
EOF
