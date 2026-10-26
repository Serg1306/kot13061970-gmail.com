# API сервера «Любовь в цифрах»

Сервер: `server/server.mjs` (Node.js 22.5+, без внешних зависимостей, база SQLite через `node:sqlite`). Запуск: `npm start`, тесты: `npm test`.
Он же раздаёт статику сайта из `site/lyubov-v-cifrah/` по адресу `/` и загруженные файлы по `/uploads/…`.

Все ответы — JSON `{"error": "<код>"}` при ошибке с HTTP-статусом 4xx/5xx. Тела запросов — JSON (лимит 8 МБ, больше — `413 too_large`; не JSON — `400 bad_json`).
Сессия — cookie `lvc_s` (HttpOnly, SameSite=Lax, Secure при HTTPS), 60 дней. В базе хранится только SHA-256 токена.
Все изменяющие запросы (POST/PUT/DELETE) требуют заголовок `X-Requested-With: lvc` (защита от CSRF), иначе `403 csrf`. Исключение — `/api/tkassa-notify` (его вызывает Т-Касса).

Общие ошибки: `401 auth` — нет сессии; `409 profile_required` — анкета ещё не заполнена (нужен `PUT /api/profile`); `403 banned` — пользователь забанен;
`404 not_found` — нет такой анкеты/объекта или она скрыта; `429 rate_limited {wait}` — слишком часто;
`400 invalid {field}` — неверное поле (`field` — имя поля).

Сайт определяет режим так: `GET /api/config` ответил 200 → «живой» режим с сервером; иначе — демо-режим (как сейчас, всё в браузере).

## Объекты

```
User (свой)  = { id, email, name, birth: "YYYY-MM-DD", g: "m"|"f", seek: "m"|"f"|"a", city, about, lang: "ru"|"en",
                 verified: bool, verifyStatus: "none"|"pending"|"approved"|"rejected",
                 hideAge: bool, invisible: bool, notifyEmail: bool, notifyPush: bool, consentAt: ms|null, consentPublicAt: ms|null, consentVersion: string|null, createdAt: ms }
Person (чужой) = { id, name, birth, g, city, about, verified: bool, hideAge: bool, vip: bool, boosted: bool,
                 online: bool (активность за 10 мин), media: [{ type: "photo", src: "/uploads/…" }], gifts: [{ kind, from?: id }] }
Wallet       = { coins, vipUntil: ms, boostUntil: ms }
Photo        = { id, src, status: "pending"|"approved"|"rejected" }   // порядок в массиве = порядок в анкете, первое — главное
Message      = { id, from: id, to: id, t: ms, kind: "text"|"voice"|"call", text?, src? (voice, /uploads/…), dur? (сек), read: bool }
Event        = { id, t: ms, kind: "like"|"match"|"visit"|"friend_req"|"friend_ok"|"gift"|"system", who?: id, text? }
Signal       = { id, from: id, t: ms, data: object }
```

- Id пользователей — строки (16 hex-символов); поддержка — строка `"support"`. Id сообщений, событий, фото, постов, сигналов, жалоб — числа.
- `Message.read` — получатель прочитал сообщение. Сообщения типа `call` сервер пока не создаёт (зарезервировано).
- `Person.hideAge`/`User.hideAge`/`invisible` действуют, только пока активен VIP (после окончания VIP отдаются как `false`).
- `Person.online` = активность за 10 минут; у невидимки (с VIP) всегда `false`.
- `Person.gifts[].from` отдаётся, только если подарок от смотрящего.
- `Event.text` — простой текст (без HTML), сайт сам экранирует его. Для `gift` в `text` лежит вид подарка (`rose`…), для `system` — готовая фраза на языке пользователя.
- У событий `like` и `visit` поле `who` отдаётся только VIP (иначе событие без `who`).

`birth` чужих анкет отдаётся, потому что совместимость считается в браузере. Если `hideAge`, сайт не показывает возраст.
Чужим отдаются только фото со статусом `approved`. Заблокированные (в любую сторону) и забаненные не видны нигде.

## Конфигурация

