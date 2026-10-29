import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adaptMETPayload,handleWeather,metSymbolToWMO,MET_USER_AGENT} from '../satellite-backend/met-weather.mjs';

const HOUR=3600000;
const units={air_temperature:'celsius',relative_humidity:'%',precipitation_amount:'mm',wind_speed:'m/s',wind_speed_of_gust:'m/s',wind_from_direction:'degrees',probability_of_precipitation:'%'};
const point=(time,{instant={},periods={1:{amount:1,symbol:'lightrain_day'}}}={})=>({time,data:{instant:{details:{air_temperature:25,relative_humidity:40,wind_speed:5,wind_from_direction:270,...instant}},...Object.fromEntries(Object.entries(periods).map(([hours,value])=>['next_'+hours+'_hours',{summary:{symbol_code:value.symbol||'rain'},details:{...(value.amount===undefined?{}:{precipitation_amount:value.amount}),...(value.probability===undefined?{}:{probability_of_precipitation:value.probability})}}]))}});
const payload=rows=>({type:'Feature',geometry:{type:'Point',coordinates:[44.3661,33.3152,40]},properties:{meta:{updated_at:'2026-10-29T12:00:00Z',units:{...units}},timeseries:rows}});
const series=(start,count,options)=>Array.from({length:count},(_,i)=>point(new Date(Date.parse(start)+i*HOUR).toISOString().replace('.000Z','Z'),typeof options==='function'?options(i):options));
const json=(body,headers={})=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json',...headers}});
const request=(query='lat=33.315234&lon=44.366146',method='GET')=>new Request('https://worker.test/weather?'+query,{method});
async function withFetch(fetchImpl,fn,cache){
 const originalFetch=globalThis.fetch,originalCaches=Object.getOwnPropertyDescriptor(globalThis,'caches');
 globalThis.fetch=fetchImpl;
 Object.defineProperty(globalThis,'caches',{value:cache?{default:cache}:undefined,writable:true,configurable:true});
 try{return await fn();}finally{globalThis.fetch=originalFetch;if(originalCaches)Object.defineProperty(globalThis,'caches',originalCaches);else delete globalThis.caches;}
}
const livePayload=()=>payload(series(new Date(Math.floor(Date.now()/HOUR)*HOUR).toISOString().replace('.000Z','Z'),25));

test('MET units, Baghdad time, current interval, and preferred one-hour precipitation are decoded',()=>{
 const p=payload([point('2026-10-29T21:00:00Z',{instant:{wind_speed_of_gust:10},periods:{1:{amount:0.6,symbol:'lightrain_night',probability:70},6:{amount:12,symbol:'heavyrain'}}})]);
 const result=adaptMETPayload(p,'2026-10-29T21:15:00Z');
 assert.equal(result.timezone,'Asia/Baghdad');assert.equal(result.utc_offset_seconds,10800);
 assert.equal(result.current.time,'2026-10-30T00:00');assert.equal(result.current.interval,3600);
 assert.equal(result.current.precipitation,.6);assert.equal(result.current.precipitation_probability,70);
 assert.equal(result.current.wind_speed_10m,18);assert.equal(result.current.wind_gusts_10m,36);
 assert.equal(result.current.is_day,0);assert.equal(result.current.weather_code,61);
 assert.equal(result.daily.time[0],'2026-10-30');assert.equal(result.daily.time.length,7);
 assert.equal(result.source.name,'MET Norway');assert.equal(result.source.license,'CC BY 4.0');assert.match(result.note,/6 ساعات/);
 assert.equal(result.current_units.wind_speed_10m,'km/h');assert.equal(result.daily_units.precipitation_sum,'mm');
});

