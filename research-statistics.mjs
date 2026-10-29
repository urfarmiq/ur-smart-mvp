/**
 * Bounded, deterministic statistics for uploaded research CSV files.
 * No row values are evaluated as code, spreadsheet formulae, or HTML. Numeric
 * inference is selected explicitly; experimental designs cannot be inferred
 * from column names. This module performs no I/O and has no dependencies.
 */
const MAX_BYTES = 512 * 1024;
const MAX_ROWS = 5000;
const MAX_COLUMNS = 50;
const MAX_GROUPS = 20;
const MAX_HEADER_LENGTH = 120;
const MAX_GROUP_LENGTH = 80;
const MIN_NORMAL = 2.2250738585072014e-308;
const METHODS = new Set(['descriptive', 'oneway', 'regression']);

function invalid(message, code = 'invalid_analysis') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function characterLength(value) {
  return Array.from(value).length;
}

function detectDelimiter(text) {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted) {
      if (char === '\n' || char === '\r') break;
      if (char === ',') commas += 1;
      if (char === ';') semicolons += 1;
    }
  }
  return semicolons > commas ? ';' : ',';
}

/**
 * Parse comma CSV, or semicolon CSV when the header has more semicolons.
 * Headers are trimmed, unique, nonempty and at most 120 Unicode characters.
 * Data cells retain their original text, including quoted newlines and spaces.
 * A trailing record terminator adds no row; other blank records count as rows.
 */
export function parseResearchCsv(text) {
  if (typeof text !== 'string') invalid('CSV must be a text string.', 'invalid_csv');
  // UTF-8 size, rather than JavaScript UTF-16 string length, is the upload limit.
  if (text.length > MAX_BYTES || new TextEncoder().encode(text).byteLength > MAX_BYTES) {
    invalid('CSV exceeds the 512 KiB UTF-8 limit.', 'invalid_csv');
  }
  const source = text.replace(/^\uFEFF/, '');
  if (!source.length) invalid('CSV is empty.', 'invalid_csv');
  const delimiter = detectDelimiter(source);
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  let fieldStarted = false;

  function finishField() {
    record.push(field);
    if (record.length > MAX_COLUMNS) invalid('CSV permits at most 50 columns.', 'invalid_csv');
    field = '';
    fieldStarted = false;
    closedQuote = false;
  }
  function finishRecord() {
    finishField();
    records.push(record);
    // The first record contains column headings.
    if (records.length > MAX_ROWS + 1) invalid('CSV permits at most 5000 data rows.', 'invalid_csv');
    record = [];
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else field += char;
      continue;
    }
    if (char === delimiter) finishField();
    else if (char === '\n' || char === '\r') {
      finishRecord();
      if (char === '\r' && source[index + 1] === '\n') index += 1;
    } else if (char === '"' && !fieldStarted && !closedQuote) {
      quoted = true;
      fieldStarted = true;
    } else {
      if (char === '"' || closedQuote) invalid('CSV contains an invalid quoted field.', 'invalid_csv');
      field += char;
      fieldStarted = true;
    }
  }
  if (quoted) invalid('CSV contains an unclosed quoted field.', 'invalid_csv');
  if (record.length || fieldStarted || closedQuote || field.length) finishRecord();
  if (!records.length) invalid('CSV must contain a header row.', 'invalid_csv');

  const headers = records[0].map(header => header.trim());
  if (headers.some(header => !header)) invalid('CSV column headings must be nonempty.', 'invalid_csv');
  if (headers.some(header => characterLength(header) > MAX_HEADER_LENGTH)) {
    invalid('CSV column headings permit at most 120 characters.', 'invalid_csv');
  }
  if (new Set(headers).size !== headers.length) invalid('CSV column headings must be unique.', 'invalid_csv');
  const rows = records.slice(1).map((row, index) => {
    if (row.length === 1 && !row[0].trim()) return Array(headers.length).fill('');
    if (row.length !== headers.length) {
      invalid(`CSV data row ${index + 1} has a different number of columns than the header.`, 'invalid_csv');
    }
    return row;
  });
  return {headers, rows, delimiter};
}

