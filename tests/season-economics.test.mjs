import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateSeasonBudget} from '../season-economics.mjs';

const cost = (label = 'بذور', quantity = 1, unitCostIqd = 100, basis = 'total') => ({label, quantity, unitCostIqd, basis});
const budget = extra => ({areaDonum: 5, costs: [cost()], ...extra});
function rejects(input) { assert.throws(() => calculateSeasonBudget(input), error => error.code === 'INVALID_BUDGET' && /[\u0600-\u06ff]/u.test(error.message)); }

test('mixed whole-season and per-donum costs produce reproducible season margins and thresholds', () => {
  const r = calculateSeasonBudget({areaDonum: 10, costs: [cost('بذور', 8, 1500, 'per_donum'), cost('عمالة', 2, 50000), cost('ري', 3, 2000, 'per_donum')], yieldKgPerDonum: 400, salePriceIqdPerKg: 500});
  assert.deepEqual(r.costs.map(row => row.total_iqd), [120000, 100000, 60000]);
  assert.equal(r.total_cost_iqd, 280000); assert.equal(r.cost_per_donum_iqd, 28000);
  assert.equal(r.expected_production_kg, 4000); assert.equal(r.expected_revenue_iqd, 2000000); assert.equal(r.expected_margin_iqd, 1720000);
  assert.equal(r.break_even_price_iqd_per_kg, 70); assert.equal(r.break_even_yield_kg_per_donum, 56);
});

test('line amounts round before totals, using exact decimal halves rather than binary floating-point artifacts', () => {
  const r = calculateSeasonBudget({areaDonum: 50, costs: [cost('نصف دينار حسابي', .1, .7, 'per_donum'), cost('أ', 1, .4), cost('ب', 1, .4)]});
  assert.deepEqual(r.costs.map(row => row.total_iqd), [4, 0, 0]); assert.equal(r.total_cost_iqd, 4);
  assert.equal(calculateSeasonBudget(budget({costs: [cost('تقريب', 1, 2.5)]})).total_cost_iqd, 3);
});

test('production display rounding does not prematurely round revenue or break-even calculations', () => {
  const r = calculateSeasonBudget({areaDonum: 1.2345, costs: [cost('تكلفة', 1, 1)], yieldKgPerDonum: 1, salePriceIqdPerKg: 100000});
  assert.equal(r.expected_production_kg, 1.235); assert.equal(r.expected_revenue_iqd, 123450); assert.equal(r.expected_margin_iqd, 123449);
  assert.equal(r.break_even_price_iqd_per_kg, .81);
});

test('per-unit break-even prices and yields retain three decimal places', () => {
  const r = calculateSeasonBudget({areaDonum: 3, costs: [cost()], yieldKgPerDonum: 2, salePriceIqdPerKg: 18.7});
  assert.equal(r.cost_per_donum_iqd, 33); assert.equal(r.expected_revenue_iqd, 112); assert.equal(r.expected_margin_iqd, 12);
  assert.equal(r.break_even_price_iqd_per_kg, 16.667); assert.equal(r.break_even_yield_kg_per_donum, 1.783);
});

test('missing optional assumptions remain unknown rather than becoming zero', () => {
  for (const missing of [undefined, null, '', '  ']) {
    const r = calculateSeasonBudget(budget({yieldKgPerDonum: missing, salePriceIqdPerKg: missing}));
    for (const key of ['expected_production_kg', 'expected_revenue_iqd', 'expected_margin_iqd', 'break_even_price_iqd_per_kg', 'break_even_yield_kg_per_donum']) assert.equal(r[key], null, key);
    assert.ok(r.warnings.some(w => w.includes('غير مدخل')));
  }
});

test('known yield determines production and break-even price independently of unknown sale price', () => {
  const r = calculateSeasonBudget(budget({yieldKgPerDonum: 100}));
  assert.equal(r.expected_production_kg, 500); assert.equal(r.break_even_price_iqd_per_kg, .2);
  assert.equal(r.expected_revenue_iqd, null); assert.equal(r.expected_margin_iqd, null); assert.equal(r.break_even_yield_kg_per_donum, null);
});

