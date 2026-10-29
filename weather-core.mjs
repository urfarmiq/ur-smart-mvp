// MET Norway model forecasts through the public weather adapter. No account credentials.
export const WEATHER_SOURCE='MET Norway';
export const WEATHER_SOURCE_URL='https://www.met.no/';
export const WEATHER_SOURCE_LICENSE='CC BY 4.0';
export const WEATHER_SOURCE_LICENSE_URL='https://creativecommons.org/licenses/by/4.0/';
export const WEATHER_TIMEZONE='Asia/Baghdad';
const HOUR=3600000,DAY=24*HOUR;
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&value.trim()&&Number.isFinite(Number(value))?Number(value):null;
const bounded=(value,min=-Infinity,max=Infinity)=>{const n=finite(value);return n!==null&&n>=min&&n<=max?n:null;};
const integer=value=>{const n=finite(value);return n!==null&&Number.isInteger(n)?n:null;};

export function validateCoordinates(latitude,longitude){
 const lat=bounded(latitude,-90,90),lon=bounded(longitude,-180,180);
 if(lat===null||lon===null)throw Error('إحداثيات موقع الطقس غير صالحة.');
 return {latitude:lat,longitude:lon};
}

export function fieldWeatherLocation(value){
 let geometry=value;
 if(typeof geometry==='string'){try{geometry=JSON.parse(geometry)}catch{throw Error('حدود الحقل المحفوظة غير صالحة.');}}
 if(geometry?.type==='Feature')geometry=geometry.geometry;
 const ring=geometry?.coordinates?.[0];
 if(geometry?.type!=='Polygon'||!Array.isArray(ring)||ring.length<4)throw Error('ارسم حدود الحقل واحفظها لعرض الطقس عند موقعه.');
 const points=ring.map(point=>{
  if(!Array.isArray(point)||point.length<2)throw Error('إحداثيات حدود الحقل غير صالحة.');
  const {latitude,longitude}=validateCoordinates(point[1],point[0]);return [longitude,latitude];
 });
 const first=points[0],last=points.at(-1);
 if(first[0]!==last[0]||first[1]!==last[1])throw Error('مضلع حدود الحقل غير مغلق.');
 const vertices=points.slice(0,-1);
 if(new Set(vertices.map(p=>p.join(','))).size<3)throw Error('حدود الحقل لا تحتوي نقاطًا كافية.');
 // Average corners locates a representative forecast grid near a farm-scale parcel.
 return validateCoordinates(vertices.reduce((s,p)=>s+p[1],0)/vertices.length,vertices.reduce((s,p)=>s+p[0],0)/vertices.length);
}

export function buildWeatherUrl({latitude,longitude}){
 const coordinates=validateCoordinates(latitude,longitude),url=new URL('https://ur-smart-satellite.alialbatekh111.workers.dev/weather');
 // The adapter fixes the units, Baghdad timezone and 24-hour / seven-day horizons.
 url.search=new URLSearchParams({lat:String(coordinates.latitude),lon:String(coordinates.longitude)}).toString();
 return url.toString();
}

const CODES={
 0:['سماء صافية','☀️'],1:['صحو غالبًا','🌤️'],2:['غائم جزئيًا','⛅'],3:['غائم','☁️'],45:['ضباب','🌫️'],48:['ضباب مع صقيع','🌫️'],
 51:['رذاذ خفيف','🌦️'],53:['رذاذ متوسط','🌦️'],55:['رذاذ كثيف','🌧️'],56:['رذاذ متجمد خفيف','🌨️'],57:['رذاذ متجمد كثيف','🌨️'],
 61:['مطر خفيف','🌦️'],63:['مطر متوسط','🌧️'],65:['مطر غزير','🌧️'],66:['مطر متجمد خفيف','🌨️'],67:['مطر متجمد غزير','🌨️'],
 71:['ثلج خفيف','🌨️'],73:['ثلج متوسط','🌨️'],75:['ثلج كثيف','❄️'],77:['حبيبات ثلج','❄️'],
 80:['زخات مطر خفيفة','🌦️'],81:['زخات مطر متوسطة','🌧️'],82:['زخات مطر غزيرة','🌧️'],85:['زخات ثلج خفيفة','🌨️'],86:['زخات ثلج كثيفة','❄️'],
 95:['عاصفة رعدية','⛈️'],96:['عاصفة رعدية مع برد خفيف','⛈️'],97:['عاصفة رعدية قوية','⛈️'],99:['عاصفة رعدية مع برد كثيف','⛈️'],
};
export function weatherCode(value){const code=integer(value),row=code===null?null:CODES[code];return row?{label:row[0],icon:row[1]}:{label:'حالة الطقس غير متاحة',icon:'🌡️'};}