function finite(number) {
  if (!Number.isFinite(number)) invalid('Arithmetic overflow: the selected numbers exceed the supported numeric range.');
  return number;
}

function sum(values) {
  let total = 0;
  let correction = 0;
  for (const value of values) {
    const corrected = finite(value - correction);
    const next = finite(total + corrected);
    correction = finite((next - total) - corrected);
    total = next;
  }
  return total;
}

function square(value) {
  const result = finite(value * value);
  // Subnormal squared terms lose enough precision that subsequent mean-square
  // division can invent a zero F statistic. Reject instead of claiming p=1.
  if (value !== 0 && result < MIN_NORMAL) invalid('The selected numeric differences are too small for reliable statistics.');
  return result;
}

// Center before summing: unlike sum(x*x) - sum(x)^2/n this remains useful for
// measurements sharing a large offset. Compensated sums retain small terms.
function centered(values) {
  const n = values.length;
  const anchor = values[0];
  const offsets = values.map(value => finite(value - anchor));
  const shift = sum(offsets.map(value => value / n));
  const mean = finite(anchor + shift);
  const residuals = offsets.map(value => finite(value - shift));
  const ss = sum(residuals.map(square));
  return {n, anchor, shift, mean, residuals, ss};
}

function describe(values, stats = centered(values)) {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  // Same-sign differences cannot overflow; opposite-sign sums cannot overflow.
  // This also retains an identical pair of minimum-subnormal measurements.
  const median = sorted.length % 2 ? upper : finite(
    Math.sign(lower) === Math.sign(upper) ? lower + (upper - lower) / 2 : (lower + upper) / 2,
  );
  return {
    n: stats.n,
    mean: stats.mean,
    median,
    sd: stats.n > 1 ? finite(Math.sqrt(stats.ss) / Math.sqrt(stats.n - 1)) : null,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function numberCell(cell, delimiter, row, column) {
  let value = cell.trim();
  if (!value || /^(?:na|n\/a|null)$/i.test(value)) return null;
  // Semicolon exports commonly use decimal commas; comma CSV requires a dot.
  if (delimiter === ';' && !value.includes('.') && value.includes(',')) value = value.replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    invalid(`Row ${row}, column "${column}" must contain a finite decimal number or a missing value.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) invalid(`Row ${row}, column "${column}" contains numeric overflow or a nonfinite number.`);
  // Reject nonzero literals that underflow to zero, rather than inventing data.
  if (number === 0 && /[1-9]/.test(value.split(/[eE]/)[0])) {
    invalid(`Row ${row}, column "${column}" contains a number outside the supported precision.`);
  }
  return number;
}

// Lanczos log-gamma and the modified Lentz continued fraction implement the
// regularized incomplete beta. Degrees of freedom here give a,b >= 1/2.
function logGamma(z) {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  const shifted = z - 1;
  let series = 0.99999999999980993;
  for (let index = 0; index < coefficients.length; index += 1) series += coefficients[index] / (shifted + index + 1);
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(series);
}

function betaFraction(a, b, x) {
  const tiny = 1e-300;
  const epsilon = 3e-14;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let result = d;
  for (let iteration = 1; iteration <= 10000; iteration += 1) {
    const twice = 2 * iteration;
    let coefficient = iteration * (b - iteration) * x / ((qam + twice) * (a + twice));
    d = 1 + coefficient * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + coefficient / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    result *= d * c;
    coefficient = -(a + iteration) * (qab + iteration) * x / ((a + twice) * (qap + twice));
    d = 1 + coefficient * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + coefficient / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const change = d * c;
    result *= change;
    if (Math.abs(change - 1) < epsilon) return finite(result);
  }
  invalid('The probability calculation did not converge for these data.');
}

function regularizedBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  const probability = x < (a + 1) / (a + b + 2)
    ? front * betaFraction(a, b, x) / a
    : 1 - front * betaFraction(b, a, 1 - x) / b;
  return Math.max(0, Math.min(1, finite(probability)));
}

function fSurvival(f, dfBetween, dfWithin) {
  // Equivalent to dfWithin/(dfWithin + dfBetween*f), without overflow in
  // the denominator for a large but finite F statistic.
  const ratio = f > 1 ? (dfWithin / dfBetween) / f : null;
  const x = f > 1 ? ratio / (1 + ratio) : 1 / (1 + (dfBetween / dfWithin) * f);
  return regularizedBeta(x, dfWithin / 2, dfBetween / 2);
}

function oneWay(groups, stats, warnings) {
  if (groups.length < 2) invalid('One-way ANOVA requires at least two independent groups.');
  if (groups.some(group => group.stats.n < 2)) invalid('One-way ANOVA requires at least two numeric observations in every group.');
  const dfBetween = groups.length - 1;
  const dfWithin = stats.n - groups.length;
  const ssWithin = sum(groups.map(group => group.stats.ss));
  const ssBetween = sum(groups.map(group => {
    // Compute a group mean relative to the grand anchor, preserving offsets.
    const shift = sum(group.values.map(value => finite(value - stats.anchor) / group.values.length));
    return finite(group.values.length * square(finite(shift - stats.shift)));
  }));
  let f = null;
  let p = null;
  if (ssWithin === 0) {
    warnings.push('Within-group variance is zero; the ANOVA F statistic and p-value are unavailable. No significance decision can be made.');
  } else {
    f = finite((ssBetween / dfBetween) / (ssWithin / dfWithin));
    p = fSurvival(f, dfBetween, dfWithin);
  }
  return {
    df_between: dfBetween,
    df_within: dfWithin,
    ss_between: ssBetween,
    ss_within: ssWithin,
    f,
    p,
    assumptions: [
      'Observations and groups must be independent; independence is not verified from a CSV.',
      'Within-group residuals should be approximately normal.',
      'Group population variances should be similar; equal variance is not tested here.',
      'This is an independent one-way analysis. Randomized blocks, repeated measures, and factorial designs are not supported.',
    ],
  };
}

function regress(xs, yStats, warnings) {
  const n = xs.length;
  if (n < 2) invalid('Regression requires at least two complete numeric pairs.');
  const xStats = centered(xs);
  const unavailable = {n, slope: null, intercept: null, r: null, r_squared: null, p: null};
  if (xStats.ss === 0) {
    warnings.push('The predictor is constant; regression coefficients, correlation, and p-value are unavailable.');
    return unavailable;
  }
  const covariance = sum(xStats.residuals.map((value, index) => finite(value * yStats.residuals[index])));
  const slope = finite(covariance / xStats.ss);
  const intercept = sum([yStats.anchor, finite(-slope * xStats.anchor), yStats.shift, finite(-slope * xStats.shift)]);
  if (yStats.ss === 0) {
    warnings.push('The response is constant; correlation, R-squared, and the regression p-value are unavailable.');
    return {...unavailable, slope, intercept};
  }
  const r = Math.max(-1, Math.min(1, finite((covariance / Math.sqrt(xStats.ss)) / Math.sqrt(yStats.ss))));
  const rSquared = r * r;
  const residualSS = sum(yStats.residuals.map((value, index) => square(finite(value - slope * xStats.residuals[index]))));
  let p = null;
  if (n < 3) warnings.push('At least three complete pairs are required for a regression p-value.');
  else if (residualSS === 0) warnings.push('Regression residual variance is zero; its inferential p-value is unavailable.');
  else {
    const f = finite(finite(slope * covariance) / (residualSS / (n - 2)));
    p = fSurvival(f, 1, n - 2);
  }
  warnings.push('Regression assumes independent observations and a linear relationship; its p-value also assumes approximately normal errors with constant variance. These assumptions are not tested.');
  return {n, slope, intercept, r, r_squared: rSquared, p};
}

/**
 * Run deterministic descriptive statistics, independent one-way ANOVA, or OLS.
 * Missing selected numeric cells (blank, NA, N/A, null) exclude their row;
 * malformed or nonfinite numbers are errors, never converted to zero.
 * Optional grouping is limited to 20 labels of at most 80 Unicode characters.
 * Returned JSON contains aggregates only. Callers must treat labels as text.
 */
export function analyzeResearchData(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalid('Analysis options must be an object.');
  const {csv, valueColumn, groupColumn, predictorColumn, method = 'descriptive'} = options;
  if (!METHODS.has(method)) invalid('Choose descriptive, oneway, or regression analysis.');
  const parsed = parseResearchCsv(csv);
  function columnIndex(name, label, required = false) {
    if (name == null || name === '') {
      if (required) invalid(`Select a ${label} column.`);
      return -1;
    }
    if (typeof name !== 'string' || !parsed.headers.includes(name)) invalid(`The selected ${label} column does not exist in this CSV.`);
    return parsed.headers.indexOf(name);
  }
  const valueIndex = columnIndex(valueColumn, 'response', true);
  const groupIndex = columnIndex(groupColumn, 'group', method === 'oneway');
  const predictorIndex = columnIndex(predictorColumn, 'predictor', method === 'regression');
  if (method === 'oneway' && valueIndex === groupIndex) invalid('The response and group columns must be different.');
  if (method === 'regression' && valueIndex === predictorIndex) invalid('The response and predictor columns must be different.');
  const values = [];
  const predictors = [];
  const grouped = new Map();
  const warnings = [];
  for (let index = 0; index < parsed.rows.length; index += 1) {
    const row = parsed.rows[index];
    const value = numberCell(row[valueIndex], parsed.delimiter, index + 1, valueColumn);
    const predictor = method === 'regression'
      ? numberCell(row[predictorIndex], parsed.delimiter, index + 1, predictorColumn)
      : null;
    const label = groupIndex >= 0 ? row[groupIndex] : null;
    if (label !== null && characterLength(label) > MAX_GROUP_LENGTH) invalid('Group labels permit at most 80 characters.');
    if (value === null || (method === 'regression' && predictor === null) || (label !== null && !label.trim())) continue;
    if (label !== null) {
      if (!grouped.has(label)) {
        if (grouped.size >= MAX_GROUPS) invalid('Grouped analysis permits at most 20 groups.');
        grouped.set(label, []);
      }
      grouped.get(label).push(value);
    }
    values.push(value);
    if (method === 'regression') predictors.push(predictor);
  }
  if (!values.length) invalid('No complete numeric observations remain after excluding missing values.');
  const stats = centered(values);
  const groups = Array.from(grouped, ([label, groupValues]) => ({label, values: groupValues, stats: centered(groupValues)}));
  const result = {
    schema_version: 1,
    method,
    rows_total: parsed.rows.length,
    rows_used: values.length,
    rows_excluded: parsed.rows.length - values.length,
    columns: {value: valueColumn, group: groupIndex >= 0 ? groupColumn : null, predictor: method === 'regression' ? predictorColumn : null},
    descriptive: describe(values, stats),
    groups: groups.map(group => ({label: group.label, n: group.stats.n, mean: group.stats.mean, sd: group.stats.n > 1 ? finite(Math.sqrt(group.stats.ss) / Math.sqrt(group.stats.n - 1)) : null})),
    warnings,
  };
  if (result.rows_excluded) warnings.push(`${result.rows_excluded} row(s) were excluded because selected numeric values or group labels were missing; missing values were not replaced with zero.`);
  if (values.length < 2) warnings.push('Sample standard deviation requires at least two observations and is unavailable.');
  if (method === 'oneway') result.anova = oneWay(groups, stats, warnings);
  if (method === 'regression') result.regression = regress(predictors, stats, warnings);
  return result;
}
