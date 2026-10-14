// База данных SQLite (встроенный модуль node:sqlite, без внешних библиотек).
// Все запросы — подготовленные выражения, они кэшируются по тексту SQL.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT, birth TEXT, g TEXT, seek TEXT, city TEXT,
  about TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT 'ru',
  verify_status TEXT NOT NULL DEFAULT 'none',
  verify_file TEXT, verify_gesture TEXT, verify_at INTEGER,
  hide_age INTEGER NOT NULL DEFAULT 0,
  invisible INTEGER NOT NULL DEFAULT 0,
  notify_email INTEGER NOT NULL DEFAULT 1,
  notify_push INTEGER NOT NULL DEFAULT 1,
  consent_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  vip_until INTEGER NOT NULL DEFAULT 0,
  boost_until INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  last_email_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'ru',
  expires INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  status TEXT NOT NULL,
  pos INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_user ON photos(user_id, pos);
CREATE INDEX IF NOT EXISTS photos_status ON photos(status);
CREATE TABLE IF NOT EXISTS likes (
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  t INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS likes_to ON likes(to_id);
CREATE TABLE IF NOT EXISTS passes (
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  t INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE TABLE IF NOT EXISTS visits (
  viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  t INTEGER NOT NULL,
  PRIMARY KEY (viewer_id, owner_id)
);
CREATE INDEX IF NOT EXISTS visits_owner ON visits(owner_id, t);
CREATE TABLE IF NOT EXISTS friends (
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  t INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS friends_to ON friends(to_id);
CREATE TABLE IF NOT EXISTS blocks (
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  t INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS blocks_to ON blocks(to_id);
-- from_id/to_id могут быть "support", поэтому без внешних ключей: удаление делается вручную.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT, src TEXT, dur INTEGER,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_to ON messages(to_id, t);
CREATE INDEX IF NOT EXISTS messages_from ON messages(from_id, t);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  t INTEGER NOT NULL,
  kind TEXT NOT NULL,
  who TEXT REFERENCES users(id) ON DELETE CASCADE,
  text TEXT
);
CREATE INDEX IF NOT EXISTS events_user ON events(user_id, t);
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  t INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS signals_to ON signals(to_id, t);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  t INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  t INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  img TEXT
);
CREATE INDEX IF NOT EXISTS posts_t ON posts(t);
CREATE TABLE IF NOT EXISTS post_likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  t INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS gifts_to ON gifts(to_id);
-- Счета Робокассы: InvId привязан к пользователю, начисление ровно один раз (status new → paid).
CREATE TABLE IF NOT EXISTS orders (
  inv_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  product TEXT NOT NULL,
  price REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_user ON push_subs(user_id);
-- Журнал уничтожения персональных данных (приказ Роскомнадзора № 179 от 28.10.2022).
-- Сам человек здесь не хранится: только обезличенная ссылка и замаскированная почта.
CREATE TABLE IF NOT EXISTS pd_destruction (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  subject_ref TEXT NOT NULL,
  email_masked TEXT NOT NULL,
  categories TEXT NOT NULL,
  reason TEXT NOT NULL,
  method TEXT NOT NULL,
  operator TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pd_destruction_at ON pd_destruction(at);
-- Почты удалённых забаненных (только HMAC-хэш), чтобы они не могли зарегистрироваться снова. Хранятся 3 года.
CREATE TABLE IF NOT EXISTS banned_emails (
  email_hash TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL
);
`;

// Колонки, добавленные после первого выпуска: в старой базе их создаём через ALTER TABLE.
const COLUMNS = {
  users: { consent_public_at: 'INTEGER', consent_version: 'TEXT', consent_ip: 'TEXT', ban_reason: 'TEXT' },
  orders: { confirmed_at: 'INTEGER', refunded_at: 'INTEGER', refund_note: 'TEXT', last_checked_at: 'INTEGER' },
};

function migrate(raw) {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(raw.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const [name, type] of Object.entries(cols)) {
      if (!have.has(name)) raw.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}

export function openDb(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  raw.exec(SCHEMA);
  migrate(raw);
  const cache = new Map();
  const stmt = sql => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  let depth = 0;
  return {
    raw,
    get: (sql, ...p) => stmt(sql).get(...p),
    all: (sql, ...p) => stmt(sql).all(...p),
    run: (sql, ...p) => stmt(sql).run(...p),
    // Транзакция; вложенный вызов просто выполняется внутри внешней.
    tx(fn) {
      if (depth > 0) return fn();
      raw.exec('BEGIN IMMEDIATE');
      depth++;
      try {
        const r = fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
    close: () => raw.close(),
  };
}
