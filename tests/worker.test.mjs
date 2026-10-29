import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../satellite-backend/worker.js',import.meta.url),'utf8');
const worker=(await import('../satellite-backend/worker.js')).default;
test('worker rejects unauthorized origin and missing configuration',async()=>{
 let r=await worker.fetch(new Request('https://worker.test',{method:'POST',headers:{Origin:'https://other.test'}}),{});assert.equal(r.status,403);
 r=await worker.fetch(new Request('https://worker.test',{method:'POST'}),{});assert.equal(r.status,503);
 r=await worker.fetch(new Request('https://worker.test',{method:'POST'}),{SENTINEL_CLIENT_ID:'x',SENTINEL_CLIENT_SECRET:'x',SUPABASE_URL:'https://test',SUPABASE_PUBLISHABLE_KEY:'public'});assert.equal(r.status,401);
});
test('indicator scripts request SCL and mask cloud pixels',()=>{
 const start=source.indexOf('script=`//VERSION=3'),end=source.indexOf('`;\n   }else',start);
 const template=source.slice(start+'script=`'.length,end).replace('${expression}','(s.B08-s.B04)/(s.B08+s.B04)').replace('${JSON.stringify(requiredBands)}','["B08","B04"]').replace('${scaleExpression}','(v+0.2)/1');
 const context=vm.createContext({});vm.runInContext(template,context);
 assert.ok(context.setup().input[0].bands.includes('SCL'));
 assert.equal(context.evaluatePixel({B08:.6,B04:.2,dataMask:1,SCL:9})[3],0);
 assert.equal(context.evaluatePixel({B08:.6,B04:.2,dataMask:1,SCL:4})[3],255);
});
test('statistics use UTC calendar days matching image requests',async()=>{
 const originalFetch=globalThis.fetch,requests=[];
 const json=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
 globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return json({id:'owner'});
  if(url.includes('/rest/v1/field_boundaries'))return json([{owner_id:'owner',area_m2:10000,geometry:{type:'Polygon',coordinates:[[[44,33],[44.001,33],[44.001,33.001],[44,33.001],[44,33]]]}}]);
  if(url.includes('/openid-connect/token'))return json({access_token:'test-token'});
  if(url.endsWith('/statistics/v1')){requests.push(JSON.parse(options.body));return json({data:[{interval:{from:'2026-10-23T00:00:00Z'},outputs:{indices:{bands:{B0:{stats:{mean:.5,sampleCount:10,noDataCount:0}},B1:{stats:{mean:.2}}}}}}],geometryPixelCount:10});}
  throw Error('Unexpected upstream request');
 };
 try{
  const r=await worker.fetch(new Request('https://worker.test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({field_id:'11111111-1111-4111-8111-111111111111'})}),{SENTINEL_CLIENT_ID:'test',SENTINEL_CLIENT_SECRET:'test',SUPABASE_URL:'https://supabase.test',SUPABASE_PUBLISHABLE_KEY:'public'});
  assert.equal(r.status,200);const result=await r.json();assert.equal(result.date,'2026-10-23T00:00:00Z');
  assert.match(requests[0].aggregation.timeRange.from,/T00:00:00\.000Z$/);
  assert.equal(requests[0].aggregation.aggregationInterval.lastIntervalBehavior,'SHORTEN');
 }finally{globalThis.fetch=originalFetch;}
});

test('Gemini endpoints are independent of Sentinel credentials and preserve CORS',async()=>{
 const r=await worker.fetch(new Request('https://worker.test/advice/status',{headers:{Origin:'https://urfarmiq.github.io'}}),{});
 assert.equal(r.status,200);assert.equal((await r.json()).available,false);assert.equal(r.headers.get('access-control-allow-origin'),'https://urfarmiq.github.io');
 const denied=await worker.fetch(new Request('https://worker.test/advice/status',{headers:{Origin:'https://other.test'}}),{});assert.equal(denied.status,403);
 const post=await worker.fetch(new Request('https://worker.test/advice',{method:'POST',body:'{}'}),{});assert.equal(post.status,503);assert.ok((await post.json()).code.startsWith('GEMINI_'));
});

const validId='11111111-1111-4111-8111-111111111111';
const validGeometry={type:'Polygon',coordinates:[[[44,33],[44.001,33],[44.001,33.001],[44,33.001],[44,33]]]};
const environment={SENTINEL_CLIENT_ID:'test-client',SENTINEL_CLIENT_SECRET:'private-server-secret',SUPABASE_URL:'https://supabase.test',SUPABASE_PUBLISHABLE_KEY:'public'};
const asJson=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const satelliteRequest=(body,headers={})=>new Request('https://worker.test',{method:'POST',headers:{Authorization:'Bearer fixture-user',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
async function fixture(body,{geometry=validGeometry,area=10000,upstream}={}){
 const old=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});
  if(upstream){const custom=await upstream(url,options);if(custom)return custom;}
  if(url.endsWith('/auth/v1/user'))return asJson({id:'owner'});
  if(url.includes('/rest/v1/field_boundaries'))return asJson([{owner_id:'owner',area_m2:area,geometry}]);
  if(url.includes('/openid-connect/token'))return asJson({access_token:'private-upstream-token'});
  if(url.endsWith('/statistics/v1'))return asJson({data:[]});
  throw Error('unexpected fixture request');
 };
 try{return {response:await worker.fetch(body instanceof Request?body:satelliteRequest(body),environment),calls};}
 finally{globalThis.fetch=old;}
}

test('satellite parser bounds actual and declared body sizes before upstream calls',async()=>{
 for(const request of [satelliteRequest('x'.repeat(4097)),satelliteRequest('{}',{'content-length':'9000'})]){
  const {response,calls}=await fixture(request);assert.equal(response.status,413);assert.equal(calls.length,0);
 }
 const {response,calls}=await fixture({field_id:validId,padding:'x'.repeat(5000)});assert.equal(response.status,413);assert.equal(calls.length,0);
});

test('malformed objects, loose UUIDs and unsupported actions fail as400 without API traffic',async()=>{
 for(const body of ['{broken','null','[]',{}, {field_id:'11111111----------------------------'}, {field_id:validId,action:'unexpected'}, {field_id:validId,action:'imagery',map_date:'2026-02-30'}, {field_id:validId,action:'imagery',map_date:new Date().toISOString().slice(0,10),map_index:'unsafe-index'}]){
  const {response,calls}=await fixture(body);assert.equal(response.status,400,JSON.stringify(body));assert.equal(calls.length,0);
 }
});

test('all rings and finite WGS84 coordinates are validated before satellite authentication',async()=>{
 const invalid=[
  {type:'Polygon',coordinates:[[[44,33],[44.001,33],[44.001,33.001],[44,33.001]]]},
  {type:'Polygon',coordinates:[validGeometry.coordinates[0],[[44,33],[44.0001,33],[44.0001,33.0001],[44.0001,33.0002]]]},
  {type:'Polygon',coordinates:[[[181,33],[44.001,33],[44.001,33.001],[181,33]]]},
  {type:'Polygon',coordinates:[[[44,null],[44.001,33],[44.001,33.001],[44,null]]]},
  '{private-invalid-geometry',
 ];
 for(const geometry of invalid){const {response,calls}=await fixture({field_id:validId},{geometry});assert.equal(response.status,400);assert.ok(!calls.some(call=>call.url.includes('/openid-connect/token')));assert.ok(!(await response.text()).includes('private-invalid-geometry'));}
});

test('stored area cannot authorize a huge polygon or oversized projected bounds',async()=>{
 const large={type:'Polygon',coordinates:[[[44,33],[44.1,33],[44.1,33.1],[44,33.1],[44,33]]]};
 const sparse={type:'Polygon',coordinates:[[[44,33],[44.1,33],[44.1,33.001],[44.001,33.001],[44.001,33.1],[44,33.1],[44,33]]]};
 for(const geometry of [large,sparse]){const {response,calls}=await fixture({field_id:validId},{geometry,area:1});assert.equal(response.status,413);assert.ok(!calls.some(call=>call.url.includes('/openid-connect/token')));}
 const ring=Array.from({length:4096},(_,i)=>[44+Math.cos(i/4096*Math.PI*2)*.001,33+Math.sin(i/4096*Math.PI*2)*.001]);ring.push(ring[0]);
 const {response,calls}=await fixture({field_id:validId},{geometry:{type:'Polygon',coordinates:[ring]}});assert.equal(response.status,413);assert.ok(!calls.some(call=>call.url.includes('/openid-connect/token')));
});

test('upstream deadlines produce safe504 and provider errors never echo private bodies',async()=>{
 let result=await fixture({field_id:validId},{upstream:async url=>{if(url.endsWith('/auth/v1/user'))throw new DOMException('private-server-secret','TimeoutError');}});
 assert.equal(result.response.status,504);assert.ok(!(await result.response.text()).includes('private-server-secret'));
 result=await fixture({field_id:validId},{upstream:async url=>url.endsWith('/statistics/v1')?new Response('private-upstream-token',{status:502}):null});
 assert.equal(result.response.status,502);assert.ok(!(await result.response.text()).includes('private-upstream-token'));
 result=await fixture({field_id:validId,action:'imagery',map_date:new Date().toISOString().slice(0,10),map_index:'NDVI'},{upstream:async url=>url.endsWith('/process/v1')?new Response('private-upstream-token',{status:503}):null});
 assert.equal(result.response.status,502);assert.ok(!(await result.response.text()).includes('private-upstream-token'));
 for(const call of result.calls)assert.ok(call.options.signal instanceof AbortSignal,'each upstream fetch has a deadline');
 assert.equal(result.response.headers.get('x-content-type-options'),'nosniff');assert.equal(result.response.headers.get('cache-control'),'no-store');
});

test('foreign preflights are denied and allowed preflights retain required CORS headers',async()=>{
 const denied=await worker.fetch(new Request('https://worker.test',{method:'OPTIONS',headers:{Origin:'https://other.test'}}),environment);assert.equal(denied.status,403);
 const allowed=await worker.fetch(new Request('https://worker.test',{method:'OPTIONS',headers:{Origin:'https://urfarmiq.github.io'}}),environment);assert.equal(allowed.status,204);assert.equal(allowed.headers.get('access-control-allow-origin'),'https://urfarmiq.github.io');assert.match(allowed.headers.get('access-control-allow-headers'),/Authorization/);
});

const researchOwner='22222222-2222-4222-8222-222222222222';
const researchOrder='33333333-3333-4333-8333-333333333333';
const researchRun='44444444-4444-4444-8444-444444444444';
const researchOrigin='https://ur-smart-urfarmiq.pages.dev';
const researchEnvironment={...environment,GEMINI_API_KEY:'private-gemini-fixture-secret',GEMINI_FREE_TIER_CONFIRMED:'true'};
const researchNarrative={summary:'المسودة جاهزة لمراجعة مختص.',methodology:['حُسبت الإحصاءات من البيانات المرفوعة.'],interpretation:['تصف القيم العينة المتاحة فقط.'],limitations:['تحتاج النتائج إلى مراجعة ملاءمة التصميم التجريبي.'],next_steps:['راجع جودة البيانات ومشهد الأقمار الصناعية.']};
const researchRequest=()=>new Request('https://worker.test/research',{method:'POST',headers:{Origin:researchOrigin,Authorization:'Bearer fixture-research-owner','Content-Type':'application/json'},body:JSON.stringify({order_id:researchOrder,consent:true,csv:'yield\n1\n3\n5',value_column:'yield',field_id:validId})});
async function researchFixture(run,{pending=false,foreignBoundary=false}={}){
 const old=globalThis.fetch,calls=[],unexpected=[];
 globalThis.fetch=async(url,options={})=>{
  const href=String(url);calls.push({url:href,options});
  if(href.endsWith('/auth/v1/user'))return asJson({id:researchOwner});
  if(href.includes('/rest/v1/research_orders?'))return asJson([{id:researchOrder,owner_id:researchOwner,topic:'دراسة وصفية لمحصول الحنطة',task_type:'combined',status:pending?'waiting_payment':'approved',approved_at:pending?null:'2026-10-28T10:00:00Z'}]);
  if(href.endsWith('/rpc/claim_research_order'))return asJson({id:researchOrder,run_token:researchRun,topic:'دراسة وصفية لمحصول الحنطة',task_type:'combined',attempt_count:1});
  if(href.endsWith('/rpc/finish_research_order')){const body=JSON.parse(options.body);return asJson({id:researchOrder,status:body.p_status,result_status:body.p_status});}
  if(href.includes('/rest/v1/field_boundaries'))return asJson([{owner_id:foreignBoundary?'another-owner':researchOwner,area_m2:10000,geometry:validGeometry}]);
  if(href.includes('/openid-connect/token'))return asJson({access_token:'private-upstream-token'});
  if(href.endsWith('/statistics/v1'))return asJson({data:[{interval:{from:'2026-10-23T00:00:00Z'},outputs:{indices:{bands:{B0:{stats:{mean:.47,sampleCount:10,noDataCount:2}},B1:{stats:{mean:.18}}}}}}],geometryPixelCount:10});
  if(href.startsWith('https://generativelanguage.googleapis.com/'))return asJson({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(researchNarrative)}]}}]});
  unexpected.push(href);throw Error('unexpected research fixture URL');
 };
 try{return await run(calls);}finally{globalThis.fetch=old;assert.deepEqual(unexpected,[]);}
}