test('known positive price determines break-even yield independently of missing yield', () => {
  const r = calculateSeasonBudget(budget({salePriceIqdPerKg: 100}));
  assert.equal(r.break_even_yield_kg_per_donum, .2); assert.equal(r.expected_production_kg, null); assert.equal(r.expected_revenue_iqd, null); assert.equal(r.break_even_price_iqd_per_kg, null);
});

test('explicit zero yield and price remain zero without division by zero', () => {
  const both = calculateSeasonBudget(budget({yieldKgPerDonum: 0, salePriceIqdPerKg: 0}));
  assert.equal(both.expected_production_kg, 0); assert.equal(both.expected_revenue_iqd, 0); assert.equal(both.expected_margin_iqd, -100);
  assert.equal(both.break_even_price_iqd_per_kg, null); assert.equal(both.break_even_yield_kg_per_donum, null);
  const yieldZero = calculateSeasonBudget(budget({yieldKgPerDonum: 0, salePriceIqdPerKg: 100}));
  assert.equal(yieldZero.break_even_yield_kg_per_donum, .2);
  const priceZero = calculateSeasonBudget(budget({yieldKgPerDonum: 100, salePriceIqdPerKg: 0}));
  assert.equal(priceZero.expected_revenue_iqd, 0); assert.equal(priceZero.expected_margin_iqd, -100); assert.equal(priceZero.break_even_price_iqd_per_kg, .2);
});

test('explicit zero cost lines are accepted and distinguish entered expenses from a complete profit guarantee', () => {
  const r = calculateSeasonBudget(budget({costs: [cost('دون كمية', 0, 90), cost('دون سعر', 2, 0)], yieldKgPerDonum: 100, salePriceIqdPerKg: 100}));
  assert.equal(r.total_cost_iqd, 0); assert.equal(r.expected_margin_iqd, 50000); assert.equal(r.break_even_price_iqd_per_kg, 0); assert.equal(r.break_even_yield_kg_per_donum, 0);
  assert.ok(r.warnings.some(w => w.includes('التكاليف المدخلة فقط'))); assert.ok(r.warnings.some(w => w.includes('ليست ضمانًا')));
});

test('negative gross margin is retained rather than clamped or advertised as profit', () => {
  const r = calculateSeasonBudget({areaDonum: 2, costs: [cost('مصروف', 1, 1000)], yieldKgPerDonum: 10, salePriceIqdPerKg: 1});
  assert.equal(r.expected_revenue_iqd, 20); assert.equal(r.expected_margin_iqd, -980);
});

test('discloses positive values rounded to zero while keeping actual zero inputs distinct', () => {
  const rounded = calculateSeasonBudget(budget({costs: [cost('جزء وحدة', .1, 1)]}));
  assert.equal(rounded.total_cost_iqd, 0); assert.ok(rounded.warnings.some(w => w.includes('بسبب التقريب')));
  const zero = calculateSeasonBudget(budget({costs: [cost('صفر فعلي', 0, 1)]}));
  assert.equal(zero.total_cost_iqd, 0); assert.equal(zero.warnings.some(w => w.includes('بسبب التقريب')), false);
  const tiny = calculateSeasonBudget({areaDonum: .0004, costs: [cost('تكلفة', 1, 1)], yieldKgPerDonum: 1, salePriceIqdPerKg: 10000});
  assert.equal(tiny.expected_production_kg, 0); assert.equal(tiny.expected_revenue_iqd, 4); assert.ok(tiny.warnings.some(w => w.includes('بسبب التقريب')));
});

