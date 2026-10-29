import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeResearchData, parseResearchCsv} from '../research-statistics.mjs';

function close(actual, expected, tolerance = 1e-12) {
  assert.ok(Number.isFinite(actual), `Expected a finite number, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} differs from ${expected}`);
}

function csvGroups(groups, offset = 0) {
  return 'group,value\n' + groups.flatMap((values, group) => values.map(value => `${group},${value + offset}`)).join('\n');
}

function anova(groups, offset = 0) {
  return analyzeResearchData({csv: csvGroups(groups, offset), valueColumn: 'value', groupColumn: 'group', method: 'oneway'});
}

function regression(xs, ys) {
  const csv = 'x,y\n' + xs.map((x, index) => `${x},${ys[index]}`).join('\n');
  return analyzeResearchData({csv, valueColumn: 'y', predictorColumn: 'x', method: 'regression'});
}

function finiteTree(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  else if (value && typeof value === 'object') Object.values(value).forEach(finiteTree);
}

test('RFC4180 CSV preserves quoted delimiters, double quotes, CRLF, BOM and literal HTML', () => {
  const parsed = parseResearchCsv('\uFEFFgroup,value,note\r\n" A, B ",1,"a ""quoted"" note\r\nsecond line"\r\n"<img src=x onerror=alert(1)>",2,=2+2\r\n');
  assert.deepEqual(parsed.headers, ['group', 'value', 'note']);
  assert.equal(parsed.delimiter, ',');
  assert.deepEqual(parsed.rows, [[' A, B ', '1', 'a "quoted" note\r\nsecond line'], ['<img src=x onerror=alert(1)>', '2', '=2+2']]);
});

test('semicolon CSV accepts decimal commas and quoted delimiter text', () => {
  const csv = 'treatment;yield\n"A; untreated";1,5\n"A; untreated";2,5\n';
  const result = analyzeResearchData({csv, valueColumn: 'yield', groupColumn: 'treatment'});
  assert.equal(parseResearchCsv(csv).delimiter, ';');
  assert.equal(result.descriptive.mean, 2);
  assert.equal(result.groups[0].label, 'A; untreated');
});

test('header-only CSV parses but analysis requires usable observations', () => {
  assert.deepEqual(parseResearchCsv(' value \n'), {headers: ['value'], rows: [], delimiter: ','});
  assert.throws(() => analyzeResearchData({csv: 'value\n', valueColumn: 'value'}), /No complete numeric/);
});

test('descriptive analysis is the default and never adds inferential output', () => {
  const result = analyzeResearchData({csv: 'value\n1\n2\n3\n4\n', valueColumn: 'value'});
  assert.equal(result.schema_version, 1);
  assert.equal(result.method, 'descriptive');
  assert.deepEqual(result.columns, {value: 'value', group: null, predictor: null});
  assert.deepEqual(result.groups, []);
  assert.equal(result.anova, undefined);
  assert.equal(result.regression, undefined);
  assert.equal(result.descriptive.n, 4);
  assert.equal(result.descriptive.mean, 2.5);
  assert.equal(result.descriptive.median, 2.5);
  close(result.descriptive.sd, Math.sqrt(5 / 3));
  assert.equal(result.descriptive.min, 1);
  assert.equal(result.descriptive.max, 4);
});

test('missing selected values exclude rows and never become zero', () => {
  const result = analyzeResearchData({csv: 'value,note\n0,real zero\n,blank\nNA,missing\nn/a,missing\nnull,missing\n4,valid\n\n', valueColumn: 'value'});
  assert.equal(result.rows_total, 7);
  assert.equal(result.rows_used, 2);
  assert.equal(result.rows_excluded, 5);
  assert.equal(result.descriptive.mean, 2);
  assert.equal(result.descriptive.median, 2);
  assert.match(result.warnings.join(' '), /not replaced with zero/);
});

test('missing predictor or blank group excludes only the associated rows', () => {
  const pairs = analyzeResearchData({csv: 'x,y\n1,2\nNA,3\n3,\n4,5', valueColumn: 'y', predictorColumn: 'x', method: 'regression'});
  assert.equal(pairs.rows_used, 2);
  assert.equal(pairs.rows_excluded, 2);
  assert.equal(pairs.regression.slope, 1);
  assert.equal(pairs.regression.p, null);
  const grouped = analyzeResearchData({csv: 'g,v\nA,1\n ,99\nNA,3', valueColumn: 'v', groupColumn: 'g'});
  assert.equal(grouped.rows_used, 2);
  assert.deepEqual(grouped.groups.map(group => group.label), ['A', 'NA']);
});