test('research routes expose free-tier readiness independently of satellite credentials and retain CORS',async()=>{
 const env={SUPABASE_URL:environment.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:'public',GEMINI_API_KEY:'private-gemini-fixture-secret',GEMINI_FREE_TIER_CONFIRMED:'true'};
 const response=await worker.fetch(new Request('https://worker.test/research/status',{headers:{Origin:researchOrigin}}),env);
 assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),researchOrigin);
 const status=await response.json();assert.equal(status.available,true);assert.equal(status.fee_iqd,25000);assert.equal(status.manual_admin_approval_required,true);assert.ok(!JSON.stringify(status).includes(env.GEMINI_API_KEY));
 const get=await worker.fetch(new Request('https://worker.test/research',{headers:{Origin:researchOrigin}}),env);assert.equal(get.status,405);assert.equal(get.headers.get('access-control-allow-origin'),researchOrigin);
});

test('research route blocks foreign origins, missing sessions and pending payment before claims or providers',async()=>{
 await researchFixture(async calls=>{
  const denied=await worker.fetch(new Request('https://worker.test/research',{method:'POST',headers:{Origin:'https://foreign.example'},body:'{}'}),researchEnvironment);assert.equal(denied.status,403);assert.equal(calls.length,0);
  const missing=await worker.fetch(new Request('https://worker.test/research',{method:'POST',headers:{Origin:researchOrigin},body:'{}'}),researchEnvironment);assert.equal(missing.status,401);assert.equal(calls.length,0);
  const pending=await worker.fetch(researchRequest(),researchEnvironment);assert.equal(pending.status,403);assert.equal((await pending.json()).code,'ORDER_NOT_APPROVED');
  assert.equal(calls.length,2);assert.ok(calls.every(call=>call.url.includes('/auth/v1/user')||call.url.includes('/rest/v1/research_orders?')));
 },{pending:true});
});

