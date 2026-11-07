// Recurring planting references only. These functions do not infer weather,
// water availability, field suitability or regional shifts in planting dates.
export const MONTHS=Object.freeze([
 'كانون الثاني','شباط','آذار','نيسان','أيار','حزيران',
 'تموز','آب','أيلول','تشرين الأول','تشرين الثاني','كانون الأول'
].map((label,index)=>Object.freeze({value:index+1,label})));

export const PROVINCES=Object.freeze([
 ['all','كل العراق',null],
 ['baghdad','بغداد','center'],['basra','البصرة','south'],
 ['nineveh','نينوى','north'],['erbil','أربيل','north'],
 ['najaf','النجف','center'],['karbala','كربلاء','center'],
 ['kirkuk','كركوك','north'],['anbar','الأنبار','center'],
 ['diyala','ديالى','center'],['salah_al_din','صلاح الدين','center'],
 ['dhi_qar','ذي قار','south'],['maysan','ميسان','south'],
 ['wasit','واسط','center'],['babil','بابل','center'],
 ['qadisiyyah','القادسية','south'],['muthanna','المثنى','south'],
 ['sulaymaniyah','السليمانية','north'],['duhok','دهوك','north'],
 ['halabja','حلبجة','north']
].map(([code,name,zone])=>Object.freeze({code,name,zone})));

const categories=new Set(['field','vegetable','herb']);
const seasons=new Set(['winter','spring','summer','autumn']);
const methods=new Set(['open','protected','nursery','unspecified']);
const operations=new Set(['sow','transplant','nursery_sow','plant']);
const zones=new Set(['all','north','center','south']);
const idPattern=/^[a-z0-9][a-z0-9_-]{0,99}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const string=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const unique=array=>new Set(array).size===array.length;

function invalidData(message){return Object.assign(new Error(message),{code:'INVALID_CALENDAR_DATA'});}
function invalidFilter(message){return Object.assign(new RangeError(message),{code:'INVALID_CALENDAR_FILTER'});}
function isMonth(value){return Number.isInteger(value)&&value>=1&&value<=12;}
export function provinceLookup(code){return PROVINCES.find(province=>province.code===code)||null;}
export function formatMonth(month){if(!isMonth(month))throw invalidFilter('اختر شهرًا من ١ إلى ١٢.');return MONTHS[month-1].label;}

export function getIraqMonth(value=new Date()){
 if(!(value instanceof Date)&&typeof value!=='number'&&typeof value!=='string')throw Object.assign(new RangeError('تاريخ الشهر غير صالح.'),{code:'INVALID_CALENDAR_DATE'});
 const date=value instanceof Date?new Date(value.getTime()):new Date(value);
 if(!Number.isFinite(date.getTime()))throw Object.assign(new RangeError('تاريخ الشهر غير صالح.'),{code:'INVALID_CALENDAR_DATE'});
 const month=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Baghdad',month:'numeric'}).format(date));
 if(!isMonth(month))throw Object.assign(new RangeError('تعذر تحديد الشهر بتوقيت بغداد.'),{code:'INVALID_CALENDAR_DATE'});
 return month;
}

export function normalizeArabicQuery(value){
 if(typeof value!=='string')throw invalidFilter('اكتب اسم المحصول كنص.');
 return value.normalize('NFKC').toLowerCase()
  .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g,'')
  .replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه')
  .replace(/\s+/g,' ').trim();
}