`GET /api/config` → `{ live: true, payments: bool, phoneLogin: bool, vapidPublicKey: string|null, metrikaId: string|null, devCodes: bool }`. `phoneLogin` — включён вход по номеру телефона (подключён SMS.ru или `DEV_CODES=1`).

`vapidPublicKey` = `null`, пока push выключен (`PUSH_ENABLED` ≠ `1`, по умолчанию) — тогда сайт не должен предлагать подписку на уведомления.

## Вход по почте

- `POST /api/auth/start { email, lang }` → `{ ok: true, devCode?: "123456" }`. Почта приводится к нижнему регистру, пробелы обрезаются (`bad_email` при неверной). Шестизначный код, живёт 10 минут, 5 попыток, не чаще раза в 60 с на почту (`429 {error:"too_often", wait: сек}`). `devCode` возвращается только при `DEV_CODES=1`. Если SMTP не настроен, код пишется в журнал сервера; если письмо не ушло — `502 mail_failed`.
- `POST /api/auth/start { phone, lang }` → `{ ok: true, devCode? }` — вход по номеру телефона (см. `docs/sms-setup.md`). Номер приводится к виду `+79991234567` (`8 999…`, `999…` без кода страны — Россия). Код приходит в СМС, в нём 4 цифры (в письме — 6). Ошибки: `400 bad_phone`, `400 phone_country` (страна не в `SMS_PREFIXES`), `503 sms_off` (SMS.ru не подключён), `503 sms_limit` (исчерпан `SMS_DAILY_LIMIT`), `502 sms_failed`, `429 too_often`; не больше 10 кодов в час с одного IP. Номер хранится как логин в `users.email`.
- `POST /api/auth/verify { email | phone, code }` → ставит cookie, `{ user: User|null }` (`null` — анкета ещё не заполнена). Ошибки: `400 bad_code`, `400 code_expired`, `429 too_many_attempts`. При первом входе создаётся аккаунт, приветственное сообщение от `support` (на языке из `auth/start`) и событие `system`.
- `POST /api/auth/logout` → `{ ok: true }`.
- `DELETE /api/account` → удаляет пользователя и всё его (фото-файлы, селфи, голосовые, посты, сообщения в обе стороны, лайки…), `{ ok: true }`. Счета об оплате остаются без привязки к человеку (бухучёт). В журнал уничтожения пишется запись (`reason: user_request`). Если аккаунт был забанен, хэш его почты попадает в чёрный список на 3 года.
- `GET /api/account/export` → файл JSON (`Content-Disposition: attachment; filename="lyubov-v-cifrah-data.json"`) со всеми данными о себе (152-ФЗ, ст. 14): `profile, consents {processingAt, publicAt, version, ip}, wallet, photos, verification, likes {given, receivedCount}, passes, matches, friends, blocked, messages (свои и мне: текст, ссылки на голосовые), posts, visits {madeByMe, receivedCount}, gifts {sent, received}, reportsFiled, orders, events`. О других людях — только их id или количество. Не чаще 5 раз в час (`429 rate_limited`).
- Почта удалённого забаненного аккаунта: `auth/start` и `auth/verify` → `403 banned` (хранится только HMAC-хэш почты, 3 года).

## Своя анкета

- `GET /api/me` → `401 {error:"auth"}` или `{ user: User|null, wallet: Wallet, photos: Photo[], admin: bool, banned: bool }`.
- `PUT /api/profile { name, birth, g, seek, city, about, lang, consent, consentPublic }` → `{ user }`. Проверки (строки обрезаются, внутренние пробелы в имени и городе схлопываются):
  - `name` — `/^[\p{L}\p{M}][\p{L}\p{M} .'’-]{0,39}$/u`, иначе `400 bad_name`;
  - `city` — `/^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .,'’()-]{0,59}$/u`, иначе `400 bad_city`;
  - `about` — свободный текст ≤ 500 (`invalid`, field `about`); `birth` — настоящая дата `YYYY-MM-DD` (`invalid`, field `birth`); `g`, `seek` — `invalid`;
  - возраст ≥ 18 (`under_18`);
  - два отдельных согласия по 152-ФЗ, оба обязательны при первом сохранении: `consent: true` — на обработку (`consent_required`) и `consentPublic: true` — на распространение, ст. 10.1, анкету видят другие (`consent_public_required`). Записываются `consentAt`, `consentPublicAt`, `consentVersion` (из `CONSENT_VERSION`) и IP. При следующих сохранениях согласия не нужны.
