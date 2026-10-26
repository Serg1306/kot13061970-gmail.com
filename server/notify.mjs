// Уведомления: Web Push и письма. Всё отправляется в фоне и не задерживает ответ на запрос.
import { textFor } from './langs.mjs';

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
  uk: {
    message: n => ({ title: 'Нове повідомлення', body: `${n} написав(ла) вам` }),
    match: n => ({ title: 'Взаємна симпатія!', body: `Ви сподобалися одне одному з ${n}` }),
    friend_req: n => ({ title: 'Запит у друзі', body: `${n} хоче додати вас у друзі` }),
    call: n => ({ title: 'Вхідний дзвінок', body: `${n} дзвонить вам` }),
    support: () => ({ title: 'Підтримка', body: 'Відповідь від підтримки «Любов у цифрах»' }),
  },
  kk: {
    message: n => ({ title: 'Жаңа хабар', body: `${n} сізге жазды` }),
    match: n => ({ title: 'Өзара ұнату!', body: `Сіз бен ${n} бір-біріңізге ұнадыңыздар` }),
    friend_req: n => ({ title: 'Достыққа өтінім', body: `${n} сізді досқа қосқысы келеді` }),
    call: n => ({ title: 'Кіріс қоңырау', body: `${n} сізге қоңырау шалып жатыр` }),
    support: () => ({ title: 'Қолдау', body: '«Махаббат сандарда» қолдау қызметінің жауабы' }),
  },
  uz: {
    message: n => ({ title: 'Yangi xabar', body: `${n} sizga yozdi` }),
    match: n => ({ title: 'Oʻzaro yoqtirish!', body: `Siz va ${n} bir-biringizga yoqdingiz` }),
    friend_req: n => ({ title: 'Doʻstlik soʻrovi', body: `${n} sizni doʻstlarga qoʻshmoqchi` }),
    call: n => ({ title: 'Kiruvchi qoʻngʻiroq', body: `${n} sizga qoʻngʻiroq qilyapti` }),
    support: () => ({ title: 'Qoʻllab-quvvatlash', body: '«Sevgi raqamlarda» qoʻllab-quvvatlash xizmatidan javob' }),
  },
  de: {
    message: n => ({ title: 'Neue Nachricht', body: `${n} hat dir geschrieben` }),
    match: n => ({ title: 'Ein Match!', body: `Du und ${n} mögt euch` }),
    friend_req: n => ({ title: 'Freundschaftsanfrage', body: `${n} möchte mit dir befreundet sein` }),
    call: n => ({ title: 'Eingehender Anruf', body: `${n} ruft dich an` }),
    support: () => ({ title: 'Support', body: 'Antwort vom Support von „Liebe in Zahlen“' }),
  },
  es: {
    message: n => ({ title: 'Nuevo mensaje', body: `${n} te ha escrito` }),
    match: n => ({ title: '¡Es un match!', body: `Tú y ${n} os habéis gustado` }),
    friend_req: n => ({ title: 'Solicitud de amistad', body: `${n} quiere ser tu amigo` }),
    call: n => ({ title: 'Llamada entrante', body: `${n} te está llamando` }),
    support: () => ({ title: 'Soporte', body: 'Respuesta del soporte de «Amor en Números»' }),
  },
  fr: {
    message: n => ({ title: 'Nouveau message', body: `${n} vous a écrit` }),
    match: n => ({ title: "C'est un match !", body: `Vous et ${n} vous plaisez mutuellement` }),
    friend_req: n => ({ title: "Demande d'ami", body: `${n} souhaite vous ajouter en ami` }),
    call: n => ({ title: 'Appel entrant', body: `${n} vous appelle` }),
    support: () => ({ title: 'Assistance', body: "Réponse de l'assistance « L'Amour en Chiffres »" }),
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
    const t = textFor(PUSH_TEXT, to.lang)[kind](fromUser?.name || '');
    bg(pushTo(to.id, { ...t, url: URLS[kind](fromUser?.id) }));
  }

  // Письмо не чаще раза в 30 минут на человека.
  function sendEmail(to, kind, fromUser) {
    // Вошедшим по телефону писем не шлём: почты у них нет.
    if (!to.notify_email || !to.email.includes('@')) return;
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
