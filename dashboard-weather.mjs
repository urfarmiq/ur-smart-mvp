import {fetchWeather,fieldWeatherLocation,weatherCode} from './weather-core.mjs';

const metric=(value,unit)=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('ar-IQ',{maximumFractionDigits:1}).format(value)+' '+unit:'غير متاح';
const clock=value=>{const zoned=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)?value+'+03:00':value;const time=Date.parse(zoned);return Number.isFinite(time)?new Intl.DateTimeFormat('ar-IQ',{timeZone:'Asia/Baghdad',hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'}).format(time):'غير متاح';};

export function createDashboardWeather({client}){
 const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
 const section=node('section');section.id='dashboardWeather';section.className='card';
 const heading=node('h2','🌦️ طقس حقولك'),hint=node('p','اختر حقلًا لعرض الطقس قرب مركز حدوده المحفوظة. البيانات تقديرات جوية نموذجية وليست قراءة جهاز داخل الحقل.');hint.className='hint';
 const label=node('label','الحقل');label.htmlFor='dashboardWeatherField';
 const select=node('select');select.id='dashboardWeatherField';select.disabled=true;
 const refresh=node('button','عرض طقس الحقل');refresh.type='button';refresh.disabled=true;
 const status=node('p','سجّل الدخول واختر حقلًا لعرض طقسه.');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const output=node('div');output.className='weather-summary-grid';output.hidden=true;output.dataset.weatherSummary='';
 const link=node('a','عرض التوقعات بالساعات ولسبعة أيام ←');link.href='./weather.html';
 const source=node('p','المصدر: '),sourceLink=node('a','MET Norway'),licenseLink=node('a','CC BY 4.0');source.className='hint';sourceLink.href='https://www.met.no/';licenseLink.href='https://creativecommons.org/licenses/by/4.0/';for(const a of [sourceLink,licenseLink]){a.target='_blank';a.rel='noopener noreferrer';}source.append(sourceLink,' — ',licenseLink,'؛ عُدّلت للعرض بتوقيت بغداد.');
 section.append(heading,hint,label,select,refresh,status,output,link,source);
 let fields=[],generation=0,controller=null;
 function clear(){generation++;controller?.abort();controller=null;output.replaceChildren();output.hidden=true;refresh.disabled=!select.value;}
 function setFields(rows){
  const previous=select.value;clear();fields=Array.isArray(rows)?rows.filter(f=>f&&typeof f.id==='string'):[];
  select.replaceChildren(new Option(fields.length?'اختر حقلًا':'لا توجد حقول محفوظة',''));
  for(const field of fields)select.add(new Option(field.name||'حقل محفوظ',field.id));
  if(fields.some(f=>f.id===previous))select.value=previous;
  select.disabled=!fields.length;refresh.disabled=!select.value;
  link.href=select.value?'./weather.html?field='+encodeURIComponent(select.value):'./weather.html';
  status.textContent=fields.length?'اختر حقلًا لعرض طقسه.':'أضف حقلًا، أو افتح صفحة الطقس لاختيار مدينة مرجعية.';
 }
 async function load(){
  clear();const field=fields.find(f=>f.id===select.value);if(!field)return;
  const token=generation,isCurrent=()=>token===generation&&select.value===field.id;
  controller=new AbortController();const activeController=controller;refresh.disabled=true;status.textContent='جارٍ تحميل طقس '+(field.name||'الحقل')+'…';
  try{
   const {data,error}=await client.from('field_boundaries').select('geometry').eq('field_id',field.id).maybeSingle();
   if(!isCurrent())return;
   if(error)throw Error('تعذر قراءة حدود الحقل. أعد المحاولة.');
   if(!data?.geometry)throw Error('احفظ حدود هذا الحقل على الخريطة أولًا، أو اختر مدينة مرجعية من صفحة الطقس.');
   const location=fieldWeatherLocation(data.geometry),weather=await fetchWeather({...location,signal:activeController.signal});
   if(!isCurrent())return;
   const current=weather.current,rain=weather.rain_forecast,next=rain?.next_rain;
   const rainAmount=rain?.complete?metric(rain.precipitation_mm,'ملم'):rain?.covered_hours>0?metric(rain.known_precipitation_mm,'ملم')+' للفترات المتاحة':'غير متاح';
   const cards=[['الحرارة المتوقعة الآن',metric(current?.temperature_c,'°م')],['حالة الجو المتوقعة',weatherCode(current?.weather_code).label],['الرطوبة النسبية',metric(current?.humidity_percent,'%')],['الرياح',metric(current?.wind_kmh,'كم/س')],[rain?.complete?'هطول فترة التوقع القادمة':'هطول الفترات المتاحة',rainAmount],['أقرب فترة هطول في التوقعات',next?clock(next.start)+' إلى '+clock(next.end):'لم تحدد البيانات موعدًا']];
   for(const [title,value] of cards){const card=node('div'),small=node('span',title),strong=node('strong',value);card.append(small,strong);output.append(card);}
   output.hidden=false;
   status.textContent='قرب مركز حدود '+(field.name||'الحقل')+' — تحديث '+clock(weather.fetched_at)+' بتوقيت بغداد. المصدر: MET Norway؛ توقع نموذجي.'+(rain?.start&&rain?.end?' فترة الهطول: '+clock(rain.start)+' إلى '+clock(rain.end)+'. التغطية المتاحة '+metric(rain.covered_hours,'ساعة')+' من ٢٤.':'')+(current?.stale?' بيانات التوقع الحالي قديمة؛ راجع وقتها في صفحة الطقس.':'');
   link.href='./weather.html?field='+encodeURIComponent(field.id);
  }catch(error){if(!isCurrent())return;status.textContent=error?.message||'تعذر تحميل الطقس الآن. أعد المحاولة.';}
  finally{if(isCurrent())refresh.disabled=false;}
 }
 select.onchange=()=>{clear();link.href=select.value?'./weather.html?field='+encodeURIComponent(select.value):'./weather.html';status.textContent='اختر حقلًا لعرض طقسه.';if(select.value)void load();};
 refresh.onclick=load;section.setFields=setFields;section.clearWeather=clear;setFields([]);return section;
}
