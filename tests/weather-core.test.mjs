import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCoordinates,fieldWeatherLocation,buildWeatherUrl,weatherCode,normalizeWeather,fetchWeather} from '../weather-core.mjs';

const NOW='2026-10-27T05:25:00Z'; // 08:25 Baghdad, independent of machine timezone.
function fixture(){return {
 source:{name:'MET Norway',url:'https://www.met.no/',license:'CC BY 4.0',license_url:'https://creativecommons.org/licenses/by/4.0/'},
 timezone:'Asia/Baghdad',utc_offset_seconds:10800,
 current:{time:'2026-10-27T08:15',interval:900,temperature_2m:0,apparent_temperature:null,relative_humidity_2m:80,precipitation:0,weather_code:0,wind_speed_10m:0,wind_direction_10m:0,wind_gusts_10m:5,is_day:1},
 current_units:{temperature_2m:'°C',relative_humidity_2m:'%',precipitation:'mm',wind_speed_10m:'km/h'},
 hourly:{time:['2026-10-27T07:00','2026-10-27T08:00','2026-10-27T09:00','bad-date','2026-10-28T08:00'],temperature_2m:[10,0,null,9,19],relative_humidity_2m:[null,80],precipitation:[0,0,2],precipitation_probability:[0,0,90],weather_code:[0,0,61],wind_speed_10m:[5,0,12],wind_gusts_10m:[7,0,20]},
 daily:{time:['2026-10-26','2026-10-27','2026-10-28','2026-11-03'],temperature_2m_max:[30,0,21,90],temperature_2m_min:[10,0,null,9],precipitation_sum:[null,0,6,0],precipitation_probability_max:[0,0,80,0],wind_speed_10m_max:[0,0,20,0],wind_gusts_10m_max:[0,0,30,0],et0_fao_evapotranspiration:[0,0,null,0],weather_code:[0,0,61,0],sunrise:[null,'2026-10-27T06:10'],sunset:[null,'2026-10-27T17:15']},
};}

test('weather locations require finite real coordinates and a closed polygon, without substituting a city',()=>{
 assert.deepEqual(validateCoordinates(0,0),{latitude:0,longitude:0});
 for(const [lat,lon] of [[null,44],['',44],[false,44],[91,44],[33,181],[NaN,44]])assert.throws(()=>validateCoordinates(lat,lon));
 const geometry={type:'Polygon',coordinates:[[[44,33],[44.02,33],[44.02,33.02],[44,33.02],[44,33]]]};
 const location=fieldWeatherLocation(JSON.stringify(geometry));assert.ok(Math.abs(location.latitude-33.01)<1e-10);assert.ok(Math.abs(location.longitude-44.01)<1e-10);
 assert.deepEqual(fieldWeatherLocation({type:'Feature',geometry}),fieldWeatherLocation(geometry));
 for(const bad of [null,{},'{invalid',{type:'Point',coordinates:[44,33]},{type:'Polygon',coordinates:[[[44,33],[null,33],[44,34],[44,33]]]},{type:'Polygon',coordinates:[[[44,33],[44,33],[44,33],[44,33]]]},{type:'Polygon',coordinates:[[[44,33],[45,33],[45,34],[44,34]]]}])assert.throws(()=>fieldWeatherLocation(bad));
});

test('forecast request uses the anonymous fixed MET Norway adapter with coordinates only',()=>{
 const url=new URL(buildWeatherUrl({latitude:33.3,longitude:44.4}));
 assert.equal(url.origin,'https://ur-smart-satellite.alialbatekh111.workers.dev');assert.equal(url.pathname,'/weather');
 assert.deepEqual([...url.searchParams.entries()],[['lat','33.3'],['lon','44.4']]);
 assert.throws(()=>buildWeatherUrl({latitude:null,longitude:44}));
});

test('Arabic WMO descriptions preserve valid clear code zero and unknown missing codes',()=>{
 assert.match(weatherCode(0).label,/صافية/);assert.match(weatherCode(97).label,/رعدية/);
 for(const value of [null,undefined,'',false,999])assert.match(weatherCode(value).label,/غير متاحة/);
});

