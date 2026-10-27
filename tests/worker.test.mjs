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
