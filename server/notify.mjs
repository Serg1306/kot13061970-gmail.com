// Уведомления: Web Push и письма. Всё отправляется в фоне и не задерживает ответ на запрос.
const EMAIL_GAP = 30 * 60 * 1000;

const PUSH_TEXT = {
  ru: {
    message: n => ({ title: 'Новое сообщение', body: `${n} написал(а) вам` }),
    match: n => ({ title: 'Взаимная симпатия!', body: `Вы понравились друг другу с ${n}` }),
    friend_req: n => ({ title: 'Заявка в друзья', body: `${n} хочет добавить вас в друзья` }),
    call: n => ({ title: 'Входящий звонок', body: `${n} звонит вам` }),
    support: () => ({ title: 'Поддержка', body: 'Ответ от поддержки «Любовь в цифрах»' }),
  },
  en: {
    message: n => ({ title: 'New message', body: `${n} sent you a message` }),
    match: n => ({ title: "It's a match!", body: `You and ${n} like each other` }),
    friend_req: n => ({ title: 'Friend request', body: `${n} wants to be friends` }),
    call: n => ({ title: 'Incoming call', body: `${n} is calling you` }),
    support: () => ({ title: 'Support', body: 'Love in Numbers support replied' }),
  },
};

// Адрес, который откроет сайт при нажатии на уведомление.
const URLS = {
  message: id => `/?go=messages&with=${id}`,
  match: id => `/?go=matches&with=${id}`,
  friend_req: () => '/?go=friends',
  call: id => `/?go=call&from=${id}`,
  support: () => '/?go=messages&with=support',
};

export function createNotifier(app) {
  const { db, push, mailer, log, config } = app;
  const bg = p => p.catch(e => log.warn(`уведомление не отправлено: ${e.message}`));

  async function pushTo(userId, payload) {
    const subs = db.all('SELECT * FROM push_subs WHERE user_id = ?', userId);
    for (const sub of subs) {
      const status = await push.send(sub, payload).catch(e => { log.warn(`push: ${e.message}`); return 0; });
      if (status === 404 || status === 410) db.run('DELETE FROM push_subs WHERE endpoint = ?', sub.endpoint);
    }
  }

  function sendPush(to, kind, fromUser) {
    if (!push.publicKey || !to.notify_push) return;
    const t = PUSH_TEXT[to.lang === 'en' ? 'en' : 'ru'][kind](fromUser?.name || '');
    bg(pushTo(to.id, { ...t, url: URLS[kind](fromUser?.id) }));
  }

  // Письмо не чаще раза в 30 минут на человека.
  function sendEmail(to, kind, fromUser) {
    if (!to.notify_email) return;
    const now = Date.now();
    const r = db.run('UPDATE users SET last_email_at = ? WHERE id = ? AND last_email_at <= ?', now, to.id, now - EMAIL_GAP);
    if (!r.changes) return;
    const url = (config.publicUrl || '') + URLS[kind](fromUser.id);
    bg(mailer.send(to.email, kind, to.lang, { name: fromUser.name, url }));
  }

  const user = id => db.get('SELECT * FROM users WHERE id = ?', id);

  return {
    // Новое сообщение: push всегда, письмо — только на первое непрочитанное от этого собеседника.
    message(fromUser, toId) {
      const to = user(toId);
      if (!to || to.banned) return;
      sendPush(to, 'message', fromUser);
      const unread = db.get('SELECT COUNT(*) AS n FROM messages WHERE from_id = ? AND to_id = ? AND read = 0', fromUser.id, toId).n;
      if (unread === 1) sendEmail(to, 'message', fromUser);
    },
    match(fromUser, toId) {
      const to = user(toId);
      if (!to) return;
      sendPush(to, 'match', fromUser);
      sendEmail(to, 'match', fromUser);
    },
    friendReq(fromUser, toId) {
      const to = user(toId);
      if (to) sendPush(to, 'friend_req', fromUser);
    },
    call(fromUser, toId) {
      const to = user(toId);
      if (to) sendPush(to, 'call', fromUser);
    },
    support(toId) {
      const to = user(toId);
      if (to) sendPush(to, 'support', { id: 'support', name: '' });
    },
  };
}