test('normalization keeps zero, missing arrays, invalid probabilities and timestamps distinct',()=>{
 const data=fixture();data.hourly.precipitation_probability[2]=101;
 const result=normalizeWeather(data,{now:NOW});
 assert.equal(result.current.temperature_c,0);assert.equal(result.current.feels_like_c,null);assert.equal(result.current.wind_kmh,0);assert.equal(result.current.wind_direction_deg,0);
 assert.equal(result.current.interval_minutes,15);assert.equal(result.current.age_minutes,10);assert.equal(result.current.stale,false);
 assert.deepEqual(result.hourly.map(x=>x.time),['2026-10-27T08:00','2026-10-27T09:00']);
 assert.equal(result.hourly[1].temperature_c,null);assert.equal(result.hourly[1].humidity_percent,null);assert.equal(result.hourly[1].rain_probability_percent,null);
 assert.deepEqual(result.daily.map(x=>x.date),['2026-10-27','2026-10-28']);
 assert.equal(result.daily[0].et0_mm,0);assert.equal(result.daily[1].et0_mm,null);assert.equal(result.daily[0].sunrise,'2026-10-27T06:10');assert.equal(result.daily[1].sunrise,null);
 assert.equal(result.source,'MET Norway');assert.equal(result.source_url,'https://www.met.no/');assert.equal(result.source_license,'CC BY 4.0');assert.equal(result.source_license_url,'https://creativecommons.org/licenses/by/4.0/');assert.equal(result.timezone,'Asia/Baghdad');assert.equal(result.fetched_at,new Date(NOW).toISOString());assert.equal(result.modeled,true);
 assert.match(result.note,/ليست قياس محطة/);
});

test('MET Norway missing measurements stay null and coarse model intervals remain usable',()=>{
 const data=fixture();
 data.current.interval=21600;data.current.time='2026-10-27T03:00';data.current.precipitation=null;
 data.hourly.precipitation_probability.fill(null);
 for(const key of ['et0_fao_evapotranspiration','precipitation_probability_max','sunrise','sunset'])data.daily[key]=data.daily.time.map(()=>null);
 const result=normalizeWeather(data,{now:NOW});
 assert.equal(result.current.interval_minutes,360);assert.equal(result.current.stale,false);assert.equal(result.current.precipitation_mm,null);
 assert.ok(result.hourly.every(row=>row.rain_probability_percent===null));
 assert.ok(result.daily.every(row=>row.et0_mm===null&&row.rain_probability_percent===null&&row.sunrise===null&&row.sunset===null));
 data.current.time='2026-10-26T23:00';assert.equal(normalizeWeather(data,{now:NOW}).current.stale,true);
});

test('Baghdad day and observation age use response offset across UTC midnight, not host timezone',()=>{
 const data=fixture();data.current.time='2026-10-28T00:00';data.daily.time=['2026-10-27','2026-10-28'];data.hourly.time=['2026-10-27T23:00','2026-10-28T00:00'];
 const result=normalizeWeather(data,{now:'2026-10-27T21:05:00Z'});
 assert.equal(result.current.age_minutes,5);assert.equal(result.current.stale,false);
 assert.deepEqual(result.daily.map(x=>x.date),['2026-10-28']);assert.deepEqual(result.hourly.map(x=>x.time),['2026-10-28T00:00']);
 const stale=fixture();stale.current.time='2026-10-27T06:00';assert.equal(normalizeWeather(stale,{now:NOW}).current.stale,true);
 const future=fixture();future.current.time='2026-10-27T10:00';assert.equal(normalizeWeather(future,{now:NOW}).current.stale,true);
});