function validDay(day){
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
 const date=new Date(day+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===day;
}
function timeInstant(time,offset){
 if(typeof time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(time)||!validDay(time.slice(0,10)))return null;
 const [,clock]=time.split('T'),[h,m,s=0]=clock.split(':').map(Number);if(h>23||m>59||s>59)return null;
 const result=Date.parse(time+'Z')-offset*1000;return Number.isFinite(result)?result:null;
}
function timezoneFor(value){try{if(typeof value!=='string'||!value)return WEATHER_TIMEZONE;new Intl.DateTimeFormat('ar-IQ',{timeZone:value});return value;}catch{throw Error('المنطقة الزمنية في استجابة الطقس غير صالحة.');}}
function checkUnits(data){
 const expected={current:{temperature_2m:'°C',apparent_temperature:'°C',relative_humidity_2m:'%',precipitation:'mm',wind_speed_10m:'km/h',wind_gusts_10m:'km/h'},hourly:{temperature_2m:'°C',relative_humidity_2m:'%',precipitation:'mm',precipitation_probability:'%',wind_speed_10m:'km/h',wind_gusts_10m:'km/h'},daily:{temperature_2m_max:'°C',temperature_2m_min:'°C',precipitation_sum:'mm',precipitation_probability_max:'%',wind_speed_10m_max:'km/h',wind_gusts_10m_max:'km/h',et0_fao_evapotranspiration:'mm'}};
 for(const [group,fields] of Object.entries(expected))for(const [key,unit] of Object.entries(fields)){
  const reported=data[group+'_units']?.[key];if(reported!==undefined&&reported!==unit)throw Error('وحدات استجابة الطقس لا تطابق الوحدات المطلوبة.');
 }
}
function alertsFor(current,daily){
 const rows=daily.slice(0,3),alerts=[];
 const add=(kind,title,text)=>alerts.push({kind,level:'تنبيه إرشادي',title,text});
 const cold=rows.find(x=>x.tmin_c!==null&&x.tmin_c<=2);
 if(cold)add('frost','احتمال برودة أو صقيع','توقع أدنى حرارة '+cold.tmin_c+'°م في '+cold.date+'. تحقق من النشرة المحلية وحساسية المحصول؛ حرارة سطح التربة قد تختلف عن حرارة الهواء.');
 const hot=rows.find(x=>x.tmax_c!==null&&x.tmax_c>=40);
 if((current&&!current.stale&&current.temperature_c!==null&&current.temperature_c>=40)||hot)add('heat','حرارة مرتفعة محتملة','راجع إجهاد النباتات ورطوبة منطقة الجذور ميدانيًا، وتجنب الأعمال المجهدة وقت الذروة. لا تحدد جرعة الري من الحرارة وحدها.');
 const windy=rows.some(x=>x.wind_max_kmh!==null&&x.wind_max_kmh>=35||x.wind_gusts_max_kmh!==null&&x.wind_gusts_max_kmh>=50);
 if(windy||(current&&!current.stale&&(current.wind_kmh!==null&&current.wind_kmh>=35||current.wind_gusts_kmh!==null&&current.wind_gusts_kmh>=50)))add('wind','رياح قوية محتملة','راجع سرعة الرياح الفعلية وتعليمات المنتج قبل الرش، وافحص تثبيت الأغطية والأدوات الخفيفة.');
 if(rows.some(x=>x.weather_code!==null&&x.weather_code>=95&&x.weather_code<=99)||(current&&!current.stale&&current.weather_code!==null&&current.weather_code>=95&&current.weather_code<=99))add('storm','احتمال عواصف رعدية','تابع تحذيرات الأرصاد الرسمية قبل العمل في المناطق المكشوفة. هذه ملاحظة من التوقع النموذجي وليست إنذارًا رسميًا.');
 const rain=rows.find(x=>x.precipitation_mm!==null&&x.precipitation_mm>=5&&x.rain_probability_percent!==null&&x.rain_probability_percent>=60);
 if(rain)add('rain','مطر محتمل','المطر المتوقع في '+rain.date+' قد يؤثر في العمل والرش. راجع التوقعات الأحدث وقس رطوبة الجذور قبل تعديل جدول الري.');
 return alerts;
}

export function normalizeWeather(data,{fetchedAt,now=new Date()}={}){
 if(!data||typeof data!=='object'||Array.isArray(data)||data.error)throw Error('لم تتوفر بيانات طقس صالحة لهذا الموقع.');
 checkUnits(data);
 const nowMs=new Date(now).getTime();if(!Number.isFinite(nowMs))throw Error('وقت فحص الطقس غير صالح.');
 const timezone=timezoneFor(data.timezone),offset=data.utc_offset_seconds==null?10800:integer(data.utc_offset_seconds);
 if(timezone!==WEATHER_TIMEZONE||offset!==10800)throw Error('منطقة استجابة الطقس لا تطابق توقيت بغداد المطلوب.');
 const fetched=new Date(fetchedAt??nowMs);if(!Number.isFinite(fetched.getTime()))throw Error('وقت تحديث الطقس غير صالح.');
 const localNow=new Date(nowMs+offset*1000),today=localNow.toISOString().slice(0,10),firstHour=Math.floor((nowMs+offset*1000)/HOUR)*HOUR-offset*1000,endDay=new Date(Date.parse(today+'T00:00:00Z')+7*DAY).toISOString().slice(0,10);
 let current=null;
 const raw=data.current,instant=timeInstant(raw?.time,offset);
 if(instant!==null){
  const age=(nowMs-instant)/60000,interval=bounded(raw.interval,1,86400);
  current={time:raw.time,temperature_c:bounded(raw.temperature_2m,-100,70),feels_like_c:bounded(raw.apparent_temperature,-150,100),humidity_percent:bounded(raw.relative_humidity_2m,0,100),precipitation_mm:bounded(raw.precipitation,0),wind_kmh:bounded(raw.wind_speed_10m,0),wind_gusts_kmh:bounded(raw.wind_gusts_10m,0),wind_direction_deg:bounded(raw.wind_direction_10m,0,360),weather_code:integer(raw.weather_code),is_day:[0,1].includes(integer(raw.is_day))?integer(raw.is_day):null,interval_seconds:interval,interval_minutes:interval===null?null:interval/60,age_minutes:Math.max(0,Math.round(age)),stale:age>(interval===null?90:interval/60+90)||age< -15};
  if(['temperature_c','humidity_percent','precipitation_mm','wind_kmh','weather_code'].every(key=>current[key]===null))current=null;
 }
 const arrayValue=(group,key,i)=>Array.isArray(group?.[key])?group[key][i]:undefined;
 const hourly=[],seenHours=new Set();
 (Array.isArray(data.hourly?.time)?data.hourly.time:[]).forEach((time,i)=>{
  const timestamp=timeInstant(time,offset);if(timestamp===null||timestamp<firstHour||timestamp>=firstHour+24*HOUR||seenHours.has(time))return;seenHours.add(time);
  const h=data.hourly;
  hourly.push({time,temperature_c:bounded(arrayValue(h,'temperature_2m',i),-100,70),humidity_percent:bounded(arrayValue(h,'relative_humidity_2m',i),0,100),precipitation_mm:bounded(arrayValue(h,'precipitation',i),0),rain_probability_percent:bounded(arrayValue(h,'precipitation_probability',i),0,100),wind_kmh:bounded(arrayValue(h,'wind_speed_10m',i),0),wind_gusts_kmh:bounded(arrayValue(h,'wind_gusts_10m',i),0),weather_code:integer(arrayValue(h,'weather_code',i))});
 });
 hourly.sort((a,b)=>a.time.localeCompare(b.time));
 const daily=[],seenDays=new Set();
 (Array.isArray(data.daily?.time)?data.daily.time:[]).forEach((date,i)=>{
  if(!validDay(date)||date<today||date>=endDay||seenDays.has(date))return;seenDays.add(date);const d=data.daily;
  const sunrise=arrayValue(d,'sunrise',i),sunset=arrayValue(d,'sunset',i);
  daily.push({date,weather_code:integer(arrayValue(d,'weather_code',i)),tmax_c:bounded(arrayValue(d,'temperature_2m_max',i),-100,70),tmin_c:bounded(arrayValue(d,'temperature_2m_min',i),-100,70),precipitation_mm:bounded(arrayValue(d,'precipitation_sum',i),0),rain_probability_percent:bounded(arrayValue(d,'precipitation_probability_max',i),0,100),wind_max_kmh:bounded(arrayValue(d,'wind_speed_10m_max',i),0),wind_gusts_max_kmh:bounded(arrayValue(d,'wind_gusts_10m_max',i),0),et0_mm:bounded(arrayValue(d,'et0_fao_evapotranspiration',i),0),sunrise:timeInstant(sunrise,offset)!==null?sunrise:null,sunset:timeInstant(sunset,offset)!==null?sunset:null});
 });
 daily.sort((a,b)=>a.date.localeCompare(b.date));
 const hasValues=(row,keys)=>keys.some(key=>row[key]!==null)||Object.hasOwn(CODES,row.weather_code);
 const usableCurrent=current&&hasValues(current,['temperature_c','feels_like_c','humidity_percent','precipitation_mm','wind_kmh','wind_gusts_kmh']);
 const usableHourly=hourly.some(row=>hasValues(row,['temperature_c','humidity_percent','precipitation_mm','rain_probability_percent','wind_kmh','wind_gusts_kmh']));
 const usableDaily=daily.some(row=>hasValues(row,['tmax_c','tmin_c','precipitation_mm','rain_probability_percent','wind_max_kmh','wind_gusts_max_kmh','et0_mm']));
 if(!usableCurrent&&!usableHourly&&!usableDaily)throw Error('لم تتوفر بيانات طقس مؤرخة لهذا الموقع الآن.');
 return {source:WEATHER_SOURCE,source_url:WEATHER_SOURCE_URL,source_license:WEATHER_SOURCE_LICENSE,source_license_url:WEATHER_SOURCE_LICENSE_URL,timezone,utc_offset_seconds:offset,fetched_at:fetched.toISOString(),modeled:true,note:'تقديرات نموذجية قرب الموقع من MET Norway بترخيص CC BY 4.0، وليست قياس محطة داخل الحقل. العظمى والصغرى من عينات التوقع المتاحة؛ تبقى فترات المطر غير المكتملة والبيانات غير المتاحة فارغة. راجع القياسات والنشرة الرسمية قبل القرار.',current,hourly,daily,alerts:alertsFor(current,daily)};
}

export async function fetchWeather({latitude,longitude,signal,fetchImpl=globalThis.fetch,timeoutMs=15000,now}={}){
 const url=buildWeatherUrl({latitude,longitude});
 if(typeof fetchImpl!=='function')throw Error('خدمة الاتصال بالطقس غير متاحة.');
 const controller=new AbortController();let timedOut=false;
 const cancel=()=>controller.abort();
 if(signal?.aborted){const error=Error('أُلغي طلب الطقس.');error.name='AbortError';throw error;}
 signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(()=>{timedOut=true;controller.abort()},Math.max(1,Math.min(60000,Number(timeoutMs)||15000)));
 try{
  const response=await fetchImpl(url,{method:'GET',cache:'no-store',credentials:'omit',signal:controller.signal});
  if(!response.ok)throw Error(response.status===429?'بلغت خدمة الطقس حد الطلبات. أعد المحاولة لاحقًا.':'تعذر جلب الطقس الآن (HTTP '+response.status+').');
  const payload=await response.json();if(controller.signal.aborted){const error=Error();error.name='AbortError';throw error;}
  const stamp=now??new Date();return normalizeWeather(payload,{now:stamp,fetchedAt:stamp});
 }catch(error){
  if(controller.signal.aborted||error?.name==='AbortError'){const aborted=Error(timedOut?'انتهت مهلة تحميل الطقس؛ أعد المحاولة.':'أُلغي طلب الطقس.');aborted.name='AbortError';throw aborted;}
  if(error instanceof SyntaxError)throw Error('استجابة خدمة الطقس غير صالحة؛ أعد المحاولة.');
  if(error instanceof TypeError)throw Error('تعذر الاتصال بخدمة الطقس؛ تحقق من الاتصال وأعد المحاولة.');
  throw error;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
