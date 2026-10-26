import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../field-analysis.html',import.meta.url),'utf8');
const functions=html.slice(html.indexOf('function finiteNumber('),html.indexOf('function setLocalDateTime('));
const guard=html.slice(html.indexOf('function contextIsCurrent('),html.indexOf('function finiteNumber('));
function weatherData(){
 const time=Array.from({length:14},(_,i)=>new Date(Date.UTC(2026,9,18+i)).toISOString().slice(0,10));
 return {daily:{time,precipitation_sum:time.map((_,i)=>i),et0_fao_evapotranspiration:time.map(()=>2),temperature_2m_max:time.map(()=>30)}};
}
test('weather recommendation uses exactly the first three calendar days, not all seven forecast days',()=>{
 const context=vm.createContext({});vm.runInContext(functions,context);
 const summary=context.summarizeWeather(weatherData(),'2026-10-25');
 assert.equal(summary.forecastRain,7+8+9);assert.equal(summary.forecastEt0,6);assert.equal(summary.pastRain,21);assert.equal(summary.pastEt0,14);
 assert.equal(summary.forecastDaysRequested,3);assert.equal(summary.daily.length,14);
});
test('incomplete weather retains null and counts valid observations; genuine zero remains zero',()=>{
 const context=vm.createContext({});vm.runInContext(functions,context);
 const data=weatherData();data.daily.precipitation_sum[8]=null;data.daily.et0_fao_evapotranspiration[7]='';
 let summary=context.summarizeWeather(data,'2026-10-25');assert.equal(summary.forecastRain,null);assert.equal(summary.forecastEt0,null);assert.equal(summary.completeness.forecastRainDays,2);
 data.daily.precipitation_sum.fill(0);data.daily.et0_fao_evapotranspiration.fill(0);summary=context.summarizeWeather(data,'2026-10-25');assert.equal(summary.forecastRain,0);assert.equal(summary.forecastEt0,0);
 assert.equal(context.finiteNumber(null),null);assert.equal(context.finiteNumber(false),null);assert.equal(context.finiteNumber('  '),null);assert.equal(context.finiteNumber('0'),0);
});
function contextHarness(extra={}){
 const context=vm.createContext({...extra});
 vm.runInContext("let selectedField='a',contextLoadToken=1,fieldContext={fieldId:'a',requestToken:1,logs:[],satellite:null};const $=()=>({value:selectedField});"+guard+"globalThis.switchField=(id)=>{selectedField=id;contextLoadToken++;fieldContext={fieldId:id,requestToken:contextLoadToken,logs:[],satellite:null};};globalThis.snapshot=()=>fieldContext;",context);
 return context;
}
test('out-of-order irrigation results cannot change another selected field',async()=>{
 const waiting=[];let renders=0;
 const supabase={from(){const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>new Promise(resolve=>waiting.push(resolve))};return q;}};
 const context=contextHarness({supabase,renderIrrigationLogs:()=>renders++});
 const loader=html.slice(html.indexOf('async function loadIrrigationLogs('),html.indexOf('function renderIrrigationLogs('));vm.runInContext(loader,context);
 const first=context.loadIrrigationLogs('a');context.switchField('b');const second=context.loadIrrigationLogs('b');
 waiting[1]({data:[{id:'b-log'}],error:null});await second;
 waiting[0]({data:[{id:'a-log'}],error:null});await first;
 assert.equal(context.snapshot().fieldId,'b');assert.equal(context.snapshot().logs[0].id,'b-log');assert.equal(renders,1);
});
test('late satellite result neither updates state nor upserts history after switching field',async()=>{
 let resolveFetch,issued,upserts=0;const fetching=new Promise(resolve=>issued=resolve);
 const supabase={auth:{getSession:async()=>({data:{session:{access_token:'fixture',user:{id:'fixture-owner'}}}})},from(){upserts++;throw Error('Unexpected stale upsert');}};
 const context=contextHarness({supabase,SATELLITE_API_URL:'https://fixture.test',AbortSignal,fetch:()=>{issued();return new Promise(resolve=>resolveFetch=resolve);}});
 const loader=html.slice(html.indexOf('async function loadSatelliteContext('),html.indexOf('async function loadSatelliteHistory('));vm.runInContext(loader,context);
 const first=context.loadSatelliteContext('a');await fetching;context.switchField('b');
 resolveFetch({ok:true,json:async()=>({field_id:'a',date:'2026-10-25',indices:{NDVI:.5}})});assert.equal(await first,null);
 assert.equal(context.snapshot().fieldId,'b');assert.equal(context.snapshot().satellite,null);assert.equal(upserts,0);
});

test('switching the field clears observations and hides previous reports and Gemini results',()=>{
 const nodes=new Map();let handoffResets=0,geminiResets=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'previous-field-value',style:{},replaceChildren(){this.cleared=true;}});return nodes.get(id);};
 const context=vm.createContext({$:node,handoff:{resetForField:()=>handoffResets++},geminiAdvisor:{invalidateContext:()=>geminiResets++}});
 const start=html.indexOf('function resetFieldAdvice('),end=html.indexOf("$('savedField').addEventListener('change',resetFieldAdvice)",start);
 vm.runInContext(html.slice(start,end),context);context.resetFieldAdvice();
 for(const id of ['growthStage','plantSymptoms','soilMoisture','notes','irrigationDepth','irrigationDuration','irrigationNote'])assert.equal(node(id).value,'');
 assert.equal(node('adviceResult').cleared,true);assert.equal(node('adviceResult').style.display,'none');assert.equal(node('report').style.display,'none');
 assert.equal(handoffResets,1);assert.equal(geminiResets,1);
});