function sourceUrlIsSafe(value){
 if(!string(value,3000)||/[\s\u0000-\u001f\u007f\\]/.test(value))return false;
 try{
  const url=new URL(value),host=url.hostname;
  return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')
   &&/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i.test(host)
   &&!/(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(host);
 }catch{return false;}
}

function validateWindows(windows){
 if(!Array.isArray(windows)||windows.length>1500)throw invalidData('بيانات التقويم غير صالحة.');
 const ids=new Set(),crops=new Map();
 for(const row of windows){
  if(!plain(row)||!idPattern.test(row.id||'')||ids.has(row.id)||!idPattern.test(row.cropId||'')||!string(row.cropName,120)
   ||!categories.has(row.category)||!seasons.has(row.season)||!methods.has(row.method)||!operations.has(row.operation)
   ||!Array.isArray(row.aliases)||row.aliases.length>30||row.aliases.some(value=>!string(value,120))
   ||!Array.isArray(row.months)||!row.months.length||row.months.length>12||row.months.some(value=>!isMonth(value))||!unique(row.months)
   ||!Array.isArray(row.zones)||row.zones.length>3||row.zones.some(value=>!zones.has(value))||!unique(row.zones)
   ||row.zones.includes('all')&&row.zones.length!==1
   ||!string(row.periodLabel,500)||!Array.isArray(row.notes)||row.notes.length>20||row.notes.some(value=>!string(value,1800))
   ||!Array.isArray(row.sourceIds)||!row.sourceIds.length||row.sourceIds.length>12||row.sourceIds.some(value=>!idPattern.test(value||''))||!unique(row.sourceIds))throw invalidData('سجل موعد زراعة غير مكتمل أو مكرر.');
  if(row.provinceCodes!==undefined&&(!Array.isArray(row.provinceCodes)||row.provinceCodes.some(code=>code==='all'||!provinceLookup(code))||!unique(row.provinceCodes)))throw invalidData('نطاق محافظة غير صالح في موعد الزراعة.');
  if(row.zones.includes('all')&&row.provinceCodes?.length)throw invalidData('لا يمكن أن يكون الموعد قطريًا ومخصصًا لمحافظة في الوقت نفسه.');
  const crop=crops.get(row.cropId);
  if(crop&&(crop.name!==row.cropName||crop.category!==row.category))throw invalidData('اسم المحصول أو فئته غير متسق بين المواعيد.');
  crops.set(row.cropId,{name:row.cropName,category:row.category});ids.add(row.id);
 }
 return windows;
}

export function validateCalendarData(windows,sources){
 validateWindows(windows);
 if(!windows.length||!Array.isArray(sources)||!sources.length||sources.length>150)throw invalidData('التقويم يحتاج مواعيد ومراجع موثقة.');
 const ids=new Set();
 for(const source of sources){
  if(!plain(source)||!idPattern.test(source.id||'')||ids.has(source.id)||!string(source.title,600)||!sourceUrlIsSafe(source.url))throw invalidData('مرجع التقويم غير صالح أو مكرر.');
  ids.add(source.id);
 }
 if(windows.some(row=>row.sourceIds.some(id=>!ids.has(id))))throw invalidData('يوجد موعد بلا مرجع معروف.');
 return true;
}

function filtersFor(windows,filters={},monthRequired=true){
 const keys=['month','province','category','method','season','query','cropId'];
 if(!plain(filters)||Object.keys(filters).some(key=>!keys.includes(key)))throw invalidFilter('مرشحات التقويم غير صالحة.');
 const result={month:filters.month,province:filters.province===undefined?'all':filters.province,category:filters.category===undefined?'all':filters.category,method:filters.method===undefined?'all':filters.method,season:filters.season===undefined?'all':filters.season,query:filters.query===undefined?'':filters.query,cropId:filters.cropId===undefined?'all':filters.cropId};
 if(monthRequired&&!isMonth(result.month)||!provinceLookup(result.province)
  ||result.category!=='all'&&!categories.has(result.category)||result.method!=='all'&&!methods.has(result.method)
  ||result.season!=='all'&&!seasons.has(result.season)||typeof result.query!=='string'||result.query.length>300
  ||typeof result.cropId!=='string'||result.cropId!=='all'&&!windows.some(row=>row.cropId===result.cropId))throw invalidFilter('اختر شهرًا ومحافظة ومرشحات معروفة.');
 result.query=normalizeArabicQuery(result.query);
 return result;
}

function matching(windows,filters){
 const province=provinceLookup(filters.province);
 return windows.flatMap(row=>{
  if(!row.months.includes(filters.month)||filters.category!=='all'&&row.category!==filters.category
   ||filters.method!=='all'&&row.method!==filters.method||filters.season!=='all'&&row.season!==filters.season
   ||filters.cropId!=='all'&&row.cropId!==filters.cropId)return [];
  if(filters.query&&!normalizeArabicQuery([row.cropName,...row.aliases].join(' ')).includes(filters.query))return [];
  if(province.code!=='all'){
   if(row.provinceCodes?.length&&!row.provinceCodes.includes(province.code))return [];
   if(row.zones.length&&!row.zones.includes('all')&&!row.zones.includes(province.zone))return [];
  }
  const applicability=row.provinceCodes?.length?'regional':row.zones.includes('all')?'national':row.zones.length?'regional':'general_reference';
  return [{...row,aliases:[...row.aliases],months:[...row.months],zones:[...row.zones],notes:[...row.notes],sourceIds:[...row.sourceIds],
   ...(row.provinceCodes?{provinceCodes:[...row.provinceCodes]}:{}),applicability}];
 });
}

export function getPlantingMatches(windows,filters){
 validateWindows(windows);
 return matching(windows,filtersFor(windows,filters));
}

export function groupByCrop(matches){
 if(!Array.isArray(matches))throw invalidData('نتائج التقويم غير صالحة.');
 validateWindows(matches);
 const grouped=new Map();
 for(const row of matches){
  if(!grouped.has(row.cropId))grouped.set(row.cropId,{cropId:row.cropId,cropName:row.cropName,aliases:[],category:row.category,windows:[]});
  const crop=grouped.get(row.cropId);crop.windows.push(row);
  crop.aliases=[...new Set([...crop.aliases,...row.aliases])];
 }
 return [...grouped.values()];
}

export function getYearAvailability(windows,filters={}){
 validateWindows(windows);
 const checked=filtersFor(windows,filters,false);
 return MONTHS.map(({value:month,label})=>{
  const rows=matching(windows,{...checked,month});
  return {month,label,count:new Set(rows.map(row=>row.cropId)).size,windowCount:rows.length};
 });
}