- `PUT /api/settings { hideAge?, invisible?, notifyEmail?, notifyPush?, lang? }` → `{ user }`. `hideAge`/`invisible` = true только с активным VIP (`403 vip_required`).
- `POST /api/photos { dataUrl }` (jpeg/png/webp — тип проверяется по сигнатуре файла, `bad_image`; ≤ 4 МБ после декодирования, `413 too_large`; максимум 10 фото → `too_many`) → `{ photos: Photo[] }`. При `AUTO_APPROVE=1` сразу `approved`, иначе `pending` до модерации. Работает и до заполнения анкеты.
- `DELETE /api/photos/:id` → `{ photos }`; `PUT /api/photos/order { ids }` → `{ photos }` (перечисленные идут первыми в указанном порядке, остальные — после).
- `POST /api/verify { dataUrl, gesture }` — селфи с жестом (gesture 1–100 символов) для значка «фото проверено» → `{ user }` (verifyStatus = pending). Селфи не публикуется, его видят только модераторы.

## Люди

- `GET /api/people` → `{ people: Person[] }` — до 200 видимых анкет: поднятые первыми, затем недавно активные. **Работает без сессии** (карусель и города на главной для гостей): те же Person, только одобренные фото, без забаненных. С сессией дополнительно исключаются своя анкета и заблокированные в любую сторону. Невидимки в списке есть (невидимка влияет только на визиты).
- `GET /api/people/:id` → `{ person }`; если смотрящий не в режиме невидимки (или без VIP), записывается визит (не чаще раза в час на пару) и событие `visit` владельцу.
- `GET /api/state` → всё состояние для кабинета одним запросом:
  `{ likes: id[], passes: id[], matches: id[], admirers: id[], admirersCount: n, guests: [{id,t}], guestsCount: n,
     friends: { list: id[], in: id[], out: id[] }, blocked: id[], chats: { [id]: Message[] (последние 50, по возрастанию t) }, events: Event[] (последние 100, новые первыми),
     posts: Post[] (лента, последние 100), likesToday: n, wallet }`
  - `admirers` (лайкнули меня, без взаимности) и `guests` — полные списки только с VIP; без VIP это пустые массивы, а числа — в `admirersCount`/`guestsCount`.
  - Ключи `chats` — id собеседника или `"support"`.
  - Post = `{ id, author: id, t, text, img?: "/uploads/…", likes: n, liked: bool }`.
- `GET /api/sync?since=<ms>` → `{ now, messages: Message[], events: Event[], signals: Signal[], wallet, counters: { unread, admirers, guests, friendsIn } }`.
  - Возвращает всё, что появилось в окне `since < t ≤ now`. В следующий раз передавайте `since = now` из ответа (не часы браузера). `now` отстаёт от часов сервера на 1 мс, поэтому ничего не теряется и не дублируется.
  - `messages` — входящие **и мои исходящие** (например, отправленные с другого устройства); сайт должен убирать дубли по `id`. Изменение `read` у старых сообщений через sync не приходит.
  - `signals` — только адресованные мне и не старше 60 с.
  - Сайт опрашивает раз в 5 с (раз в 1 с во время звонка). Работает и для забаненных, и до заполнения анкеты.

## Действия

