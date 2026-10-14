# API сервера «Любовь в цифрах»

Сервер: `server/server.mjs` (Node.js 22.5+, без внешних зависимостей, база SQLite через `node:sqlite`). Запуск: `npm start`, тесты: `npm test`.
Он же раздаёт статику сайта из `site/lyubov-v-cifrah/` по адресу `/` и загруженные файлы по `/uploads/…`.

Все ответы — JSON `{"error": "<код>"}` при ошибке с HTTP-статусом 4xx/5xx. Тела запросов — JSON (лимит 8 МБ, больше — `413 too_large`; не JSON — `400 bad_json`).
Сессия — cookie `lvc_s` (HttpOnly, SameSite=Lax, Secure при HTTPS), 60 дней. В базе хранится только SHA-256 токена.
Все изменяющие запросы (POST/PUT/DELETE) требуют заголовок `X-Requested-With: lvc` (защита от CSRF), иначе `403 csrf`. Исключение — `/api/robokassa-result` (его вызывает Робокасса).

Общие ошибки: `401 auth` — нет сессии; `409 profile_required` — анкета ещё не заполнена (нужен `PUT /api/profile`); `403 banned` — пользователь забанен;
`404 not_found` — нет такой анкеты/объекта или она скрыта; `429 rate_limited {wait}` — слишком часто;
`400 invalid {field}` — неверное поле (`field` — имя поля).

Сайт определяет режим так: `GET /api/config` ответил 200 → «живой» режим с сервером; иначе — демо-режим (как сейчас, всё в браузере).

## Объекты

