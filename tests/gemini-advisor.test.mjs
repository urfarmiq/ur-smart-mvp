import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleGeminiAdvice,geminiStatus,DEFAULT_GEMINI_MODEL} from '../satellite-backend/gemini-advisor.mjs';

const FIELD='11111111-1111-4111-8111-111111111111';
const ENV={SUPABASE_URL:'https://supabase.test',SUPABASE_PUBLISHABLE_KEY:'public',GEMINI_API_KEY:'test-secret-never-output',GEMINI_FREE_TIER_CONFIRMED:'true'};
const output={summary:'تحتاج البيانات إلى تحقق ميداني.',evidence:['NDVI مسجل'],missing_data:['تحليل التربة'],irrigation:['افحص الجذور أولًا'],fertilization:['راجع التحليل'],follow_up:['سجّل الزيارة'],limitations:['إرشادي']};
const report={field:{name:'private field name',crop:'forged crop',area_donum:999,owner_id:'private-account'},satellite:{date:'2026-10-20',indices:{NDVI:.99,NDMI:null},geometry:{private:true}},weather:{source:'Open-Meteo',daily:[{date:'2026-10-25',precipitation_mm:null,et0_mm:0}],summary:{past_rain_mm:null}},irrigation_logs:[{irrigated_at:'2026-10-24T00:00:00Z',water_depth_mm:500}],observations:{growth_stage:'الإزهار'},access_token:'private-session',geometry:{private:true}};
const request=(body={field_id:FIELD,report,consent:true},headers={})=>new Request('https://worker.test/advice',{method:'POST',headers:{Authorization:'Bearer test-user-token','Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
let sequence=0;
async function mocked(run,{owner=true,authStatus=200,upstreamStatus=200,modelOutput=output,finishReason='STOP',stored=true,networkFailure=false}={}){
 const original=globalThis.fetch,calls=[],user='owner-'+(++sequence);
 globalThis.fetch=async(url,options={})=>{
  const href=String(url);calls.push({url:href,options});
  if(href.endsWith('/auth/v1/user'))return json({id:user},authStatus);
  if(href.includes('/rest/v1/fields?'))return json(owner?[{id:FIELD,crop:'حنطة',area_donum:4,soil:'طينية',irrigation:'تنقيط',farms:{owner_id:user}}]:[]);
  if(href.includes('/rest/v1/satellite_observations?'))return json(stored?[{acquisition_date:'2026-10-20',indices:{NDVI:.4,NDMI:null},valid_pixels:20,geometry_pixels:25,coverage_percent:80,source:'Sentinel-2 L2A'}]:[]);
  if(href.includes('/rest/v1/field_irrigation_logs?'))return json([]);
  if(href.startsWith('https://generativelanguage.googleapis.com/')){
   if(networkFailure)throw Error(ENV.GEMINI_API_KEY);
   if(upstreamStatus!==200)return json({error:{message:ENV.GEMINI_API_KEY}},upstreamStatus);
   return json({candidates:[{finishReason,content:{parts:[{text:typeof modelOutput==='string'?modelOutput:JSON.stringify(modelOutput)}]}}]});
  }
  throw Error('unexpected upstream call '+href);
 };
 try{return await run(calls);}finally{globalThis.fetch=original;}
}

test('missing setup and unconfirmed free tier never call Google',async()=>{
 let r=await handleGeminiAdvice(request(),{});assert.equal(r.status,503);assert.equal((await r.json()).code,'GEMINI_FREE_TIER_CONFIRMATION_REQUIRED');
 r=await handleGeminiAdvice(request(),{...ENV,GEMINI_API_KEY:''});assert.equal(r.status,503);assert.equal((await r.json()).code,'GEMINI_SETUP_REQUIRED');
 assert.equal(geminiStatus(ENV).model,DEFAULT_GEMINI_MODEL);assert.equal(geminiStatus({...ENV,GEMINI_MODEL:'gemini-3-pro'}).available,false);
 assert.ok(!JSON.stringify(geminiStatus(ENV)).includes(ENV.GEMINI_API_KEY));
});
test('requires a valid session, ownership, consent and bounded JSON',async()=>{
 let r=await handleGeminiAdvice(new Request('https://worker.test/advice',{method:'POST',body:'{}'}),ENV);assert.equal(r.status,401);
 await mocked(async calls=>{r=await handleGeminiAdvice(request(),ENV);assert.equal(r.status,401);assert.equal(calls.length,1);},{authStatus:401});
 await mocked(async calls=>{r=await handleGeminiAdvice(request(),ENV);assert.equal(r.status,404);assert.ok(calls.every(c=>!c.url.includes('googleapis')));},{owner:false});
 await mocked(async calls=>{r=await handleGeminiAdvice(request({field_id:FIELD,report,consent:false}),ENV);assert.equal(r.status,400);assert.ok(calls.every(c=>!c.url.includes('googleapis')));});
 await mocked(async()=>{r=await handleGeminiAdvice(request('not JSON'),ENV);assert.equal(r.status,400);});
 await mocked(async()=>{r=await handleGeminiAdvice(request('x'.repeat(121*1024)),ENV);assert.equal(r.status,413);});
});
test('verified field and stored scene override client data; personal fields and secrets are not forwarded',async()=>{
 await mocked(async calls=>{
  const r=await handleGeminiAdvice(request(),ENV);assert.equal(r.status,200);const result=await r.json();assert.equal(result.provider,'Google Gemini');assert.deepEqual(result.recommendation,output);
  const google=calls.find(c=>c.url.includes('googleapis'));assert.equal(google.options.headers['x-goog-api-key'],ENV.GEMINI_API_KEY);assert.ok(!google.url.includes(ENV.GEMINI_API_KEY));
  const body=JSON.parse(google.options.body),sent=JSON.parse(body.contents[0].parts[0].text);
  assert.equal(sent.field.crop,'حنطة');assert.equal(sent.field.area_donum,4);assert.equal(sent.satellite.indices.NDVI,.4);assert.equal(sent.satellite.series[0].indices.NDVI,.4);assert.equal(sent.satellite.indices.NDMI,null);assert.equal(sent.weather.daily[0].precipitation_mm,null);assert.equal(sent.weather.daily[0].et0_mm,0);assert.equal(sent.irrigation_logs.length,0);
  for(const value of ['private field name','private-account','private-session',FIELD,ENV.GEMINI_API_KEY])assert.ok(!google.options.body.includes(value));
  assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.tools,undefined);assert.ok(sent.source_verification.satellite.startsWith('Supabase'));
  assert.ok(calls.filter(c=>c.url.includes('/rest/v1/')).every(c=>c.options.headers.Authorization==='Bearer test-user-token'));
 });
});
test('free quota, rejected keys and network failures return safe errors without fallback',async()=>{
 for(const [status,expected] of [[429,429],[403,502],[500,502]])await mocked(async calls=>{const r=await handleGeminiAdvice(request(),ENV);assert.equal(r.status,expected);const raw=await r.text();assert.ok(!raw.includes(ENV.GEMINI_API_KEY));assert.equal(calls.filter(c=>c.url.includes('googleapis')).length,1);},{upstreamStatus:status});
 await mocked(async()=>{const r=await handleGeminiAdvice(request(),ENV);assert.equal(r.status,502);assert.ok(!(await r.text()).includes(ENV.GEMINI_API_KEY));},{networkFailure:true});
});
test('invalid, truncated or empty model output is not shown as a successful recommendation',async()=>{
 for(const data of [{modelOutput:'not JSON'},{modelOutput:{summary:'only summary'}},{finishReason:'MAX_TOKENS'},{modelOutput:{...output,summary:''}}])await mocked(async()=>{const r=await handleGeminiAdvice(request(),ENV);assert.equal(r.status,502);assert.equal((await r.json()).code,'GEMINI_INVALID_OUTPUT');},data);
});
test('warm-instance throttling blocks rapid repeated requests from the same authenticated user',async()=>{
 await mocked(async calls=>{let r=await handleGeminiAdvice(request(),ENV);assert.equal(r.status,200);r=await handleGeminiAdvice(request(),ENV);assert.equal(r.status,429);assert.equal((await r.json()).code,'ADVICE_BUSY');assert.equal(calls.filter(c=>c.url.includes('googleapis')).length,1);});
});
test('malformed nested report content is rejected safely',async()=>{
 await mocked(async()=>{const r=await handleGeminiAdvice(request({field_id:FIELD,consent:true,report:{weather:{daily:[null]}}}),ENV);assert.equal(r.status,400);assert.equal((await r.json()).code,'INVALID_REPORT');});
});