test('weather advisories describe model conditions, and stale current data cannot trigger a fresh heat alert',()=>{
 const data=fixture();data.current.temperature_2m=45;data.current.time='2026-10-26T08:00';data.daily.temperature_2m_min=[10,12,12,12];
 const result=normalizeWeather(data,{now:NOW});assert.equal(result.current.stale,true);assert.equal(result.alerts.some(x=>x.kind==='heat'),false);
 assert.equal(result.alerts.some(x=>x.kind==='rain'),true);
 data.daily.temperature_2m_max[1]=42;data.daily.wind_gusts_10m_max[1]=55;data.daily.weather_code[1]=97;
 const alerts=normalizeWeather(data,{now:NOW}).alerts;assert.ok(alerts.some(x=>x.kind==='heat'));assert.ok(alerts.some(x=>x.kind==='wind'));assert.ok(alerts.some(x=>x.kind==='storm'));
 assert.ok(alerts.every(x=>x.level==='تنبيه إرشادي'&&x.title&&x.text));
});

test('wrong units, service errors and unusable timestamps are rejected instead of displayed as forecasts',()=>{
 const wrong=fixture();wrong.current_units.temperature_2m='°F';assert.throws(()=>normalizeWeather(wrong,{now:NOW}),/وحدات/);
 assert.throws(()=>normalizeWeather({error:true,reason:'external error'},{now:NOW}));
 assert.throws(()=>normalizeWeather({current:{time:'2026-02-30T09:00',temperature_2m:30},daily:{time:['2026-02-30']}},{now:NOW}));
 assert.throws(()=>normalizeWeather({hourly:{time:['2026-10-27T08:00']},daily:{time:['2026-10-27']}},{now:NOW}));
 const badTimezone=fixture();badTimezone.timezone='not/a/timezone';assert.throws(()=>normalizeWeather(badTimezone,{now:NOW}));
 const utc=fixture();utc.timezone='UTC';utc.utc_offset_seconds=0;assert.throws(()=>normalizeWeather(utc,{now:NOW}),/توقيت بغداد/);
 const wrongOffset=fixture();wrongOffset.utc_offset_seconds=0;assert.throws(()=>normalizeWeather(wrongOffset,{now:NOW}),/توقيت بغداد/);
 const implicit=fixture();delete implicit.timezone;delete implicit.utc_offset_seconds;assert.equal(normalizeWeather(implicit,{now:NOW}).utc_offset_seconds,10800);
});

test('fetch makes one anonymous no-store request and timestamps only a successful fresh result',async()=>{
 const calls=[];
 const weather=await fetchWeather({latitude:33,longitude:44,now:NOW,fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>fixture()};}});
 assert.equal(calls.length,1);assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.headers,undefined);assert.equal(calls[0].options.credentials,'omit');assert.equal(new URL(calls[0].url).hostname,'ur-smart-satellite.alialbatekh111.workers.dev');assert.equal(weather.fetched_at,new Date(NOW).toISOString());
 await assert.rejects(fetchWeather({latitude:33,longitude:44,fetchImpl:async()=>({ok:false,status:429})}),/حد الطلبات/);
 await assert.rejects(fetchWeather({latitude:33,longitude:44,fetchImpl:async()=>({ok:false,status:503})}),/HTTP 503/);
 await assert.rejects(fetchWeather({latitude:33,longitude:44,fetchImpl:async()=>({ok:true,json:async()=>{throw new SyntaxError('external response')}})}),/استجابة/);
 let fetched=false;await assert.rejects(fetchWeather({latitude:null,longitude:44,fetchImpl:async()=>{fetched=true}}));assert.equal(fetched,false);
});

test('timeouts and external cancellation reject without returning old or partial data',async()=>{
 const waitForAbort=async(url,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{const error=Error('fixture cancelled');error.name='AbortError';reject(error)},{once:true});});
 await assert.rejects(fetchWeather({latitude:33,longitude:44,timeoutMs:5,fetchImpl:waitForAbort}),error=>error.name==='AbortError'&&/مهلة/.test(error.message));
 const controller=new AbortController();const request=fetchWeather({latitude:33,longitude:44,signal:controller.signal,fetchImpl:waitForAbort});controller.abort();await assert.rejects(request,error=>error.name==='AbortError');
 let fetched=false;await assert.rejects(fetchWeather({latitude:33,longitude:44,signal:controller.signal,fetchImpl:async()=>{fetched=true}}),error=>error.name==='AbortError');assert.equal(fetched,false);
});