- `POST /api/like { id }` → `{ match: bool, likesToday }`. Без VIP — 30 в день по московскому времени (`429 limit`). Повторный лайк ничего не меняет. Взаимный лайк создаёт событие `match` обоим (+ push и письмо второму); невзаимный — событие `like` получателю.
- `POST /api/pass { id }` → `{ ok }`.
- `POST /api/messages { to, text }` → `{ message }`. Писать можно: при взаимной симпатии, друзьям, с VIP, **в ответ тому, кто уже написал мне**, в поддержку (`to: "support"`, можно даже забаненным и без анкеты). Иначе `403 not_allowed`. Фильтр: номера карт (13–19 цифр подряд с пробелами/дефисами) запрещены всегда (`blocked_card`); ссылки и телефоны (10+ цифр) запрещены, пока собеседник ещё ни разу не ответил (`blocked_link`; в поддержку можно). Длина 1–2000. Не больше 30 сообщений в минуту.
- `POST /api/messages/voice { to, dataUrl, dur }` (audio/webm|ogg|mp4 по сигнатуре — `bad_audio`, ≤ 2 МБ, 1–120 с) → `{ message }`. Те же правила доступа. Файл: `/uploads/<имя>.weba|.ogg|.m4a`.
- `POST /api/messages/read { with }` → `{ ok }` — отмечает прочитанными сообщения от `with` (можно `"support"`).
- `POST /api/friends { id, action: "add"|"accept"|"decline"|"cancel"|"remove" }` → `{ friends }`. `add` при встречной заявке сразу делает друзьями. События: `friend_req` адресату, `friend_ok` отправителю заявки.
- `POST /api/block { id }` / `POST /api/unblock { id }` → `{ blocked }`. Блок удаляет взаимность и дружбу, переписку не удаляет, но скрывает обоим.
- `POST /api/report { id, reason: "fake"|"scam"|"rude"|"photos"|"minor"|"other", text? }` → `{ ok }` (text ≤ 1000, не больше 10 жалоб в час).
- `POST /api/posts { text, dataUrl? }` → `{ post }` (text ≤ 1000, нужен текст или картинка; номера карт, ссылки и телефоны в постах запрещены); `DELETE /api/posts/:id` (только свой); `POST /api/posts/:id/like` → `{ likes, liked }` (переключатель).
- `POST /api/boost` → 50 монет, поднятие на сутки (продлевается от текущего конца) → `{ wallet }` (`no_coins`).
- `POST /api/gift { to, kind: "rose"|"coffee"|"heart"|"bear"|"star" }` → цены 10/15/20/40/50 монет (как `GIFTS` в index.html) → `{ wallet }` (`no_coins`), получателю событие `gift` (`who` — даритель, `text` — вид подарка).
- `POST /api/call/signal { to, data }` → `{ ok, id }` — сигнализация WebRTC. `data` — любой объект с полем `type` (строка ≤ 20 символов: `offer`/`answer`/`ice`/`hangup`…), JSON ≤ 32 КБ. Доставляется адресату через `/api/sync` как `Signal`. Звонить можно тем, кому можно писать (не в поддержку). На `type: "offer"` адресату уходит push «Входящий звонок». Сигналы живут 60 с.

## Push-уведомления

- **Выключены по умолчанию** (трансграничная передача через Google/Mozilla/Apple требует уведомления РКН). Пока `PUSH_ENABLED` ≠ `1`: `vapidPublicKey: null`, `POST /api/push/subscribe` → `403 push_disabled`, ключи VAPID не создаются, push не отправляются.
- `POST /api/push/subscribe { subscription }` (объект PushSubscription.toJSON()) / `POST /api/push/unsubscribe { endpoint }`. Принимаются только адреса служб push (FCM, Mozilla, Apple, Windows) по https.
- Сервер шлёт Web Push (VAPID, шифрование aes128gcm, реализовано на `node:crypto`) о новом сообщении, взаимной симпатии, заявке в друзья, входящем звонке, ответе поддержки — если у получателя `notifyPush`. Полезная нагрузка: `{ title, body, url }`, где `url`:
  `/?go=messages&with=<id>`, `/?go=matches&with=<id>`, `/?go=friends`, `/?go=call&from=<id>`, `/?go=messages&with=support`. Подписки, на которые служба ответила 404/410, удаляются.
- На почту (если `notifyEmail`): взаимная симпатия и первое непрочитанное сообщение от собеседника, не чаще раза в 30 минут на человека.

## Оплата (Т-Касса)