test('one observation has unavailable sample SD with an explicit warning', () => {
  const result = analyzeResearchData({csv: 'v\n7', valueColumn: 'v'});
  assert.deepEqual(result.descriptive, {n: 1, mean: 7, median: 7, sd: null, min: 7, max: 7});
  assert.match(result.warnings.join(' '), /standard deviation/);
});

test('selected numeric cells reject nonfinite, overflow, formula and nondecimal strings', () => {
  for (const value of ['NaN', 'NAN', 'Infinity', '-Infinity', '1e309', '1e-999', '=2+2', '<script>1</script>', '0x10', '123abc', '"1,200"']) {
    assert.throws(() => analyzeResearchData({csv: `v\n${value}`, valueColumn: 'v'}), error => error.code === 'invalid_analysis');
  }
  assert.throws(() => analyzeResearchData({csv: 'x,y\nNaN,NA\n2,3', valueColumn: 'y', predictorColumn: 'x', method: 'regression'}), /finite decimal/);
});

test('unselected text and formula cells are never evaluated or interpreted', () => {
  const result = analyzeResearchData({csv: 'g,v,note\n"<script>alert(1)</script>",1,=1+1\n"<script>alert(1)</script>",3,Infinity', valueColumn: 'v', groupColumn: 'g'});
  assert.equal(result.groups[0].label, '<script>alert(1)</script>');
  assert.equal(result.groups[0].mean, 2);
  assert.equal(result.rows_used, 2);
  assert.ok(!JSON.stringify(result).includes('Infinity'));
});

// These independent constants were obtained with scipy.stats.f_oneway in
// SciPy 1.17.0. Runtime tests and the engine do not depend on SciPy.
test('balanced one-way ANOVA matches independent SciPy fixture and exact sums of squares', () => {
  const result = anova([[6, 8, 4, 5, 3], [8, 12, 9, 11, 6], [13, 9, 11, 8, 7]]);
  assert.equal(result.anova.df_between, 2);
  assert.equal(result.anova.df_within, 12);
  close(result.anova.ss_between, 59.2);
  close(result.anova.ss_within, 60.8);
  close(result.anova.f, 5.842105263157896);
  close(result.anova.p, 0.01691741485440877);
  close(result.descriptive.sd, Math.sqrt(120 / 14));
  assert.deepEqual(result.groups.map(group => group.n), [5, 5, 5]);
  assert.match(result.anova.assumptions.join(' '), /independent/);
  assert.match(result.anova.assumptions.join(' '), /Randomized blocks.*not supported/);
});

test('unbalanced one-way ANOVA matches independent SciPy fixture', () => {
  const result = anova([[1.2, 1.7, 2.1], [3.1, 2.8, 4.2, 3.8], [5.3, 4.9]]);
  close(result.anova.f, 25.4919786096256);
  close(result.anova.p, 0.001167336150922205);
  assert.equal(result.anova.df_within, 6);
});

test('F-distribution tails match independent SciPy fixtures for multiple degrees of freedom', () => {
  const fixtures = [
    {groups: [[1, 1.5, 2], [10, 11, 10.5]], f: 486, p: 2.5057900499010636e-5},
    {groups: [[1, 2, 3], [1.001, 2.001, 3.001]], f: 1.49999999999967e-6, p: 0.9990814416335059},
    {groups: [[1, 2], [4, 9]], f: 3.8461538461538463, p: 0.18889289434618728},
    {groups: [[1, 2, 3, 4, 5], [10, 12, 14, 16, 18], [20, 23, 26, 29, 32], [30, 34, 38, 42, 46]], f: 60.86666666666667, p: 5.708658956308514e-9},
  ];
  for (const fixture of fixtures) {
    const result = anova(fixture.groups);
    close(result.anova.f, fixture.f);
    close(result.anova.p, fixture.p, 2e-12);
  }
});

test('ANOVA remains accurate at the 5000-row and 20-group limits', () => {
  // scipy.stats.f_oneway(*groups), SciPy 1.17.0. The small probability is
  // compared relatively so a rounded-to-zero implementation cannot pass.
  const groups = Array.from({length: 20}, (_, group) =>
    Array.from({length: 250}, (_, index) =>
      Math.sin((index + 1) * (group + 2)) * 3
      + Math.cos((index + 1) * (group + 1) * 0.7)
      + group * 0.05,
    ),
  );
  const result = anova(groups);
  assert.equal(result.rows_used, 5000);
  assert.equal(result.anova.df_within, 4980);
  close(result.anova.f, 4.82627284749988);
  assert.ok(Math.abs(result.anova.p / 2.186868487711141e-11 - 1) < 1e-9);
  finiteTree(result);
});