function rainPeriod(index,amount,{hours=1,probability=null}={}){
 const base=Date.parse('2026-10-27T09:00:00Z'),start=new Date(base+index*3600000).toISOString().slice(0,19),end=new Date(base+(index+hours)*3600000).toISOString().slice(0,19);
 return {start,end,precipitation_mm:amount,rain_probability_percent:probability,interval_seconds:hours*3600,weather_code:amount>0?61:3};
}
function rainFixture(amounts=Array(24).fill(0)){
 const data=fixture();data.hourly.interval=[3600,3600,3600];
 data.precipitation_periods=amounts.map((amount,i)=>rainPeriod(i,amount));
 data.rain_forecast={start:'2026-10-27T09:00:00',end:'2026-10-28T09:00:00',precipitation_mm:999,covered_hours:999,complete:true,search_limit_end:'2026-11-03T09:00:00'};
 return data;
}

test('rain summary gives actual24-hour quantity and a dated wet period without requiring unavailable probability',()=>{
 const data=rainFixture();data.precipitation_periods[2]=rainPeriod(2,8);
 const result=normalizeWeather(data,{now:NOW}),rain=result.rain_forecast;
 assert.equal(rain.precipitation_mm,8);assert.equal(rain.known_precipitation_mm,8);assert.equal(rain.covered_hours,24);assert.equal(rain.complete,true);
 assert.equal(rain.start,'2026-10-27T09:00:00');assert.equal(rain.end,'2026-10-28T09:00:00');assert.equal(rain.next_rain.start,'2026-10-27T11:00:00');assert.equal(rain.next_rain.end,'2026-10-27T12:00:00');
 assert.equal(rain.rain_probability_percent_max,null);assert.equal(rain.next_rain.rain_probability_percent,null);
 assert.ok(result.alerts.some(row=>row.kind==='rain'));
});

test('complete dry, partial dry and entirely missing precipitation are distinct states',()=>{
 let data=rainFixture(),rain=normalizeWeather(data,{now:NOW}).rain_forecast;
 assert.equal(rain.complete,true);assert.equal(rain.precipitation_mm,0);assert.equal(rain.next_rain,null);
 data.precipitation_periods[0].precipitation_mm=null;rain=normalizeWeather(data,{now:NOW}).rain_forecast;
 assert.equal(rain.complete,false);assert.equal(rain.precipitation_mm,null);assert.equal(rain.known_precipitation_mm,0);assert.equal(rain.covered_hours,23);
 data=rainFixture(Array(24).fill(null));rain=normalizeWeather(data,{now:NOW}).rain_forecast;
 assert.equal(rain.complete,false);assert.equal(rain.precipitation_mm,null);assert.equal(rain.known_precipitation_mm,null);assert.equal(rain.covered_hours,0);
});

test('an unknown initial forecast gap is not shifted away when deriving the24-hour total',()=>{
 const data=rainFixture();data.precipitation_periods.shift();data.precipitation_periods[1]=rainPeriod(2,2);
 const rain=normalizeWeather(data,{now:NOW}).rain_forecast;
 assert.equal(rain.start,'2026-10-27T09:00:00');assert.equal(rain.covered_hours,23);assert.equal(rain.precipitation_mm,null);assert.equal(rain.known_precipitation_mm,2);
});

test('six-hour accumulations keep their period and are counted once rather than rendered as hourly rates',()=>{
 const data=rainFixture();data.precipitation_periods=[rainPeriod(0,1,{hours:6}),rainPeriod(6,0,{hours:6}),rainPeriod(12,2,{hours:6}),rainPeriod(18,4,{hours:6})];
 data.hourly.interval[2]=21600;data.hourly.interval_end=[undefined,undefined,'2026-10-27T15:00:00'];
 const result=normalizeWeather(data,{now:NOW}),rain=result.rain_forecast;
 assert.equal(rain.complete,true);assert.equal(rain.covered_hours,24);assert.equal(rain.precipitation_mm,7);assert.equal(rain.periods.length,4);assert.equal(rain.next_rain.interval_seconds,21600);
 assert.equal(result.hourly[1].interval_seconds,21600);assert.equal(result.hourly[1].end_time,'2026-10-27T15:00:00');
});