test('six-hour precipitation stays one accumulation with its explicit interval; missing numbers remain null',()=>{
 const p=payload([point('2026-10-29T21:00:00Z',{instant:{air_temperature:null,relative_humidity:null,wind_speed:null},periods:{6:{amount:8,symbol:'heavyrain'}}}),point('2026-10-30T03:00:00Z',{periods:{}})]);
 const result=adaptMETPayload(p,'2026-10-29T22:00:00Z');
 assert.equal(result.current.interval,21600);assert.equal(result.current.precipitation,8);
 assert.equal(result.current.temperature_2m,null);assert.equal(result.current.relative_humidity_2m,null);assert.equal(result.current.wind_speed_10m,null);
 assert.equal(result.current.precipitation_probability,null);assert.equal(result.current.wind_gusts_10m,null);assert.equal(result.current.apparent_temperature,null);
 assert.equal(result.hourly.time.length,1);assert.equal(result.hourly.time[0],'2026-10-30T06:00');
 assert.equal(result.hourly.precipitation[0],null);assert.equal(result.daily.precipitation_sum[0],null);
 assert.ok(result.daily.et0_fao_evapotranspiration.every(v=>v===null));assert.ok(result.daily.sunrise.every(v=>v===null));assert.ok(result.daily.sunset.every(v=>v===null));
 const instantOnly=adaptMETPayload(payload([point('2026-10-29T21:00:00Z',{periods:{}})]),'2026-10-29T21:10:00Z');
 assert.equal(instantOnly.current.interval,null);assert.equal(instantOnly.current.precipitation,null);
});

test('daily rain counts non-overlapping periods only and uses local day boundaries',()=>{
 const rows=series('2026-10-28T21:00:00Z',49,i=>({instant:{air_temperature:i},periods:{1:{amount:1},6:{amount:99},12:{amount:199}}}));
 const result=adaptMETPayload(payload(rows),'2026-10-29T00:00:00Z');
 assert.equal(result.daily.time[0],'2026-10-29');assert.equal(result.daily.precipitation_sum[0],24);assert.equal(result.daily.precipitation_sum[1],24);
 assert.equal(result.daily.temperature_2m_min[0],0);assert.equal(result.daily.temperature_2m_max[0],23);
 assert.equal(result.hourly.time.length,24);assert.equal(result.hourly.time[0],'2026-10-29T03:00');
 assert.equal(result.daily.precipitation_sum[2],null);
 const sparse=payload([0,6,12,18].map(i=>point(new Date(Date.parse('2026-10-28T21:00:00Z')+i*HOUR).toISOString().replace('.000Z','Z'),{periods:{6:{amount:2}}})));
 assert.equal(adaptMETPayload(sparse,'2026-10-29T00:00:00Z').daily.precipitation_sum[0],8);
 sparse.properties.timeseries.pop();assert.equal(adaptMETPayload(sparse,'2026-10-29T00:00:00Z').daily.precipitation_sum[0],null);
 const crossing=payload([point('2026-10-28T18:00:00Z',{periods:{6:{amount:3}}}),...series('2026-10-29T00:00:00Z',22)]);
 assert.equal(adaptMETPayload(crossing,'2026-10-29T00:00:00Z').daily.precipitation_sum[0],null);
});

test('weather symbols preserve WMO meanings without inventing hail',()=>{
 for(const [symbol,code] of Object.entries({clearsky_day:0,fair_night:1,partlycloudy_day:2,cloudy:3,fog:45,lightrain:61,rain:63,heavyrain:65,lightsnow:71,snow:73,heavysnow:75,lightrainshowers_day:80,rainshowers_day:81,heavyrainshowers_night:82,lightsnowshowers_day:85,heavysnowshowers:86,rainandthunder:95,heavysnowshowersandthunder_day:95,lightsleet:68,sleetshowers_day:84}))assert.equal(metSymbolToWMO(symbol),code,symbol);
 assert.equal(metSymbolToWMO('unknown'),null);assert.equal(metSymbolToWMO(null),null);
});

test('invalid data, units and unavailable values never decode as zero',()=>{
 for(const p of [null,{},payload([]),payload([{time:'bad',data:{}}]),payload([point('2026-02-30T21:00:00Z')]),payload([point('2026-10-29T21:00:00Z',{instant:{air_temperature:null,relative_humidity:null,wind_speed:null},periods:{}})])])assert.throws(()=>adaptMETPayload(p,'2026-10-29T21:00:00Z'));
 const p=payload([point('2026-10-29T21:00:00Z')]);p.properties.meta.units.wind_speed='km/h';assert.throws(()=>adaptMETPayload(p,'2026-10-29T21:00:00Z'),/units/);
});

test('route validates decimal WGS84 coordinates and GET before network access',async()=>{
 await withFetch(async()=>{throw Error('must not fetch')},async()=>{
  for(const query of ['','lat=&lon=44','lat=91&lon=44','lat=33&lon=181','lat=NaN&lon=44','lat=0x20&lon=44','lat=3e1&lon=44','lat=33&lon=44&key=private','lat=33&lat=34&lon=44','lat=%2033&lon=44'])assert.equal((await handleWeather(request(query),{},'https://allowed.test')).status,400,query);
  const r=await handleWeather(request('lat=33&lon=44','POST'),{});assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'GET');
 });
});