```
User (свой)  = { id, email, name, birth: "YYYY-MM-DD", g: "m"|"f", seek: "m"|"f"|"a", city, about, lang: "ru"|"en",
                 verified: bool, verifyStatus: "none"|"pending"|"approved"|"rejected",
                 hideAge: bool, invisible: bool, notifyEmail: bool, notifyPush: bool, consentAt: ms, createdAt: ms }
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

`GET /api/config` → `{ live: true, robokassa: bool, vapidPublicKey: string|null, metrikaId: string|null, devCodes: bool }`

## Вход по почте

- `POST /api/auth/start { email, lang }` → `{ ok: true, devCode?: "123456" }`. Почта приводится к нижнему регистру, пробелы обрезаются (`bad_email` при неверной). Шестизначный код, живёт 10 минут, 5 попыток, не чаще раза в 60 с на почту (`429 {error:"too_often", wait: сек}`). `devCode` возвращается только при `DEV_CODES=1`. Если SMTP не настроен, код пишется в журнал сервера; если письмо не ушло — `502 mail_failed`.
- `POST /api/auth/verify { email, code }` → ставит cookie, `{ user: User|null }` (`null` — анкета ещё не заполнена). Ошибки: `400 bad_code`, `400 code_expired`, `429 too_many_attempts`. При первом входе создаётся аккаунт, приветственное сообщение от `support` (на языке из `auth/start`) и событие `system`.
- `POST /api/auth/logout` → `{ ok: true }`.
- `DELETE /api/account` → удаляет пользователя и всё его (фото-файлы, селфи, голосовые, посты, сообщения в обе стороны, лайки…), `{ ok: true }`.

## Своя анкета

- `GET /api/me` → `401 {error:"auth"}` или `{ user: User|null, wallet: Wallet, photos: Photo[], admin: bool, banned: bool }`.
- `PUT /api/profile { name, birth, g, seek, city, about, lang, consent }` → `{ user }`. Проверки (строки обрезаются, внутренние пробелы в имени и городе схлопываются):
  - `name` — `/^[\p{L}\p{M}][\p{L}\p{M} .'’-]{0,39}$/u`, иначе `400 bad_name`;
  - `city` — `/^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .,'’()-]{0,59}$/u`, иначе `400 bad_city`;
  - `about` — свободный текст ≤ 500 (`invalid`, field `about`); `birth` — настоящая дата `YYYY-MM-DD` (`invalid`, field `birth`); `g`, `seek` — `invalid`;
  - возраст ≥ 18 (`under_18`); при первом сохранении `consent: true` обязателен (`consent_required`) — пишется `consentAt`.
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

- `POST /api/push/subscribe { subscription }` (объект PushSubscription.toJSON()) / `POST /api/push/unsubscribe { endpoint }`. Принимаются только адреса служб push (FCM, Mozilla, Apple, Windows) по https.
- Сервер шлёт Web Push (VAPID, шифрование aes128gcm, реализовано на `node:crypto`) о новом сообщении, взаимной симпатии, заявке в друзья, входящем звонке, ответе поддержки — если у получателя `notifyPush`. Полезная нагрузка: `{ title, body, url }`, где `url`:
  `/?go=messages&with=<id>`, `/?go=matches&with=<id>`, `/?go=friends`, `/?go=call&from=<id>`, `/?go=messages&with=support`. Подписки, на которые служба ответила 404/410, удаляются.
- На почту (если `notifyEmail`): взаимная симпатия и первое непрочитанное сообщение от собеседника, не чаще раза в 30 минут на человека.

## Оплата (Робокасса)

Те же адреса, что и у функций Netlify, логика из `netlify/lib/robokassa.mjs`:
- `GET /api/pay` → `{ configured, test, catalog }`.
- `POST /api/pay { product }` → `{ url, invId }` (нужна сессия; счёт записывается в таблицу `orders` и привязан к пользователю; `unknown_product`, `503 not_configured`).
- `POST|GET /api/robokassa-result` (Result URL) — проверка подписи паролем #2 и того, что товар совпадает со счётом; начисление VIP/монет в базе ровно один раз (+ событие `system` «Оплата получена»), ответ `OK<InvId>` (и на повторное уведомление тоже). Неверная подпись — `400 bad sign`, неизвестный счёт — `404`.
- `POST /api/pay-confirm` (тело — параметры, с которыми Робокасса вернула на Success URL, JSON или форма; заголовок `X-Requested-With: lvc` обязателен) — проверка подписи паролем #1; начисление уже сделано по Result URL (или делается здесь, если ещё нет — идемпотентно).
  Ответ: `{ ok: true, invId, product, title, price, vipDays?|coins?, fresh: bool, wallet? }`. `fresh` = true только при первом подтверждении этого счёта (показывать «Оплата прошла» один раз). `wallet` — только если запрос с сессией владельца счёта; без сессии подпись всё равно проверяется. Ошибки: `bad_signature`, `404 unknown_order`.

## Модерация

`site/lyubov-v-cifrah/admin.html` (только для почт из `ADMIN_EMAILS`, вход тем же кодом из письма; иначе `403 forbidden`):
- `GET /api/admin/queue` →
  `{ photos: [{ id, userId, name, email, src, t }], verifications: [{ userId, name, email, gesture, selfie, photo, t }],
     reports: [{ id, t, reason, text, from: {id,name,email,banned}, target: {id,name,email,banned,photo}, count }],
     support: [{ user: {id,name,email,banned}, unread, last: Message }], banned: [{id,name,email,banned}],
     stats: { users, today, online, paid, paidToday, revenue, messagesToday, banned } }`
- `POST /api/admin/photo { id, approve }`, `POST /api/admin/verify { userId, approve }` (пользователю — событие `system`), `POST /api/admin/report { id, action: "dismiss"|"ban" }` (бан закрывает все открытые жалобы на этого человека), `POST /api/admin/unban { userId }`.
- `GET /api/admin/support?userId=` → `{ user, messages }` (отмечает обращения прочитанными); ответ: `POST /api/admin/support { userId, text }` → `{ message }` — у пользователя появляется сообщение от `"support"` (+ push).
- `GET /api/admin/file/:name` — селфи для проверки (хранятся в `DATA_DIR/private`, не в `/uploads`).

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
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | push; если не заданы, сервер создаёт ключи и хранит в `DATA_DIR/vapid.json` |
| `METRIKA_ID` | номер счётчика Яндекс Метрики |
| `ROBOKASSA_*` | как в `docs/robokassa-setup.md` |

Файл `.env` в корне проекта читается сервером автоматически (уже заданные переменные окружения важнее). Пример — `server/.env.example`, установка — `docs/deploy.md`.

`GET /api/config` дополнительно отдаёт `iceServers` (список STUN/TURN для звонков), если задана переменная `ICE_SERVERS` (JSON).
