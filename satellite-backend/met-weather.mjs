// MET Norway Locationforecast, adapted to the forecast shape used by URSmart.
// https://docs.api.met.no/doc/License.html (CC BY 4.0, including commercial use).
// Global forecasts update six-hourly: cache the RAW model at least three hours.
const HOUR=3600000,DAY=24*HOUR,OFFSET=10800,MAX_BYTES=1024*1024;
const ENDPOINT='https://api.met.no/weatherapi/locationforecast/2.0/compact';
export const MET_USER_AGENT='URSmart/1.0 (https://ur-smart-urfarmiq.pages.dev/; contact: https://www.instagram.com/ur.farm.iq/)';
export const MET_SOURCE=Object.freeze({name:'MET Norway',url:'https://www.met.no/',license:'CC BY 4.0',license_url:'https://creativecommons.org/licenses/by/4.0/'});
const NOTE='توقعات نموذجية من MET Norway أُعيد تنسيقها إلى توقيت بغداد. دقة النموذج العالمي نحو 9 كم، وقد تتباعد العينات إلى 6 ساعات. أعلى وأدنى حرارة محسوبتان من العينات المتاحة وليستا القيم القصوى الرسمية. مجموع المطر غير متاح إذا لم تغطِ الفترات اليوم كاملًا؛ الحقول المفقودة لا تعني صفرًا.';
const n=(value,min=-Infinity,max=Infinity)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:null;
const ms=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value))return null;const timestamp=Date.parse(value);return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().replace('.000Z','Z')===value?timestamp:null};
const local=time=>new Date(time+OFFSET*1000).toISOString().slice(0,16);
const round=value=>Math.round(value*100)/100;
const kmh=value=>{const v=n(value,0);return v===null?null:round(v*3.6)};
const SYMBOLS={clearsky:0,fair:1,partlycloudy:2,cloudy:3,fog:45,lightrain:61,rain:63,heavyrain:65,lightsleet:68,sleet:69,heavysleet:69,lightsnow:71,snow:73,heavysnow:75,lightrainshowers:80,rainshowers:81,heavyrainshowers:82,lightsleetshowers:83,sleetshowers:84,heavysleetshowers:84,lightsnowshowers:85,snowshowers:86,heavysnowshowers:86};
export function metSymbolToWMO(symbol){
 if(typeof symbol!=='string')return null;
 const base=symbol.replace(/_(day|night|polartwilight)$/,'');
 if(base.includes('thunder'))return 95; // MET does not indicate hail; do not invent it.
 return Object.hasOwn(SYMBOLS,base)?SYMBOLS[base]:null;
}
function period(row){
 for(const hours of [1,6,12]){const value=row.data?.['next_'+hours+'_hours'];if(value&&typeof value==='object')return {hours,...value};}
 return null;
}
function decoded(row){
 const details=row.data?.instant?.details||{},p=period(row),symbol=p?.summary?.symbol_code;
 return {time:local(row.timestamp),temperature_2m:n(details.air_temperature,-100,70),relative_humidity_2m:n(details.relative_humidity,0,100),apparent_temperature:null,
  precipitation:n(p?.details?.precipitation_amount,0),precipitation_probability:n(p?.details?.probability_of_precipitation,0,100),
  weather_code:metSymbolToWMO(symbol),wind_speed_10m:kmh(details.wind_speed),wind_direction_10m:n(details.wind_from_direction,0,360),wind_gusts_10m:kmh(details.wind_speed_of_gust),
  is_day:typeof symbol==='string'&&symbol.endsWith('_day')?1:typeof symbol==='string'&&symbol.endsWith('_night')?0:null,interval:p?p.hours*3600:null};
}
function max(rows,key){const values=rows.map(row=>row[key]).filter(value=>value!==null);return values.length?Math.max(...values):null}
function min(rows,key){const values=rows.map(row=>row[key]).filter(value=>value!==null);return values.length?Math.min(...values):null}
function rainForDay(rows,start){
 // Only sum contiguous, non-overlapping intervals wholly inside the local day.
 // Never divide a six-hour accumulation across midnight or fill missing hours.
 let cursor=start,sum=0;
 while(cursor<start+DAY){
  const row=rows.find(row=>row.timestamp===cursor);if(!row)return null;
  let chosen=null;
  for(const hours of [1,6,12]){const amount=n(row.data?.['next_'+hours+'_hours']?.details?.precipitation_amount,0);if(amount!==null&&cursor+hours*HOUR<=start+DAY){chosen={hours,amount};break;}}
  if(!chosen)return null;sum+=chosen.amount;cursor+=chosen.hours*HOUR;
 }
 return round(sum);
}
function validateUnits(payload){
 const expected={air_temperature:'celsius',relative_humidity:'%',precipitation_amount:'mm',wind_speed:'m/s',wind_speed_of_gust:'m/s',wind_from_direction:'degrees',probability_of_precipitation:'%'};
 for(const [key,value] of Object.entries(expected)){const unit=payload.properties?.meta?.units?.[key];if(unit!==undefined&&unit!==value)throw Error('Invalid weather units');}
}
export function adaptMETPayload(payload,now=new Date()){
 const nowMs=new Date(now).getTime();
 if(!payload||typeof payload!=='object'||!Number.isFinite(nowMs)||!Array.isArray(payload.properties?.timeseries))throw Error('Invalid weather data');
 validateUnits(payload);
 const seen=new Set(),rows=payload.properties.timeseries.flatMap(row=>{const timestamp=ms(row?.time);if(timestamp===null||seen.has(timestamp)||!row.data||typeof row.data!=='object')return [];seen.add(timestamp);return [{...row,timestamp}];}).sort((a,b)=>a.timestamp-b.timestamp);
 if(!rows.length||!rows.some(row=>{const value=decoded(row);return ['temperature_2m','relative_humidity_2m','precipitation','wind_speed_10m','weather_code'].some(key=>value[key]!==null)}))throw Error('Weather data unavailable');
 const firstHour=Math.floor(nowMs/HOUR)*HOUR,today=local(nowMs).slice(0,10),dayStart=Date.parse(today+'T00:00:00Z')-OFFSET*1000;
 const currentRow=rows.filter(row=>row.timestamp<=nowMs&&row.timestamp>=nowMs-6*HOUR).at(-1)||rows.find(row=>row.timestamp>nowMs&&row.timestamp<=nowMs+HOUR);
 const current=currentRow?decoded(currentRow):null;
 const hourlyRows=rows.filter(row=>row.timestamp>=firstHour&&row.timestamp<firstHour+24*HOUR).map(decoded);
 const hourly={};for(const key of ['time','temperature_2m','relative_humidity_2m','precipitation','precipitation_probability','weather_code','wind_speed_10m','wind_gusts_10m','interval'])hourly[key]=hourlyRows.map(row=>row[key]);
 const daily={time:[],weather_code:[],temperature_2m_max:[],temperature_2m_min:[],precipitation_sum:[],precipitation_probability_max:[],wind_speed_10m_max:[],wind_gusts_10m_max:[],et0_fao_evapotranspiration:[],sunrise:[],sunset:[]};
 for(let i=0;i<7;i++){
  const start=dayStart+i*DAY,dayRows=rows.filter(row=>row.timestamp>=start&&row.timestamp<start+DAY).map(decoded),codes=dayRows.map(row=>row.weather_code).filter(value=>value!==null);
  // Select a representative daily condition with severe weather given priority.
  daily.time.push(local(start).slice(0,10));daily.weather_code.push(codes.length?Math.max(...codes):null);
  daily.temperature_2m_max.push(max(dayRows,'temperature_2m'));daily.temperature_2m_min.push(min(dayRows,'temperature_2m'));
  daily.precipitation_sum.push(rainForDay(rows,start));daily.precipitation_probability_max.push(max(dayRows,'precipitation_probability'));
  daily.wind_speed_10m_max.push(max(dayRows,'wind_speed_10m'));daily.wind_gusts_10m_max.push(max(dayRows,'wind_gusts_10m'));
  daily.et0_fao_evapotranspiration.push(null);daily.sunrise.push(null);daily.sunset.push(null);
 }
 const common={time:'iso8601',temperature_2m:'°C',relative_humidity_2m:'%',precipitation:'mm',precipitation_probability:'%',weather_code:'wmo code',wind_speed_10m:'km/h',wind_gusts_10m:'km/h',interval:'seconds'};
 return {latitude:n(payload.geometry?.coordinates?.[1],-90,90),longitude:n(payload.geometry?.coordinates?.[0],-180,180),timezone:'Asia/Baghdad',timezone_abbreviation:'+03',utc_offset_seconds:OFFSET,
  current,current_units:{...common,apparent_temperature:'°C',wind_direction_10m:'°',is_day:''},hourly,hourly_units:{...common},daily,
  daily_units:{time:'iso8601',weather_code:'wmo code',temperature_2m_max:'°C',temperature_2m_min:'°C',precipitation_sum:'mm',precipitation_probability_max:'%',wind_speed_10m_max:'km/h',wind_gusts_10m_max:'km/h',et0_fao_evapotranspiration:'mm',sunrise:'iso8601',sunset:'iso8601'},
  source:{...MET_SOURCE},note:NOTE,model_updated_at:payload.properties?.meta?.updated_at||null};
}
class WeatherError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
function coordinates(url){
 const params=url.searchParams;
 if([...params.keys()].some(key=>!['lat','lon'].includes(key))||params.getAll('lat').length!==1||params.getAll('lon').length!==1)throw new WeatherError(400,'WEATHER_COORDINATES','Valid latitude and longitude are required.');
 const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
 const values=['lat','lon'].map(key=>{const text=params.get(key);return text!==null&&text.length<=32&&decimal.test(text)?Number(text):NaN});
 if(!Number.isFinite(values[0])||Math.abs(values[0])>90||!Number.isFinite(values[1])||Math.abs(values[1])>180)throw new WeatherError(400,'WEATHER_COORDINATES','Valid latitude and longitude are required.');
 return values.map(value=>Number(value.toFixed(4)));
}
function response(body,status,origin,extra={}){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin||'https://urfarmiq.github.io','vary':'Origin','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',...extra}});}
async function boundedJSON(response){
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>MAX_BYTES)throw Error('Weather response too large');
 if(!response.body)throw Error('Missing weather response');
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES)throw Error('Weather response too large');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const all=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(new TextDecoder().decode(all));
}
export async function handleWeather(request,env={},allowedOrigin='https://urfarmiq.github.io'){
 if(request.method!=='GET')return response({error:'GET only',code:'WEATHER_METHOD'},405,allowedOrigin,{Allow:'GET'});
 let controller,timer;
 try{
  const [lat,lon]=coordinates(new URL(request.url)),upstreamURL=new URL(ENDPOINT);upstreamURL.search=new URLSearchParams({lat:String(lat),lon:String(lon)}).toString();
  // Internal cache keys have no user auth or Origin. Cache RAW data so midnight
  // and each subsequent hourly window are adapted using the actual request time.
  const cache=globalThis.caches?.default,key=new Request(upstreamURL.toString());let raw=null;
  if(cache){try{const hit=await cache.match(key);if(hit)raw=await boundedJSON(hit);}catch{/* A cache failure must not disable weather. */}}
  if(!raw){
   controller=new AbortController();timer=setTimeout(()=>controller.abort(),12000);
   let upstream;
   try{upstream=await fetch(upstreamURL.toString(),{method:'GET',headers:{'User-Agent':MET_USER_AGENT,Accept:'application/json'},signal:controller.signal,redirect:'follow'});}catch(error){if(controller.signal.aborted||['AbortError','TimeoutError'].includes(error?.name))throw new WeatherError(504,'WEATHER_TIMEOUT','Weather service timed out. Try again later.');throw error;}
   if(!upstream.ok)throw new WeatherError(upstream.status===429?503:502,'WEATHER_UPSTREAM','Weather service is temporarily unavailable.');
   raw=await boundedJSON(upstream);
   // Validate before caching; malformed/provider error payloads must not persist.
   adaptMETPayload(raw);
   const expiry=Date.parse(upstream.headers.get('expires')||''),ttl=Math.max(3*3600,Number.isFinite(expiry)?Math.ceil((expiry-Date.now())/1000):0);
   if(cache){try{await cache.put(key,new Response(JSON.stringify(raw),{headers:{'content-type':'application/json','cache-control':'public, max-age='+ttl,'expires':new Date(Date.now()+ttl*1000).toUTCString(),...(upstream.headers.get('last-modified')?{'last-modified':upstream.headers.get('last-modified')}:{})}}));}catch{/* Cache writes are optional in local runtimes. */}}
  }
  return response({...adaptMETPayload(raw),latitude:lat,longitude:lon},200,allowedOrigin,{'cache-control':'public, max-age=1800'});
 }catch(error){const timedOut=controller?.signal.aborted||['AbortError','TimeoutError'].includes(error?.name);return response({error:error instanceof WeatherError?error.message:timedOut?'Weather service timed out. Try again later.':'Weather service is temporarily unavailable.',code:error instanceof WeatherError?error.code:timedOut?'WEATHER_TIMEOUT':'WEATHER_UPSTREAM'},error instanceof WeatherError?error.status:timedOut?504:502,allowedOrigin);}
 finally{if(timer)clearTimeout(timer);}
}