test('centering avoids catastrophic cancellation for large common offsets', () => {
  const values = analyzeResearchData({csv: 'v\n1000000000001\n1000000000002\n1000000000003\n1000000000004\n1000000000005', valueColumn: 'v'});
  assert.equal(values.descriptive.mean, 1000000000003);
  close(values.descriptive.sd, Math.sqrt(2.5));
  const shifted = anova([[6, 8, 4, 5, 3], [8, 12, 9, 11, 6], [13, 9, 11, 8, 7]], 1e12);
  close(shifted.anova.f, 5.842105263157896);
  close(shifted.anova.p, 0.01691741485440877);
});

test('one-way ANOVA rejects insufficient groups or group observations', () => {
  assert.throws(() => anova([[1, 2]]), /at least two independent groups/);
  assert.throws(() => anova([[1, 2], [3]]), /two numeric observations in every group/);
  assert.throws(() => analyzeResearchData({csv: 'v\n1\n2', valueColumn: 'v', method: 'oneway'}), /Select a group/);
});

test('zero within-group variance never fabricates F, p or a significance conclusion', () => {
  for (const groups of [[[1, 1], [2, 2]], [[3, 3], [3, 3]]]) {
    const result = anova(groups);
    assert.equal(result.anova.ss_within, 0);
    assert.equal(result.anova.f, null);
    assert.equal(result.anova.p, null);
    assert.match(result.warnings.join(' '), /No significance decision/);
    finiteTree(result);
  }
  const equalMeans = anova([[1, 3], [1, 3]]);
  assert.equal(equalMeans.anova.f, 0);
  assert.equal(equalMeans.anova.p, 1);
});

// Independent scipy.stats.linregress fixtures, SciPy 1.17.0.
test('OLS, Pearson correlation, R-squared and two-sided p match SciPy', () => {
  const result = regression([1, 2, 3, 4, 5, 6], [2, 4, 5, 4, 5, 7]);
  close(result.regression.slope, 0.7714285714285715);
  close(result.regression.intercept, 1.7999999999999998);
  close(result.regression.r, 0.8783100656536799);
  close(result.regression.r_squared, 0.7714285714285715);
  close(result.regression.p, 0.021311641128756713);
  assert.equal(result.anova, undefined);
});

test('negative regression keeps signed correlation and matches independent SciPy p', () => {
  const result = regression([1, 2, 3, 4, 5], [9, 7, 6, 2, 1]);
  close(result.regression.slope, -2.1);
  close(result.regression.intercept, 11.3);
  close(result.regression.r, -0.9791300486523294);
  close(result.regression.p, 0.0036078774097786843);
});

test('constant predictors, constant responses, perfect fits and two pairs have explicit unavailable inference', () => {
  const constantX = regression([3, 3, 3], [1, 2, 3]);
  assert.deepEqual(constantX.regression, {n: 3, slope: null, intercept: null, r: null, r_squared: null, p: null});
  assert.match(constantX.warnings.join(' '), /predictor is constant/);
  const constantY = regression([1, 2, 3], [4, 4, 4]);
  assert.equal(constantY.regression.slope, 0);
  assert.equal(constantY.regression.intercept, 4);
  assert.equal(constantY.regression.r, null);
  assert.equal(constantY.regression.r_squared, null);
  assert.equal(constantY.regression.p, null);
  const perfect = regression([1, 2, 3, 4], [2, 4, 6, 8]);
  close(perfect.regression.r, 1);
  assert.equal(perfect.regression.p, null);
  assert.match(perfect.warnings.join(' '), /residual variance is zero/);
  assert.equal(regression([1, 2], [3, 4]).regression.p, null);
  assert.throws(() => regression([1], [2]), /two complete numeric pairs/);
});

test('CSV rejects malformed quotes, duplicate/blank headings, and ragged rows', () => {
  for (const csv of ['', 'a,a\n1,2', 'a, a \n1,2', 'a,\n1,2', 'a,b\n1', 'a,b\n1,2,3', 'a,b\n"1,2', 'a,b\n1"2,3', 'a,b\n"1"x,2']) {
    assert.throws(() => parseResearchCsv(csv), error => error.code === 'invalid_csv', csv);
  }
});

