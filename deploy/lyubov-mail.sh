#!/usr/bin/env bash
# Почта для кодов входа и уведомлений. Запуск на сервере: lyubov-mail (или bash /opt/lyubov/deploy/lyubov-mail.sh).
# Пароли и ключи вводятся здесь, на сервере, и никуда не отправляются. Подробно: docs/mail-setup.md.
set -e
. /usr/local/lib/lyubov-env.sh
DOMAIN=$(grep '^PUBLIC_URL=' "$ENV_FILE" | cut -d= -f2- | sed -E 's#^https?://##; s#/.*$##; s#^www\.##')
echo "Откуда отправлять письма:"
echo "  1 — Yandex Cloud Postbox, с адреса noreply@${DOMAIN:-ваш-домен} (рекомендуется: письма не падают в спам)"
echo "  2 — обычный ящик на Яндексе (пароль приложения)"
read -r -p "Введите 1 или 2 [1]: " M </dev/tty
if [ "${M:-1}" = 1 ]; then
  read -r -p "Адрес отправителя [noreply@$DOMAIN]: " F </dev/tty
  F=${F:-noreply@$DOMAIN}
  echo "Ключ: консоль Yandex Cloud → сервисный аккаунт postbox-user → Создать API-ключ (область yc.postbox.send)."
  read -r -p "Идентификатор API-ключа: " U </dev/tty
  read -r -s -p "Секретный ключ (ввод не отображается): " P </dev/tty; echo
  read -r -p "Куда приходят ответы на письма (почта поддержки, можно пусто) [b1.u@bk.ru]: " R </dev/tty
  setenv SMTP_HOST postbox.cloud.yandex.net; setenv SMTP_PORT 465
  setenv SMTP_USER "$(printf '%s' "$U" | tr -d '[:space:]')"; setenv SMTP_PASS "$(printf '%s' "$P" | tr -d '[:space:]')"
  setenv SMTP_FROM "Любовь в цифрах <$F>"; setenv SMTP_REPLY_TO "${R:-b1.u@bk.ru}"
else
  read -r -p "Адрес почты на Яндексе, с которой будут уходить письма: " U </dev/tty
  read -r -s -p "Пароль приложения (ввод не отображается): " P </dev/tty; echo
  setenv SMTP_HOST smtp.yandex.ru; setenv SMTP_PORT 465; setenv SMTP_USER "$U"; setenv SMTP_PASS "$P"
  setenv SMTP_FROM "Любовь в цифрах <$U>"; setenv SMTP_REPLY_TO ""
fi
systemctl restart lyubov
echo "Готово. Войдите на сайт по почте — код должен прийти во «Входящие»."
echo "Если письма нет, ошибка видна в журнале: journalctl -u lyubov -n 30 | grep smtp"
