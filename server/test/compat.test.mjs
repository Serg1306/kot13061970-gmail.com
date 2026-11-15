// Таблица совместимости (site/lyubov-v-cifrah/compat-table.js) и копии расчёта в compat.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const site = new URL('../../site/lyubov-v-cifrah/', import.meta.url);
const read = f => readFileSync(new URL(f, site), 'utf8');
const NUMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 22];

function load(...files) {
  const ctx = { window: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ctx.window = ctx;
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  return ctx;
}

test('таблица совместимости: все пары чисел есть, проценты 0–100, тексты не пустые', () => {
  const { LVC_TABLE: t } = load('compat-table.js');
  for (const n of NUMS) assert.ok(t.numbers[n]?.name && t.numbers[n]?.about, `число ${n}`);
  const keys = [];
  for (const a of NUMS) for (const b of NUMS) if (a <= b) keys.push(`${a}-${b}`);
  assert.deepEqual(Object.keys(t.pairs).sort(), keys.sort(), 'лишние или пропущенные пары');
  for (const [k, [pct, text]] of Object.entries(t.pairs)) {
    assert.ok(Number.isInteger(pct) && pct >= 0 && pct <= 100, `процент пары ${k}`);
    assert.ok(typeof text === 'string' && text.length > 20, `текст пары ${k}`);
  }
  assert.equal(t.levels.at(-1).min, 0, 'последний уровень должен начинаться с 0');
  for (let i = 1; i < t.levels.length; i++) assert.ok(t.levels[i - 1].min > t.levels[i].min, 'уровни идут от большего к меньшему');
});

test('калькулятор: процент только из таблицы, порядок дат не важен, мастер-числа не сводятся', () => {
  const { LVC, LVC_TABLE: t } = load('compat-table.js', 'compat.js');
  // 13.06.1990 → 29 → 11; 27.10.1988 → 36 → 9
  assert.equal(LVC.lifePath(LVC.parse('1990-06-13')), 11);
  assert.equal(LVC.lifePath(LVC.parse('1988-10-27')), 9);
  const r = LVC.compat('1990-06-13', '1988-10-27');
  assert.equal(r.total, t.pairs['9-11'][0]);
  assert.equal(LVC.compat('1988-10-27', '1990-06-13').total, r.total);
  assert.ok(r.about.startsWith(t.pairs['9-11'][1]));
  assert.equal(LVC.verdictOf(r.total), t.levels.find(l => r.total >= l.min).title);
});

test('копии расчёта в compat.js и goroda/compat.js совпадают с index.html', () => {
  // блок идёт от «расчёты по дате» до ageOf (index.html), window.LVC (compat.js) или виджета (goroda/compat.js)
  const block = s => {
    const a = s.indexOf('/* ---------- расчёты по дате ---------- */');
    const b = Math.min(...['function ageOf', 'window.LVC = {', '/* ---------- виджет'].map(m => s.indexOf(m, a)).filter(i => i > a));
    return s.slice(a, b).trim();
  };
  const main = block(read('index.html'));
  assert.ok(main.includes('LVC_TABLE'));
  assert.equal(block(read('compat.js')), main, 'compat.js устарел');
  assert.equal(block(read('goroda/compat.js')), main, 'goroda/compat.js устарел: python3 tools/make_city_pages.py');
});