test('approved research executes the real internal satellite route and persists actual maps and calculated CSV values',async()=>{
 await researchFixture(async calls=>{
  const response=await worker.fetch(researchRequest(),researchEnvironment);assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),researchOrigin);
  const body=await response.json();assert.equal(body.status,'completed');assert.equal(body.draft,true);assert.equal(body.result.analysis.descriptive.mean,3);assert.equal(body.result.analysis.descriptive.sd,2);
  assert.equal(body.result.maps.field_id,validId);assert.equal(body.result.maps.indices.NDVI,.47);assert.equal(body.result.maps.indices.NDMI,.18);assert.equal(body.result.maps.valid_pixels,8);assert.equal(body.result.maps.coverage_percent,80);assert.deepEqual(body.result.maps.geometry,validGeometry);
  assert.equal(calls.filter(call=>call.url.endsWith('/auth/v1/user')).length,2,'both research and the internal satellite path validate the owner session');
  const databaseCalls=calls.filter(call=>call.url.startsWith(environment.SUPABASE_URL));assert.ok(databaseCalls.every(call=>call.options.headers.Authorization==='Bearer fixture-research-owner'));
  const boundary=new URL(calls.find(call=>call.url.includes('/field_boundaries?')).url);assert.equal(boundary.searchParams.get('field_id'),'eq.'+validId);
  const statistics=JSON.parse(calls.find(call=>call.url.endsWith('/statistics/v1')).options.body);assert.equal(statistics.input.data[0].type,'sentinel-2-l2a');assert.match(statistics.aggregation.timeRange.from,/T00:00:00\.000Z$/);
  const finished=JSON.parse(calls.find(call=>call.url.endsWith('/rpc/finish_research_order')).options.body);assert.equal(finished.p_order_id,researchOrder);assert.equal(finished.p_run_token,researchRun);assert.equal(finished.p_status,'completed');assert.deepEqual(finished.p_result,body.result);
  const generated=JSON.parse(calls.find(call=>call.url.startsWith('https://generativelanguage.googleapis.com/')).options.body);const evidence=JSON.parse(generated.contents[0].parts[0].text);assert.equal(evidence.satellite.indices.NDVI,.47);assert.equal(evidence.computed_analysis.descriptive.mean,3);assert.equal(evidence.satellite.geometry,undefined);assert.equal(evidence.satellite.field_id,undefined);assert.ok(!JSON.stringify(evidence).includes('yield\n1\n3\n5'));
  for(const secret of [researchEnvironment.GEMINI_API_KEY,environment.SENTINEL_CLIENT_SECRET,'private-upstream-token','fixture-research-owner',researchRun])assert.ok(!JSON.stringify(body).includes(secret));
 });
});

test('research internal map routing rejects another owner boundary without satellite credentials or invented maps',async()=>{
 await researchFixture(async calls=>{
  const response=await worker.fetch(researchRequest(),researchEnvironment);assert.equal(response.status,200);const body=await response.json();assert.equal(body.status,'needs_review');assert.equal(body.result.maps,null);assert.equal(body.result.analysis.descriptive.mean,3);
  assert.ok(!calls.some(call=>call.url.includes('/openid-connect/token')||call.url.endsWith('/statistics/v1')));
  const finished=JSON.parse(calls.find(call=>call.url.endsWith('/rpc/finish_research_order')).options.body);assert.equal(finished.p_status,'needs_review');assert.equal(finished.p_result.maps,null);
 },{foreignBoundary:true});
});