test('area, quantities and prices enforce finite numeric bounds', () => {
  for (const area of [undefined, null, '', '5', 0, -1, NaN, Infinity, 1000001]) rejects(budget({areaDonum: area}));
  for (const value of [null, undefined, '1', -1, NaN, Infinity, 1e9 + 1]) {
    rejects(budget({costs: [{...cost(), quantity: value}]})); rejects(budget({costs: [{...cost(), unitCostIqd: value}]}));
  }
  for (const value of ['0', -1, NaN, Infinity, 1e9 + 1]) {
    rejects(budget({yieldKgPerDonum: value})); rejects(budget({salePriceIqdPerKg: value}));
  }
});

test('requires at least one named cost line and at most fifty, without modifying labels into HTML', () => {
  for (const costs of [null, undefined, {}, [], Array.from({length: 51}, () => cost()), [null], [[]], [cost(' ')], [cost('x'.repeat(81))], [cost('أ', 1, 1, 'monthly')]]) rejects(budget({costs}));
  assert.equal(calculateSeasonBudget(budget({costs: Array.from({length: 50}, () => cost())})).total_cost_iqd, 5000);
  const label = '  <b>ملاحظات مدخلة</b>  ';
  assert.equal(calculateSeasonBudget(budget({costs: [cost(label)]})).costs[0].label, label.trim());
  assert.equal(calculateSeasonBudget(budget({costs: [cost('x'.repeat(80))]})).costs[0].label.length, 80);
});

test('rejects oversized computed line totals, sums, production, revenue and unit thresholds', () => {
  rejects(budget({costs: [cost('أ', 1e9, 1e9)]}));
  rejects(budget({costs: [cost('أ', 1e6, 1e9), cost('ب', 1, 1)]}));
  rejects(budget({areaDonum: 1e6, costs: [cost('أ', 1e6, 1e9, 'per_donum')]}));
  rejects(budget({areaDonum: 1e6, yieldKgPerDonum: 1e9, salePriceIqdPerKg: 2}));
  rejects(budget({areaDonum: .000000001, costs: [cost('أ', 1, 1e9)]}));
  rejects(budget({yieldKgPerDonum: .0000000001, costs: [cost('أ', 1, 1e9)]}));
  rejects(budget({salePriceIqdPerKg: .0000000001, costs: [cost('أ', 1, 1e9)]}));
});

test('supports the maximum output amount exactly with no unsafe integer money totals', () => {
  const r = calculateSeasonBudget({areaDonum: 1, costs: [cost('أ', 1e6, 1e9)], yieldKgPerDonum: 1, salePriceIqdPerKg: 1e9});
  assert.equal(r.total_cost_iqd, 1e15); assert.equal(r.break_even_price_iqd_per_kg, 1e15);
  assert.equal(r.expected_margin_iqd, -999999000000000); assert.ok(Number.isSafeInteger(r.total_cost_iqd));
});

test('supports very small finite decimal inputs and never emits NaN, infinity or negative zero', () => {
  const r = calculateSeasonBudget({areaDonum: Number.MIN_VALUE, costs: [cost('أ', Number.MIN_VALUE, 1)], yieldKgPerDonum: -0, salePriceIqdPerKg: -0});
  for (const value of Object.values(r).filter(value => typeof value === 'number')) { assert.ok(Number.isFinite(value)); assert.equal(Object.is(value, -0), false); }
  assert.equal(r.total_cost_iqd, 0); assert.equal(r.expected_production_kg, 0);
});

test('is deterministic, has no side effects and does not mutate frozen caller inputs', () => {
  const input = Object.freeze({areaDonum: 2, costs: Object.freeze([Object.freeze(cost('  بذور  ', 3, 20, 'per_donum'))]), yieldKgPerDonum: 400, salePriceIqdPerKg: 500});
  assert.deepEqual(calculateSeasonBudget(input), calculateSeasonBudget(input));
  assert.equal(input.costs[0].label, '  بذور  ');
  for (const input of [null, undefined, false, 0, [], 'budget']) rejects(input);
});