test('a period crossing the24-hour boundary is not prorated into the total',()=>{
 const data=rainFixture();data.precipitation_periods[23]=rainPeriod(23,100,{hours:6});
 const rain=normalizeWeather(data,{now:NOW}).rain_forecast;
 assert.equal(rain.complete,false);assert.equal(rain.covered_hours,23);assert.equal(rain.known_precipitation_mm,0);assert.equal(rain.precipitation_mm,null);
 assert.equal(rain.next_rain.precipitation_mm,100);assert.equal(rain.next_rain.interval_seconds,21600);
});

test('a later wet period remains visible beyond a complete dry24-hour window',()=>{
 const data=rainFixture();data.precipitation_periods.push(rainPeriod(36,4,{hours:6}));
 const result=normalizeWeather(data,{now:NOW}),rain=result.rain_forecast;
 assert.equal(rain.complete,true);assert.equal(rain.precipitation_mm,0);assert.equal(rain.next_rain.start,'2026-10-28T21:00:00');assert.equal(rain.next_rain.end,'2026-10-29T03:00:00');
 assert.equal(result.precipitation_periods.at(-1).precipitation_mm,4);
});

test('overlaps and false upstream summary fields cannot double-count rain or invent full coverage',()=>{
 const data=rainFixture();data.precipitation_periods[2]=rainPeriod(2,8);data.precipitation_periods.push(rainPeriod(2,900),{start:'invalid',end:'invalid',precipitation_mm:900});
 let rain=normalizeWeather(data,{now:NOW}).rain_forecast;assert.equal(rain.precipitation_mm,8);assert.equal(rain.covered_hours,24);
 data.precipitation_periods[0].precipitation_mm=-1;rain=normalizeWeather(data,{now:NOW}).rain_forecast;assert.equal(rain.precipitation_mm,null);assert.equal(rain.covered_hours,23);
});

test('legacy missing intervals do not invent accumulation duration or turn missing rain into zero',()=>{
 const data=fixture();data.hourly.precipitation_probability.fill(null);const result=normalizeWeather(data,{now:NOW});
 assert.ok(result.hourly.every(row=>row.interval_seconds===null&&row.end_time===null));assert.equal(result.rain_forecast.precipitation_mm,null);assert.equal(result.rain_forecast.known_precipitation_mm,null);
 assert.equal(result.rain_forecast.rain_probability_percent_max,null);
});

test('source-provided interval probabilities are retained only as actual period maxima',()=>{
 const data=rainFixture();data.precipitation_periods[2]=rainPeriod(2,8,{probability:70});data.precipitation_periods[3]=rainPeriod(3,0,{probability:101});
 const rain=normalizeWeather(data,{now:NOW}).rain_forecast;assert.equal(rain.rain_probability_percent_max,70);assert.equal(rain.next_rain.rain_probability_percent,70);assert.equal(rain.periods[3].rain_probability_percent,null);
});


test('an ongoing six-hour source period cannot suppress finer future precipitation periods',()=>{
 const data=rainFixture();data.precipitation_periods[1]=rainPeriod(1,2);
 data.precipitation_periods.unshift({start:'2026-10-27T08:00:00',end:'2026-10-27T14:00:00',precipitation_mm:100,interval_seconds:21600});
 const rain=normalizeWeather(data,{now:NOW}).rain_forecast;
 assert.equal(rain.complete,true);assert.equal(rain.covered_hours,24);assert.equal(rain.precipitation_mm,2);assert.equal(rain.next_rain.start,'2026-10-27T10:00:00');
});