test('CSV enforces exact data-row and column boundaries', () => {
  assert.equal(parseResearchCsv('v\n' + '1\n'.repeat(5000)).rows.length, 5000);
  assert.throws(() => parseResearchCsv('v\n' + '1\n'.repeat(5001)), /5000 data rows/);
  const header = Array.from({length: 50}, (_, index) => `h${index}`).join(',');
  assert.equal(parseResearchCsv(header + '\n' + Array(50).fill('0').join(',')).headers.length, 50);
  assert.throws(() => parseResearchCsv(header + ',extra'), /50 columns/);
});

test('CSV UTF-8 byte limits handle ASCII and multibyte text at the boundary', () => {
  const ascii = 'v\n' + 'x'.repeat(512 * 1024 - 2);
  assert.equal(parseResearchCsv(ascii).rows.length, 1);
  assert.throws(() => parseResearchCsv(ascii + 'x'), /512 KiB/);
  const arabic = 'v\n' + 'ا'.repeat((512 * 1024 - 2) / 2);
  assert.equal(parseResearchCsv(arabic).rows.length, 1);
  assert.throws(() => parseResearchCsv(arabic + 'ا'), /512 KiB/);
});

test('group/header limits are bounded, Unicode-aware, and never silently truncate labels', () => {
  assert.equal(parseResearchCsv('h'.repeat(120) + '\n1').headers[0].length, 120);
  assert.throws(() => parseResearchCsv('h'.repeat(121) + '\n1'), /120 characters/);
  const label = '🌾'.repeat(80);
  const grouped = analyzeResearchData({csv: `g,v\n${label},1`, valueColumn: 'v', groupColumn: 'g'});
  assert.equal(grouped.groups[0].label, label);
  assert.throws(() => analyzeResearchData({csv: `g,v\n${label}🌾,1`, valueColumn: 'v', groupColumn: 'g'}), /80 characters/);
  const csv = 'g,v\n' + Array.from({length: 21}, (_, index) => `g${index},${index}`).join('\n');
  assert.throws(() => analyzeResearchData({csv, valueColumn: 'v', groupColumn: 'g'}), /20 groups/);
  assert.equal(anova(Array.from({length: 20}, (_, index) => [index, index + 1])).groups.length, 20);
});

test('analysis validates method and column selections explicitly', () => {
  const options = {csv: 'x,y\n1,2\n2,3', valueColumn: 'y'};
  for (const change of [{method: 'rcbd'}, {valueColumn: 'missing'}, {valueColumn: null}, {groupColumn: 'missing'}, {method: 'regression'}, {method: 'regression', predictorColumn: 'y'}, {method: 'oneway', groupColumn: 'y'}]) {
    assert.throws(() => analyzeResearchData({...options, ...change}), error => error.code === 'invalid_analysis');
  }
  assert.throws(() => analyzeResearchData(null), /options must be an object/);
  assert.throws(() => parseResearchCsv(null), /text string/);
});

test('arithmetic overflow rejects analysis and returned JSON has only finite numbers or null', () => {
  assert.throws(() => analyzeResearchData({csv: 'v\n1e308\n-1e308', valueColumn: 'v'}), /overflow/);
  const results = [anova([[1, 2], [4, 9]]), regression([1, 2, 3], [9, 7, 3]), anova([[1, 1], [2, 2]])];
  for (const result of results) {
    finiteTree(result);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    assert.equal('rows' in result, false);
    assert.equal('csv' in result, false);
    assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength < 32 * 1024);
  }
});

test('subnormal variance is rejected rather than inventing zero F or regression inference', () => {
  const groups = Array.from({length: 20}, (_, index) => {
    const mean = index === 0 ? 2e-162 : index === 1 ? -2e-162 : 0;
    return [mean - 2e-162, mean + 2e-162];
  });
  assert.throws(() => anova(groups), /too small for reliable statistics/);
  assert.throws(() => regression([1e-160, 2e-160, 3e-160], [2e-160, 4e-160, 5e-160]), /too small for reliable statistics/);
  const rescaled = anova(groups.map(values => values.map(value => value * 1e162)));
  close(rescaled.anova.f, 0.10526315789473684);
});

test('median averaging retains identical subnormal measurements without overflow', () => {
  const smallest = analyzeResearchData({csv: 'v\n5e-324\n5e-324', valueColumn: 'v'});
  assert.equal(smallest.descriptive.mean, Number.MIN_VALUE);
  assert.equal(smallest.descriptive.median, Number.MIN_VALUE);
  assert.equal(smallest.descriptive.sd, 0);
  const largest = analyzeResearchData({csv: 'v\n1e308\n1e308', valueColumn: 'v'});
  assert.equal(largest.descriptive.median, 1e308);
});
