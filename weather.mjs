import {fieldWeatherLocation,fetchWeather,weatherCode} from './weather-core.mjs';

const $=id=>document.getElementById(id);
const cities=[['baghdad','بغداد',33.3152,44.3661],['basra','البصرة',30.5085,47.7804],['mosul','الموصل',36.3350,43.1189],['erbil','أربيل',36.1911,44.0092],['sulaymaniyah','السليمانية',35.5558,45.4351],['duhok','دهوك',36.8671,42.9884],['kirkuk','كركوك',35.4681,44.3922],['tikrit','تكريت',34.6071,43.6782],['baqubah','بعقوبة',33.7500,44.6333],['ramadi','الرمادي',33.4258,43.2999],['hillah','الحلة',32.4725,44.4292],['karbala','كربلاء',32.6160,44.0249],['najaf','النجف',32.0000,44.3300],['kut','الكوت',32.5128,45.8182],['diwaniyah','الديوانية',31.9905,44.9306],['samawah','السماوة',31.3319,45.2944],['nasiriyah','الناصرية',31.0431,46.2573],['amarah','العمارة',31.8359,47.1440],['halabja','حلبجة',35.1778,45.9861]];
for(const [id,name] of cities)$('weatherCity').add(new Option(name,id));
let client=null,user=null,fields=[],generation=0,controller=null;
const initialParams=new URLSearchParams(location.search),hasInitialField=initialParams.has('field'),initialField=initialParams.get('field');
const number=value=>typeof value==='number'&&Number.isFinite(value);
const fmt=(value,unit='',digits=1)=>number(value)?value.toLocaleString('ar-IQ',{maximumFractionDigits:digits})+(unit?' '+unit:''):'—';
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=text;if(className)node.className=className;return node;};
const setStatus=(message,error=false)=>{$('weatherStatus').textContent=message;$('weatherStatus').className='status'+(error?' error':'');};
function localDay(){return new Date(Date.now()+3*3600000).toISOString().slice(0,10);}
function dateText(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(value))return 'تاريخ غير متاح';const d=new Date(value.slice(0,10)+'T12:00:00Z');return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ar-IQ',{weekday:'long',day:'numeric',month:'short',timeZone:'UTC'}).format(d):'تاريخ غير متاح';}
function timeText(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)?value.slice(11,16):'—';}
function fetchedText(value){const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ar-IQ',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Baghdad'}).format(d):'غير متاح';}
function compass(value){if(!number(value))return '—';return ['شمال','شمال شرقي','شرق','جنوب شرقي','جنوب','جنوب غربي','غرب','شمال غربي'][Math.round((((value%360)+360)%360)/45)%8];}
function metric(label,value){const box=el('div',undefined,'metric');box.append(el('span',label),el('strong',value));return box;}
function detail(dl,label,value){const row=el('div');row.append(el('dt',label),el('dd',value));dl.append(row);}
function durationText(seconds){const hours=seconds/3600;if(hours===1)return 'ساعة واحدة';if(hours===2)return 'ساعتين';return fmt(hours,Number.isInteger(hours)&&hours>=3&&hours<=10?'ساعات':'ساعة',2);}
function periodTime(parent,value){const time=el('time',dateText(value)+'، '+timeText(value));time.dateTime=value;parent.append(time);}
function periodRange(parent,start,end){periodTime(parent,start);parent.append(' إلى ');periodTime(parent,end);}
function weatherSymbol(value,isDay=null){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 64 64');svg.setAttribute('class','weather-symbol');svg.setAttribute('aria-hidden','true');
 const shape=(tag,attrs)=>{const node=document.createElementNS(ns,tag);for(const [name,value] of Object.entries(attrs))node.setAttribute(name,String(value));svg.append(node);return node;};
 const stroke={fill:'none',stroke:'#91b6cb','stroke-width':2.5,'stroke-linecap':'round','stroke-linejoin':'round'};
 const sun=(cx,cy,r)=>{shape('circle',{cx,cy,r,fill:'#ffd36b'});for(let a=0;a<8;a++){const t=a*Math.PI/4;shape('line',{x1:cx+Math.cos(t)*(r+4),y1:cy+Math.sin(t)*(r+4),x2:cx+Math.cos(t)*(r+8),y2:cy+Math.sin(t)*(r+8),stroke:'#efbf53','stroke-width':2.4,'stroke-linecap':'round'});}};
 const moon=()=>shape('path',{d:'M40 10a20 20 0 1 0 13 32A22 22 0 0 1 40 10Z',fill:'#e4edf8',stroke:'#a3c5dd','stroke-width':1.5});
 const cloud=()=>shape('path',{d:'M17 43a10 10 0 0 1-1-20 15 15 0 0 1 28-3 12 12 0 1 1 4 23Z',fill:'#e9f2f7',stroke:'#9bbdd0','stroke-width':2});
 const code=number(value)?value:null;
 if(code===0){if(isDay===0)moon();else sun(32,31,14);return svg;}
 if(code===1||code===2){if(isDay===0)shape('path',{d:'M29 6a15 15 0 1 0 9 24A16 16 0 0 1 29 6Z',fill:'#d3e6f4'});else sun(24,22,10);cloud();return svg;}
 if(code===3){cloud();return svg;}
 if(code===45||code===48){cloud();for(const y of [48,55])shape('path',{d:`M14 ${y}h36`,...stroke});return svg;}
 const rain=[51,53,55,56,57,61,63,65,66,67,80,81,82],snow=[71,73,75,77,85,86],storm=[95,96,97,99];
 if(rain.includes(code)||snow.includes(code)||storm.includes(code)){cloud();if(storm.includes(code))shape('path',{d:'m33 36-9 15h9l-4 10 16-19H34l5-6Z',fill:'#f3c55b'});else if(snow.includes(code)){for(const x of [20,33,46]){shape('path',{d:`M${x} 48v11m-4-8 8 5m-8 0 8-5`,fill:'none',stroke:'#77b3d6','stroke-width':1.8,'stroke-linecap':'round'});}}else for(const x of [20,33,46])shape('path',{d:`m${x} 48-3 8`,fill:'none',stroke:'#52a2d2','stroke-width':3,'stroke-linecap':'round'});return svg;}
 shape('circle',{cx:32,cy:31,r:21,fill:'#edf3f7',stroke:'#aec1ce','stroke-width':2});shape('path',{d:'M27 24a6 6 0 1 1 9 5c-3 2-4 3-4 6m0 6v1',...stroke});return svg;
}
function shortDate(value){if(typeof value!=='string')return '';const date=new Date(value.slice(0,10)+'T12:00:00Z');return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('ar-IQ',{day:'numeric',month:'short',timeZone:'UTC'}).format(date):'';}
function dayName(value){if(value===localDay())return 'اليوم';const tomorrow=new Date(Date.parse(localDay()+'T12:00:00Z')+86400000).toISOString().slice(0,10);if(value===tomorrow)return 'غدًا';return new Intl.DateTimeFormat('ar-IQ',{weekday:'long',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));}
function compactRange(row){return dateText(row.start)+' · '+timeText(row.start)+'–'+(row.start.slice(0,10)===row.end.slice(0,10)?'':shortDate(row.end)+' ')+timeText(row.end);}
function renderRainChart(rain){
 const box=$('rainChart'),selection=$('rainChartSelection'),periods=rain?.periods||[];box.replaceChildren();selection.textContent='';
 const maximum=Math.max(1,...periods.map(row=>number(row.precipitation_mm)?row.precipitation_mm:0));
 let selected=null;
 const select=(button,row)=>{selected?.setAttribute('aria-pressed','false');selected=button;button.setAttribute('aria-pressed','true');selection.textContent=compactRange(row)+' · '+(number(row.precipitation_mm)?fmt(row.precipitation_mm,'ملم',2):'كمية غير متاحة')+' خلال '+durationText(row.interval_seconds);};
 const instant=value=>Date.parse(value+'+03:00');let cursor=rain?.start?instant(rain.start):null;
 const gap=(hours)=>{if(!(hours>0))return;const mark=el('div',undefined,'rain-gap');mark.style.setProperty('--hours',String(hours));mark.title='فترة غير مغطاة بالبيانات';mark.setAttribute('aria-label','فترة غير مغطاة بالبيانات');box.append(mark);};
 let first=null,firstWet=null;
 for(const row of periods){
  if(cursor!==null)gap((instant(row.start)-cursor)/3600000);cursor=instant(row.end);
  const button=el('button',undefined,'rain-bar'),fill=el('span',undefined,'rain-bar-fill'),clock=el('time',timeText(row.start));button.type='button';clock.dateTime=row.start;
  button.dataset.start=row.start;button.dataset.end=row.end;button.dataset.mm=number(row.precipitation_mm)?String(row.precipitation_mm):'';button.dataset.hours=String(row.interval_seconds/3600);
  button.style.setProperty('--hours',String(row.interval_seconds/3600));button.style.setProperty('--bar-height',(number(row.precipitation_mm)?Math.max(2,60*row.precipitation_mm/maximum):20)+'px');
  const label=compactRange(row)+' · '+(number(row.precipitation_mm)?fmt(row.precipitation_mm,'ملم',2):'كمية غير متاحة')+' خلال '+durationText(row.interval_seconds);button.setAttribute('aria-label',label);button.setAttribute('aria-pressed','false');button.title=label;fill.setAttribute('aria-hidden','true');button.append(fill,clock);button.onclick=()=>select(button,row);box.append(button);
  first??={button,row};if(row.precipitation_mm>0)firstWet??={button,row};
 }
 if(cursor!==null&&rain?.end)gap((instant(rain.end)-cursor)/3600000);
 const chosen=firstWet??first;if(chosen)select(chosen.button,chosen.row);else selection.textContent='لم تتوفر كميات مؤرخة لرسم الهطول.';
}
function renderRain(data){
 const rain=data.rain_forecast,box=$('weatherRainSummary'),periods=data.precipitation_periods||[],known=rain?.known_precipitation_mm,hasData=number(known),complete=rain?.complete===true,wet=hasData&&known>0;
 box.dataset.rainState=!hasData?'unavailable':complete?(wet?'rain':'dry'):'partial';$('rainForecastDetails').open=false;
 $('rainForecastTitle').textContent=!hasData?'بيانات الهطول غير متاحة':!complete?'تغطية جزئية · كمية الفترات المتاحة':wet?'هطول متوقع خلال ٢٤ ساعة':'لا هطول متوقع خلال ٢٤ ساعة';
 $('rainForecastAmount').textContent=hasData?fmt(complete?rain.precipitation_mm:known,'ملم',2):'—';
 $('rainCoverageBadge').textContent=complete?'٢٤ ساعة':hasData?'تغطية '+fmt(rain.covered_hours,'',2)+'/٢٤ ساعة':'بيانات ناقصة';
 $('rainSummaryIcon').replaceChildren(weatherSymbol(wet?63:3));
 $('rainChartWindow').textContent=rain?.start&&rain?.end?shortDate(rain.start)+' '+timeText(rain.start)+' ← '+shortDate(rain.end)+' '+timeText(rain.end)+' · بغداد':'نافذة التوقع غير متاحة';
 const window=$('rainForecastWindow');window.replaceChildren();if(rain?.start&&rain?.end){window.append('نافذة التوقع: ');periodRange(window,rain.start,rain.end);window.append(' — بتوقيت بغداد.');}else window.textContent='لم تتوفر نافذة مؤرخة لحساب كمية الهطول.';
 $('rainForecastCoverage').textContent='التغطية: '+fmt(rain?.covered_hours??0,'ساعة',2)+' من '+fmt(rain?.total_hours??24,'ساعة',0)+(complete?' — مكتملة.':' — جزئية أو ناقصة؛ القيمة الناقصة لا تعني صفرًا.');
 $('rainForecastProbability').textContent=number(rain?.rain_probability_percent_max)?'أعلى احتمال لفترة ضمن النافذة: '+fmt(rain.rain_probability_percent_max,'%',0)+'؛ ليس احتمالًا مجمعًا للـ٢٤ ساعة.':'نسبة احتمال الهطول غير متاحة من المصدر لهذه النافذة.';
 const next=$('rainForecastNext');next.textContent=rain?.next_rain?'أقرب هطول · '+compactRange(rain.next_rain)+' · '+fmt(rain.next_rain.precipitation_mm,'ملم',2):complete?'لا توجد فترة هطول موجبة في التوقعات المتاحة للأيام القادمة.':'لم تتوفر فترة هطول قادمة؛ بعض البيانات ناقصة.';
 const list=$('rainForecastPeriods'),wetPeriods=periods.filter(row=>number(row.precipitation_mm)&&row.precipitation_mm>0);list.replaceChildren();
 $('rainPeriodsNote').textContent=wetPeriods.length?'الكمية لكل فترة كاملة، بتوقيت بغداد.':periods.length?'لا هطول في الفترات المغطاة'+(rain?.search_end?' حتى '+dateText(rain.search_end):'')+'؛ الفترات الناقصة غير محسوبة.':'لم تتوفر فترات مؤرخة.';
 const renderPeriod=row=>{const card=el('article',undefined,'rain-period');card.setAttribute('role','listitem');card.append(el('h4',compactRange(row)),el('strong',fmt(row.precipitation_mm,'ملم',2)),el('p','خلال '+durationText(row.interval_seconds)+' · '+weatherCode(row.weather_code).label));if(number(row.rain_probability_percent))card.append(el('p','احتمال الفترة: '+fmt(row.rain_probability_percent,'%',0)));return card;};
 for(const row of wetPeriods.slice(0,12))list.append(renderPeriod(row));
 if(wetPeriods.length>12){const details=el('details',undefined,'rain-more'),summary=el('summary','عرض '+fmt(wetPeriods.length-12,'فترة أخرى',0)),rest=el('div',undefined,'rain-periods');for(const row of wetPeriods.slice(12))rest.append(renderPeriod(row));details.append(summary,rest);list.append(details);}
 renderRainChart(rain);
}
function renderCurrent(data){
 const box=$('weatherCurrent');box.replaceChildren();const current=data.current,today=data.daily.find(day=>day.date===localDay());
 if(!current){box.append(el('p','الحالة الحالية غير متاحة. راجع التوقعات أدناه.'));return;}
 const code=weatherCode(current.weather_code),main=el('div',undefined,'current-main'),icon=el('span',undefined,'weather-icon'),summary=el('div');icon.setAttribute('aria-hidden','true');icon.append(weatherSymbol(current.weather_code,current.is_day));
 summary.append(el('strong',fmt(current.temperature_c,'°',0),'temperature'),el('p',code.label,'weather-description'),el('p','العظمى '+fmt(today?.tmax_c,'°',0)+' · الصغرى '+fmt(today?.tmin_c,'°',0)+' · مئوية','hero-range'));main.append(icon,summary);box.append(main);
 if(current.stale)box.append(el('p','التوقع الحالي قديم؛ حدّث البيانات قبل اتخاذ قرار.','current-stale'));
 const metrics=el('div',undefined,'current-metrics');metrics.append(metric('الرياح · '+compass(current.wind_direction_deg),fmt(current.wind_kmh,'كم/س',0)),metric('الرطوبة النسبية',fmt(current.humidity_percent,'%',0)),number(current.feels_like_c)?metric('الحرارة المحسوسة',fmt(current.feels_like_c,'°م',0)):metric('هبّات الرياح',fmt(current.wind_gusts_kmh,'كم/س',0)),metric('هطول الفترة الحالية'+(current.interval_seconds?' · '+durationText(current.interval_seconds):''),fmt(current.precipitation_mm,'ملم',2)));box.append(metrics);
}
function renderHourly(data){
 const box=$('weatherHourly');box.replaceChildren();if(!data.hourly.length){box.append(el('p','لم تتوفر توقعات الساعات.','muted'));return;}
 for(const hour of data.hourly){const code=weatherCode(hour.weather_code),card=el('article',undefined,'hour-card'),time=el('time',timeText(hour.time)),icon=el('div',undefined,'hour-icon');card.setAttribute('role','listitem');time.dateTime=hour.time;time.setAttribute('aria-label',dateText(hour.time)+'، '+timeText(hour.time)+' بتوقيت بغداد');icon.setAttribute('role','img');icon.setAttribute('aria-label',code.label);icon.append(weatherSymbol(hour.weather_code));card.append(time,icon,el('div',fmt(hour.temperature_c,'°',0),'hour-temp'),el('p',fmt(hour.precipitation_mm,'ملم',2),'hour-rain'));
 if(number(hour.interval_seconds)&&hour.end_time){const label=hour.interval_seconds===3600?'خلال ساعة واحدة':'خلال '+durationText(hour.interval_seconds);const duration=el('p',label,'hour-period');duration.title=timeText(hour.time)+'–'+timeText(hour.end_time);card.append(duration);}else if(number(hour.precipitation_mm))card.append(el('p','مدة غير متاحة','hour-period'));
 if(number(hour.rain_probability_percent))card.append(el('p',fmt(hour.rain_probability_percent,'%',0),'hour-probability'));box.append(card);}
}
function renderDaily(data){
 const box=$('weatherDaily');box.replaceChildren();if(!data.daily.length){box.append(el('p','لم تتوفر توقعات الأيام.','muted'));return;}
 const values=data.daily.flatMap(day=>[day.tmin_c,day.tmax_c]).filter(number),minimum=Math.min(...values),maximum=Math.max(...values),span=Math.max(1,maximum-minimum);
 for(const day of data.daily){const code=weatherCode(day.weather_code),card=el('details',undefined,'day-card'),head=el('summary'),title=el('span',dayName(day.date),'day-name'),icon=el('span',undefined,'day-icon');title.append(el('span',shortDate(day.date),'day-short-date'));icon.setAttribute('role','img');icon.setAttribute('aria-label',code.label);icon.append(weatherSymbol(day.weather_code));
 const track=el('span',undefined,'temperature-track');track.setAttribute('aria-hidden','true');if(number(day.tmin_c)&&number(day.tmax_c)&&day.tmax_c>=day.tmin_c){const range=el('span',undefined,'temperature-range');const start=Math.min(96,(day.tmin_c-minimum)/span*100),width=Math.min(100-start,Math.max(4,(day.tmax_c-day.tmin_c)/span*100));range.style.setProperty('--range-start',start+'%');range.style.setProperty('--range-width',width+'%');track.append(range);}
 const low=el('span',fmt(day.tmin_c,'°',0),'day-low'),high=el('span',fmt(day.tmax_c,'°',0),'day-high');low.setAttribute('aria-label','الصغرى '+fmt(day.tmin_c,'درجة',0));high.setAttribute('aria-label','العظمى '+fmt(day.tmax_c,'درجة',0));head.append(title,icon,low,track,high,el('span','⌄','day-expand'));
 const body=el('div',undefined,'day-details'),dl=el('dl',undefined,'day-metrics');detail(dl,'مجموع الهطول ليوم كامل',number(day.precipitation_mm)?fmt(day.precipitation_mm,'ملم',2):'غير متاح كيوم كامل');if(number(day.rain_probability_percent))detail(dl,'أعلى احتمال لفترة',fmt(day.rain_probability_percent,'%',0));detail(dl,'أعلى رياح',fmt(day.wind_max_kmh,'كم/ساعة',0));detail(dl,'أعلى هبّات',fmt(day.wind_gusts_max_kmh,'كم/ساعة',0));detail(dl,'التبخر المرجعي ET₀',number(day.et0_mm)?fmt(day.et0_mm,'ملم'):'غير متاح');body.append(el('p',code.label,'day-condition'),dl);card.append(head,body);box.append(card);}
}
function renderAlerts(data){const box=$('weatherAlerts');box.replaceChildren();if(!data.alerts.length){const note=el('article',undefined,'weather-alert empty');note.append(el('strong','لا تنبيهات إرشادية بارزة'),el('p','تابع تحديث التوقعات وحالة الحقل؛ هذا لا يضمن غياب المخاطر.'));box.append(note);return;}for(const alert of data.alerts){const card=el('article',undefined,'weather-alert');card.append(el('strong',alert.title),el('p',alert.text));box.append(card);}}
function render(data,locationInfo){
 $('weatherLocationKind').textContent=locationInfo.kind==='field'?'موقع الحقل الزراعي':'مدينة مرجعية';$('weatherLocation').textContent=locationInfo.name;$('weatherMeta').textContent='الحالة عند '+timeText(data.current?.time)+' · آخر جلب '+fetchedText(data.fetched_at)+(data.model_updated_at?' · تحديث المصدر '+fetchedText(data.model_updated_at):'');
 renderCurrent(data);renderRain(data);renderHourly(data);renderDaily(data);renderAlerts(data);$('weatherResult').hidden=false;$('locationPickerLabel').textContent=locationInfo.name+(locationInfo.kind==='city'?' · مدينة مرجعية':' · موقع الحقل');const picker=$('weatherLocationPicker'),hasFocus=picker.contains(document.activeElement);picker.open=false;if(hasFocus)picker.querySelector('summary').focus();
}
function invalidate(message='اختر موقعًا لعرض الطقس.'){generation++;controller?.abort();controller=null;$('weatherResult').hidden=true;setStatus(message);$('refreshWeather').disabled=!hasSelection();}
function hasSelection(){return $('locationMode').value==='field'?!!fields.find(field=>field.id===$('weatherField').value):cities.some(city=>city[0]===$('weatherCity').value);}
async function loadWeather(){
 invalidate();if(!hasSelection())return;const token=generation;controller=new AbortController();const signal=controller.signal;$('refreshWeather').disabled=true;setStatus('جارٍ تحديد الموقع وجلب توقعات الطقس…');
 try{
  let point,locationInfo;
  if($('locationMode').value==='city'){const city=cities.find(row=>row[0]===$('weatherCity').value);if(!city)throw Error('اختر مدينة مرجعية.');point={latitude:city[2],longitude:city[3]};locationInfo={kind:'city',name:city[1]};}
  else{const field=fields.find(row=>row.id===$('weatherField').value);if(!field||!client||!user)throw Error('اختر حقلًا من حسابك أولًا.');const result=await client.from('field_boundaries').select('geometry').eq('field_id',field.id).eq('owner_id',user.id).maybeSingle();if(token!==generation)return;if(result.error)throw Error('تعذرت قراءة حدود الحقل. أعد تسجيل الدخول أو راجع الاتصال.');if(!result.data?.geometry)throw Error('لا توجد حدود محفوظة لهذا الحقل. ارسمها من خريطة الحقول، أو اختر مدينة مرجعية بوضوح.');point=fieldWeatherLocation(result.data.geometry);locationInfo={kind:'field',name:field.name};}
  if(token!==generation)return;const data=await fetchWeather({...point,signal});if(token!==generation)return;render(data,locationInfo);setStatus(locationInfo.kind==='field'?'تم تحديث توقعات موقع الحقل. البيانات تقديرية من نموذج الطقس.':'تم تحديث طقس المدينة المرجعية. هذا الموقع لا يمثل إحداثيات حقل محدد.');
 }catch(error){if(token!==generation)return;$('weatherResult').hidden=true;setStatus(error?.name==='AbortError'?'انتهت مهلة الاتصال بالطقس. اضغط تحديث للمحاولة مجددًا.':('تعذر عرض الطقس: '+(error.message||'خطأ اتصال بالمصدر.')),true);}
 finally{if(token===generation){controller=null;$('refreshWeather').disabled=!hasSelection();}}
}
$('locationMode').onchange=()=>{const isField=$('locationMode').value==='field';$('fieldPicker').hidden=!isField;$('cityPicker').hidden=isField;invalidate(isField?'اختر حقلًا محفوظًا لعرض طقس موقعه.':'اختر مدينة مرجعية؛ لن يُنسب طقسها إلى الحقل.');if(hasSelection())void loadWeather();};
$('weatherField').onchange=()=>{invalidate('تغيّر الحقل. جارٍ إعداد طقس موقعه…');if(hasSelection())void loadWeather();};
$('weatherCity').onchange=()=>{invalidate('تغيّرت المدينة المرجعية.');if(hasSelection())void loadWeather();};
$('refreshWeather').onclick=()=>void loadWeather();
async function loadFields(){
 try{
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
  client=createClient('https://ynsmhtsktbubxfhsekjq.supabase.co','sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc');const auth=await client.auth.getUser();if(auth.error||!auth.data?.user)throw Error('سجّل الدخول لعرض الحقول، أو اختر مدينة مرجعية.');user=auth.data.user;
  const result=await client.from('fields').select('id,name,farms!inner(owner_id)').eq('farms.owner_id',user.id).order('name');if(result.error)throw Error('تعذّر تحميل حقول الحساب.');fields=Array.isArray(result.data)?result.data:[];$('weatherField').replaceChildren(new Option(fields.length?'اختر حقلًا':'لا توجد حقول محفوظة',''));for(const field of fields)$('weatherField').add(new Option(field.name,field.id));$('weatherField').disabled=!fields.length;$('accountStatus').textContent=fields.length?'حقول حسابك جاهزة. الموقع يؤخذ من الحدود المحفوظة لكل حقل.':'أضف حقلًا وحدوده من لوحة المزارع، أو اختر مدينة مرجعية.';
  const chosen=hasInitialField?fields.find(field=>field.id===initialField):fields[0];if(hasInitialField&&!chosen){if($('locationMode').value==='field')setStatus('الحقل المطلوب غير متاح في حسابك. اختر أحد حقولك أو مدينة مرجعية.',true);}else if(chosen&&$('locationMode').value==='field'){$('weatherField').value=chosen.id;void loadWeather();}
  client.auth.onAuthStateChange?.(event=>{if(event==='SIGNED_OUT'){user=null;fields=[];$('weatherField').replaceChildren(new Option('سجّل الدخول لعرض الحقول',''));$('weatherField').disabled=true;$('accountStatus').textContent='انتهت جلسة الحساب. سجّل الدخول لعرض الحقول، أو اختر مدينة مرجعية.';if($('locationMode').value==='field')invalidate('سجّل الدخول مجددًا لعرض طقس الحقل.');}});
 }catch(error){fields=[];user=null;$('weatherField').replaceChildren(new Option('سجّل الدخول لعرض الحقول',''));$('weatherField').disabled=true;$('accountStatus').replaceChildren(el('span',error.message||'تعذر تحميل حقول الحساب.'),' ',Object.assign(el('a','تسجيل الدخول'),{href:'./auth.html'}));if($('locationMode').value==='field')setStatus('يمكنك تسجيل الدخول لعرض حقولك أو اختيار مدينة مرجعية.');}
}
void loadFields();