Логика в `server/tkassa.mjs` (запросы к API v2 Т-Кассы и подписи) и `server/routes/pay.mjs`:
- `GET /api/pay` → `{ configured, test, catalog }` (`test` — терминал с `DEMO` в конце).
- `POST /api/pay { product }` → `{ url, invId }` (нужна сессия; заказ записывается в таблицу `orders` и привязан к пользователю; сервер вызывает `Init` с суммой в копейках, `OrderId = invId`, `SuccessURL = /?pay=ok&order=<invId>`, `FailURL = /?pay=fail`, `NotificationURL = /api/tkassa-notify`). Ошибки: `unknown_product`, `503 not_configured`, `502 tkassa_unavailable`.
- `POST /api/tkassa-notify` — уведомление Т-Кассы (JSON). Проверяются `TerminalKey` и `Token` = SHA-256 от значений полей верхнего уровня (без `Token` и вложенных объектов), отсортированных по имени, вместе с паролем терминала. При `Status: CONFIRMED`, `Success: true` и сумме, равной цене товара, — начисление VIP/монет ровно один раз (+ событие `system` «Оплата получена»). Ответ `OK` (и на повтор, и на неизвестный заказ — чтобы Т-Касса не повторяла). Неверная подпись — `400 bad token`.
- `POST /api/pay-confirm { invId }` — человек вернулся на сайт по SuccessURL. Ссылка не подписана, поэтому заказ начисляется только по уведомлению или по ответу `CheckOrder`, который сервер запрашивает сам.
  Ответ: `{ ok: true, invId, product, title, price, vipDays?|coins?, fresh: bool, wallet? }`, пока не оплачено — `{ ok: false, pending: true, invId }`. `fresh` = true только при первом подтверждении этого заказа (показывать «Оплата прошла» один раз). `wallet` — только если запрос с сессией владельца заказа. Ошибки: `404 unknown_order`, `502 tkassa_unavailable`.

## Модерация

`site/lyubov-v-cifrah/admin.html` (только для почт из `ADMIN_EMAILS`, вход тем же кодом из письма; иначе `403 forbidden`):
- `GET /api/admin/queue` →
  `{ photos: [{ id, userId, name, email, src, t }], verifications: [{ userId, name, email, gesture, selfie, photo, t }],
     reports: [{ id, t, reason, text, from: {id,name,email,banned}, target: {id,name,email,banned,photo}, count }],
     support: [{ user: {id,name,email,banned}, unread, last: Message }], banned: [{id,name,email,banned}],
     stats: { users, today, online, paid, paidToday, revenue, messagesToday, banned } }`
- `POST /api/admin/photo { id, approve }`, `POST /api/admin/verify { userId, approve }` (пользователю — событие `system`), `POST /api/admin/report { id, action: "dismiss"|"ban" }` (бан закрывает все открытые жалобы на этого человека), `POST /api/admin/unban { userId }`.
- `GET /api/admin/support?userId=` → `{ user, messages }` (отмечает обращения прочитанными); ответ: `POST /api/admin/support { userId, text }` → `{ message }` — у пользователя появляется сообщение от `"support"` (+ push).
- `GET /api/admin/file/:name` — селфи для проверки (хранятся в `DATA_DIR/private`, не в `/uploads`). Селфи удаляется после решения модератора или через 30 дней, с записью в журнал уничтожения.

### Платежи
- `GET /api/admin/orders?status=new|paid|refunded&q=` → `{ orders: Order[], totals: { today, todayCount, month, monthCount, all, allCount, refunded, refundedCount } }` — новые первыми, до 200; `q` ищет по номеру счёта (точно), почте и имени (подстрока). Суммы в рублях: `today/month/all` — счета в статусе `paid` по дате оплаты (сутки и месяц по Москве), `refunded` — сумма возвращённых.
  `Order = { invId, userId, email, name, product, title, price, status: "new"|"paid"|"refunded", createdAt, paidAt, refundedAt, refundNote, lastCheckedAt }` (`userId/email/name` = null, если аккаунт удалён).
