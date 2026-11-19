// Приглашения друзей. Ссылка вида /?ref=<id пригласившего>; новый аккаунт запоминает, кто его пригласил (users.ref_by).
// Бонус — по 7 дней VIP обоим — начисляется один раз, когда у приглашённого одобрено первое фото:
// так бонус получают за живых людей с анкетой, а не за пустые аккаунты.
import { textFor } from './langs.mjs';
import { DAY, addEvent } from './model.mjs';

export const REF_DAYS = 7;
// Не больше 10 бонусов пригласившему за 30 дней (приглашённый получает свой в любом случае).
const REF_LIMIT = 10;
const REF_RE = /^[0-9a-f]{16}$/;

const TEXT = {
  ru: { inviter: 'Друг пришёл по вашей ссылке и добавил фото: вам начислено 7 дней VIP.', invitee: 'Бонус за регистрацию по приглашению: 7 дней VIP.' },
  en: { inviter: 'A friend joined with your link and added a photo: you got 7 days of VIP.', invitee: 'Invitation bonus: 7 days of VIP.' },
  uk: { inviter: 'Друг прийшов за вашим посиланням і додав фото: вам нараховано 7 днів VIP.', invitee: 'Бонус за реєстрацію за запрошенням: 7 днів VIP.' },
  kk: { inviter: 'Досыңыз сіздің сілтемеңіз арқылы келіп, сурет қосты: сізге 7 күн VIP берілді.', invitee: 'Шақыру бойынша тіркелгені үшін бонус: 7 күн VIP.' },
  uz: { inviter: 'Doʻstingiz havolangiz orqali kelib, rasm qoʻshdi: sizga 7 kun VIP berildi.', invitee: 'Taklif orqali roʻyxatdan oʻtganingiz uchun bonus: 7 kun VIP.' },
  de: { inviter: 'Ein Freund hat sich über deinen Link angemeldet und ein Foto hinzugefügt: Du bekommst 7 Tage VIP.', invitee: 'Einladungsbonus: 7 Tage VIP.' },
  es: { inviter: 'Un amigo se registró con tu enlace y añadió una foto: recibes 7 días de VIP.', invitee: 'Bono por invitación: 7 días de VIP.' },
  fr: { inviter: 'Un ami s\'est inscrit avec votre lien et a ajouté une photo : vous recevez 7 jours de VIP.', invitee: 'Bonus d\'invitation : 7 jours de VIP.' },
};

// Код из ссылки → id пригласившего, если такой человек есть и не забанен.
export function referrerOf(db, code) {
  if (typeof code !== 'string' || !REF_RE.test(code)) return null;
  return db.get('SELECT id FROM users WHERE id = ? AND banned = 0', code)?.id || null;
}

// Сколько человек пришло по ссылке и за скольких начислен бонус.
export const referralStats = (db, userId) =>
  db.get('SELECT COUNT(*) AS invited, COUNT(ref_paid) AS rewarded FROM users WHERE ref_by = ?', userId);

// Вызывается после одобрения фото (или сразу при загрузке, если модерация выключена).
export function rewardReferral(db, userId, now = Date.now()) {
  db.tx(() => {
    const u = db.get('SELECT id, lang, ref_by, ref_paid, banned FROM users WHERE id = ?', userId);
    if (!u || !u.ref_by || u.ref_paid || u.banned) return;
    if (!db.get("SELECT 1 FROM photos WHERE user_id = ? AND status = 'approved'", userId)) return;
    db.run('UPDATE users SET ref_paid = ? WHERE id = ?', now, userId);
    const add = id => db.run('UPDATE users SET vip_until = MAX(vip_until, ?) + ? WHERE id = ?', now, REF_DAYS * DAY, id);
    add(u.id);
    addEvent(db, u.id, 'system', null, textFor(TEXT, u.lang).invitee);
    const inviter = db.get('SELECT id, lang, banned FROM users WHERE id = ?', u.ref_by);
    if (!inviter || inviter.banned) return;
    const recent = db.get('SELECT COUNT(*) AS n FROM users WHERE ref_by = ? AND ref_paid >= ?', inviter.id, now - 30 * DAY).n;
    // recent уже включает только что отмеченного приглашённого.
    if (recent > REF_LIMIT) return;
    add(inviter.id);
    addEvent(db, inviter.id, 'system', null, textFor(TEXT, inviter.lang).inviter);
  });
}
