// Planning arithmetic only: no market prices, agronomic assumptions, storage or APIs.
const MAX_INPUT = 1e9;
const MAX_AREA = 1e6;
const MAX_RESULT = 1000000000000000n;

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_BUDGET';
  throw error;
}

function numeric(value, name, max = MAX_INPUT, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (positive && value === 0)) {
    invalid('تحقق من ' + name + '؛ يجب أن تكون قيمة رقمية ' + (positive ? 'موجبة' : 'غير سالبة') + ' ضمن الحد المسموح.');
  }
  return value === 0 ? 0 : value;
}

function optional(value, name) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null;
  return numeric(value, name);
}

// Exact decimal ratios prevent binary floating-point errors at half-IQD line
// totals (e.g.0.1 × 0.7 × 50 must round from3.5 to4, not from3.499999... to3).
function decimal(value) {
  const [coefficient, exponent = '0'] = String(value).toLowerCase().split('e');
  const [integer, fraction = ''] = coefficient.split('.');
  const scale = fraction.length - Number(exponent);
  const numerator = BigInt(integer + fraction);
  return scale >= 0
    ? {n: numerator, d: 10n ** BigInt(scale)}
    : {n: numerator * 10n ** BigInt(-scale), d: 1n};
}

function multiply(a, b) { return {n: a.n * b.n, d: a.d * b.d}; }
function divide(a, b) { return {n: a.n * b.d, d: a.d * b.n}; }
function bounded(ratio) {
  if (ratio.d <= 0n || (ratio.n < 0n ? -ratio.n : ratio.n) > MAX_RESULT * ratio.d) {
    invalid('نتيجة الحساب تتجاوز الحد المدعوم؛ راجع المساحة والكميات والأسعار والوحدات.');
  }
  return ratio;
}

function roundRatio(ratio, places = 0) {
  bounded(ratio);
  const scale = 10n ** BigInt(places);
  const negative = ratio.n < 0n;
  const numerator = (negative ? -ratio.n : ratio.n) * scale;
  const rounded = numerator / ratio.d + (numerator % ratio.d * 2n >= ratio.d ? 1n : 0n);
  return Number(negative ? -rounded : rounded) / Number(scale);
}

/**
 * Costs and currency totals round to1IQD, each line before aggregation.
 * Production and per-unit break-even thresholds round to3decimals; these are
 * approximate display values. Revenue and thresholds use unrounded production.
 * Missing optional inputs are null; explicit zeros remain actual zero inputs.
 * Numeric strings are rejected, except blank optional fields meaning unknown.
 */
export function calculateSeasonBudget(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('أدخل بيانات ميزانية الموسم.');
  const area = numeric(input.areaDonum, 'المساحة بالدونم العراقي', MAX_AREA, true);
  if (!Array.isArray(input.costs) || input.costs.length < 1 || input.costs.length > 50) {
    invalid('أدخل بند تكلفة واحدًا على الأقل وبحد أقصى خمسين بندًا.');
  }
  const yieldPerDonum = optional(input.yieldKgPerDonum, 'الإنتاجية بالكيلوغرام لكل دونم');
  const salePrice = optional(input.salePriceIqdPerKg, 'سعر بيع الكيلوغرام بالدينار');
  const areaRatio = decimal(area);
  let total = 0n;
  let roundedPositiveToZero = false;
  const costs = input.costs.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) invalid('أدخل بيانات صحيحة لكل بند تكلفة.');
    if (typeof row.label !== 'string' || !row.label.trim() || row.label.trim().length > 80) {
      invalid('اكتب اسمًا لكل بند تكلفة من حرف إلى ثمانين حرفًا.');
    }
    if (row.basis !== 'total' && row.basis !== 'per_donum') invalid('اختر أساس التكلفة: للموسم كله أو لكل دونم.');
    const quantity = numeric(row.quantity, 'كمية بند التكلفة');
    const unitCost = numeric(row.unitCostIqd, 'سعر الوحدة بالدينار');
    let line = multiply(decimal(quantity), decimal(unitCost));
    if (row.basis === 'per_donum') line = multiply(line, areaRatio);
    const lineTotal = roundRatio(line);
    if (line.n > 0n && lineTotal === 0) roundedPositiveToZero = true;
    total += BigInt(lineTotal);
    bounded({n: total, d: 1n});
    return {label: row.label.trim(), quantity, unit_cost_iqd: unitCost, basis: row.basis, total_iqd: lineTotal};
  });

  const costRatio = {n: total, d: 1n};
  const production = yieldPerDonum === null ? null : bounded(multiply(areaRatio, decimal(yieldPerDonum)));
  const revenue = production === null || salePrice === null ? null : roundRatio(multiply(production, decimal(salePrice)));
  const perDonum = roundRatio(divide(costRatio, areaRatio));
  const shownProduction = production === null ? null : roundRatio(production, 3);
  const priceThreshold = production !== null && production.n > 0n ? roundRatio(divide(costRatio, production), 3) : null;
  const yieldThreshold = salePrice !== null && salePrice > 0 ? roundRatio(divide(costRatio, multiply(areaRatio, decimal(salePrice))), 3) : null;
  const warnings = [
    'الهامش المحسوب هو الإيراد المتوقع ناقص التكاليف المدخلة فقط؛ تأكد من إدخال جميع مصروفات الموسم.',
    'الإنتاج وسعر البيع افتراضات للتخطيط، والنتائج ليست ضمانًا للربح أو دراسة جدوى معتمدة. مؤشرات التعادل مقربة إلى ثلاث منازل عشرية.'
  ];
  if (yieldPerDonum === null) warnings.push('الإنتاجية غير مدخلة؛ الإنتاج والإيراد والهامش المتوقع غير متاحين.');
  else if (yieldPerDonum === 0) warnings.push('الإنتاجية المدخلة صفر؛ لا يمكن حساب سعر التعادل لكل كيلوغرام.');
  if (salePrice === null) warnings.push('سعر البيع غير مدخل؛ الإيراد والهامش وإنتاجية التعادل غير متاحة.');
  else if (salePrice === 0) warnings.push('سعر البيع المدخل صفر؛ لا يمكن حساب إنتاجية التعادل.');
  if (roundedPositiveToZero || (total > 0n && perDonum === 0) || (production !== null && production.n > 0n && shownProduction === 0) || (total > 0n && (priceThreshold === 0 || yieldThreshold === 0))) {
    warnings.push('ظهرت قيمة موجبة صغيرة بصفر بسبب التقريب؛ لا يعني ذلك غياب التكلفة أو الإنتاج. راجع الوحدات والقيم قبل اعتمادها.');
  }

  return {
    area_donum: area,
    costs,
    total_cost_iqd: Number(total),
    cost_per_donum_iqd: perDonum,
    expected_production_kg: shownProduction,
    expected_revenue_iqd: revenue,
    expected_margin_iqd: revenue === null ? null : Number(BigInt(revenue) - total),
    break_even_price_iqd_per_kg: priceThreshold,
    break_even_yield_kg_per_donum: yieldThreshold,
    warnings
  };
}