- `POST /api/admin/refund { invId, note }` → `{ order }` — только для `paid` (иначе `not_paid`). Отмечает возврат и отменяет услугу: `coins = MAX(0, coins − купленные)`, `vipUntil = MAX(сейчас, vipUntil − купленные дни)`; пользователю — событие `system`. Сами деньги возвращаются оператором в кабинете Т-Бизнеса (Интернет-эквайринг → Операции → Возврат).
- `POST /api/admin/order-check { invId }` → `{ state, paid, credited }` — сверка методом `CheckOrder` Т-Кассы. `state` — статус платежа Т-Кассы (`CONFIRMED`, `NEW`, `FORM_SHOWED`, `REJECTED`, `REFUNDED`… или `NOT_FOUND`, если платежа нет). `paid` — оплачен на полную сумму заказа; начисление идемпотентно (`credited` — начислено именно сейчас). Ошибки: `404 not_found`, `503 not_configured`, `502 tkassa_unavailable`.
- Фоновая сверка раз в 10 минут: счета `new` возрастом от 5 минут до 48 часов, каждый не чаще раза в 30 минут (`last_checked_at`); только если Т-Касса настроена; ошибки сети пишутся в журнал и не роняют сервер.

### Персональные данные
- `GET /api/admin/destruction?from=YYYY-MM-DD&to=YYYY-MM-DD` (включительно, сутки по Москве) → `{ rows: [{ id, at, subjectRef, emailMasked, categories, reason, method, operator }] }` — журнал уничтожения ПДн (приказ РКН № 179 от 28.10.2022). `subjectRef` = первые 16 hex от sha256(user_id + секрет сервера), `emailMasked` вида `k***@gmail.com`, `reason`: `user_request` | `ban` | `retention` | `consent_withdrawn`, `method` = «удаление из БД и файлов», `operator` — почта модератора, «пользователь (сам, через сайт)» или «система …». Записи пишутся при удалении аккаунта (сам или модератор) и при удалении селфи (после проверки и по сроку 30 дней, категория «селфи для проверки»).
- `POST /api/admin/delete-user { userId | email, reason }` → `{ ok }` — то же полное удаление, что `DELETE /api/account`; `reason` по умолчанию `user_request`, для писем об отзыве согласия — `consent_withdrawn`, `ban` — заодно запрещает повторную регистрацию. Ошибки: `404 not_found`, `400 self`.
- Хэши почт удалённых забаненных (`banned_emails`) хранятся 3 года и удаляются уборкой. Секрет сервера — `DATA_DIR/secret.key` (создаётся сам, входит в резервную копию).

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `PORT` | порт (по умолчанию 8080) |
| `HOST` | адрес для прослушивания (по умолчанию `0.0.0.0`; за nginx — `127.0.0.1`) |
| `DATA_DIR` | папка для базы и загрузок (по умолчанию `./data`) |
| `PUBLIC_URL` | адрес сайта, например `https://lyubov-v-cifrah.ru` (для писем и push) |
| `ADMIN_EMAILS` | почты модераторов через запятую |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | отправка писем (SMTPS 465 или STARTTLS 587) |
| `DEV_CODES` | `1` — показывать код входа в ответе (только для проверки!) |
| `AUTO_APPROVE` | `1` — фото без модерации |
| `PUSH_ENABLED` | `1` — включить Web Push (по умолчанию выключен, нужен для этого уведомление РКН о трансграничной передаче) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | push; если не заданы, сервер создаёт ключи и хранит в `DATA_DIR/vapid.json` (только при `PUSH_ENABLED=1`) |
| `CONSENT_VERSION` | редакция текстов согласий, записывается с каждым согласием (по умолчанию `2026-10-14`) |
| `METRIKA_ID` | номер счётчика Яндекс Метрики |
| `TKASSA_*` | как в `docs/tkassa-setup.md`; `TKASSA_API_URL` — адрес API (только для тестов, по умолчанию `https://securepay.tinkoff.ru/v2`) |

Файл `.env` в корне проекта читается сервером автоматически (уже заданные переменные окружения важнее). Пример — `server/.env.example`, установка — `docs/deploy.md`.

`GET /api/config` дополнительно отдаёт `iceServers` (список STUN/TURN для звонков), если задана переменная `ICE_SERVERS` (JSON).