test('upstream request rounds coordinates, identifies the app and requires no key or database',async()=>{
 await withFetch(async(url,options)=>{
  assert.equal(url,'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=33.3152&lon=44.3661');
  assert.equal(options.method,'GET');assert.equal(options.headers['User-Agent'],MET_USER_AGENT);assert.equal(options.headers.Accept,'application/json');assert.ok(options.signal instanceof AbortSignal);assert.ok(!MET_USER_AGENT.includes('@'));
  assert.equal(options.redirect,'follow');return json(livePayload());
 },async()=>{const r=await handleWeather(request(),{},'https://allowed.test');assert.equal(r.status,200);const body=await r.json();assert.equal(body.latitude,33.3152);assert.equal(body.longitude,44.3661);assert.equal(r.headers.get('access-control-allow-origin'),'https://allowed.test');assert.equal(r.headers.get('x-content-type-options'),'nosniff');});
});

test('provider cache stores raw payload for at least three hours and honors later Expires',async()=>{
 let stored,fetches=0;const raw=livePayload(),cache={async match(){return stored?.clone()},async put(key,value){assert.match(key.url,/lat=33.3152&lon=44.3661/);stored=value.clone()}};
 await withFetch(async()=>{fetches++;return json(raw,{Expires:new Date(Date.now()+5*HOUR).toUTCString()})},async()=>{
  const first=await handleWeather(request(),{});assert.equal(first.status,200);assert.ok(Number(stored.headers.get('cache-control').split('=')[1])>=17999);
  const cached=await stored.clone().json();assert.ok(cached.properties.timeseries);assert.equal(cached.current,undefined);
  assert.equal((await handleWeather(request(),{})).status,200);assert.equal(fetches,1);
 },cache);
 let minimum;
 await withFetch(async()=>json(livePayload(),{Expires:new Date(Date.now()+60*1000).toUTCString()}),async()=>{assert.equal((await handleWeather(request(),{})).status,200);assert.equal(minimum.headers.get('cache-control'),'public, max-age=10800')},{async match(){},async put(key,value){minimum=value}});
});

test('upstream HTTP errors, timeouts, malformed and oversized bodies produce safe errors',async()=>{
 const cases=[{status:502,run:async()=>new Response('private-provider-detail',{status:500})},{status:503,run:async()=>new Response('private-provider-detail',{status:429})},{status:504,run:async()=>{throw new DOMException('private-provider-detail','TimeoutError')}},{status:502,run:async()=>new Response('{broken-private-provider-detail')},{status:502,run:async()=>new Response('x',{headers:{'content-length':String(1024*1024+1)}})},{status:502,run:async()=>new Response('x'.repeat(1024*1024+1))}];
 for(const item of cases)await withFetch(item.run,async()=>{const r=await handleWeather(request(),{});assert.equal(r.status,item.status);assert.ok(!(await r.text()).includes('private-provider-detail'));assert.equal(r.headers.get('cache-control'),'no-store')});
});

test('cache outages fall back to provider without breaking weather',async()=>{
 await withFetch(async()=>json(livePayload()),async()=>assert.equal((await handleWeather(request(),{})).status,200),{async match(){throw Error('cache read')},async put(){throw Error('cache write')}});
});

test('cached raw forecasts are re-adapted after the hour and Baghdad midnight change',async()=>{
 const NativeDate=globalThis.Date;let clock=NativeDate.parse('2026-10-29T20:50:00Z'),stored,fetches=0;
 const raw=payload(series('2026-10-29T00:00:00Z',48));
 globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};
 try{
  await withFetch(async()=>{fetches++;return json(raw)},async()=>{
   const before=await (await handleWeather(request(),{})).json();assert.equal(before.daily.time[0],'2026-10-29');assert.equal(before.current.time,'2026-10-29T23:00');
   clock=NativeDate.parse('2026-10-29T21:10:00Z');
   const after=await (await handleWeather(request(),{})).json();assert.equal(after.daily.time[0],'2026-10-30');assert.equal(after.current.time,'2026-10-30T00:00');assert.equal(after.hourly.time[0],'2026-10-30T00:00');assert.equal(fetches,1);
  },{async match(){return stored?.clone()},async put(key,value){stored=value.clone()}});
 }finally{globalThis.Date=NativeDate;}
});
