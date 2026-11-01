import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../satellite-backend/worker.js';

const FIELD='11111111-1111-4111-8111-111111111111';
const OWNER='22222222-2222-4222-8222-222222222222';
const ORDER='33333333-3333-4333-8333-333333333333';
const OTHER='44444444-4444-4444-8444-444444444444';
const ORIGIN='https://ur-smart-urfarmiq.pages.dev';
const TODAY=new Date().toISOString().slice(0,10);
const GEOMETRY={type:'Polygon',coordinates:[[[44,33],[44.001,33],[44.001,33.001],[44,33.001],[44,33]]]};
const ENV={SENTINEL_CLIENT_ID:'fixture-private-client',SENTINEL_CLIENT_SECRET:'fixture-private-sentinel-secret',SUPABASE_URL:'https://supabase.test',SUPABASE_PUBLISHABLE_KEY:'fixture-public-key'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const request=(body={field_id:FIELD},{path='/',headers={},url}={})=>new Request(url||'https://worker.test'+path,{method:'POST',headers:{Origin:ORIGIN,Authorization:'Bearer fixture-owner-session','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const paidStatus=()=>({field_id:FIELD,active:true,expires_at:new Date(Date.now()+86400000).toISOString(),order_id:ORDER});
const paidResearch=()=>({id:ORDER,owner_id:OWNER,status:'completed',approved_at:new Date().toISOString(),task_type:'maps',result:{maps:{field_id:FIELD,date:TODAY+'T00:00:00Z'}}});

async function fixture(run,{access=paidStatus(),order=paidResearch(),owner=OWNER,boundaryOwner=OWNER,custom}={}){
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options={})=>{
  const href=String(url);calls.push({url:href,options});
  if(custom){const response=await custom(href,options);if(response)return response;}
  if(href.endsWith('/auth/v1/user'))return json({id:owner,is_anonymous:false});
  if(href.endsWith('/rpc/satellite_access_status'))return json(access);
  if(href.includes('/rest/v1/research_orders?'))return json(order?[order]:[]);
  if(href.includes('/rest/v1/fields?'))return json([{id:FIELD,farms:{owner_id:owner}}]);
  if(href.includes('/rest/v1/field_boundaries?'))return json([{owner_id:boundaryOwner,geometry:GEOMETRY,area_m2:10000}]);
  if(href.includes('/openid-connect/token'))return json({access_token:'fixture-private-upstream-token'});
  if(href.endsWith('/statistics/v1'))return json({data:[{interval:{from:TODAY+'T00:00:00Z'},outputs:{indices:{bands:{B0:{stats:{mean:.5,sampleCount:10,noDataCount:0}},B1:{stats:{mean:.2}}}}}}],geometryPixelCount:10});
  if(href.endsWith('/process/v1'))return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png'}});
  throw Error('Unexpected fixture URL');
 };
 try{return await run(calls);}finally{globalThis.fetch=original;}
}
const providers=calls=>calls.filter(c=>c.url.includes('/openid-connect/token')||c.url.endsWith('/statistics/v1')||c.url.endsWith('/process/v1'));
const entitlements=calls=>calls.filter(c=>c.url.endsWith('/rpc/satellite_access_status'));

test('paid satellite status and allowed preflight are public, secret-free and do not query accounts',async()=>{
 await fixture(async calls=>{
  const response=await worker.fetch(new Request('https://worker.test/satellite/status',{headers:{Origin:ORIGIN}}),ENV),body=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),ORIGIN);
  assert.equal(body.available,true);assert.equal(body.paid_service,true);assert.equal(body.manual_admin_approval_required,true);assert.equal(body.quote_required,true);assert.equal(body.customer_acceptance_required,true);assert.equal(body.field_specific,true);assert.equal(body.automatic_renewal,false);
  for(const secret of [ENV.SENTINEL_CLIENT_ID,ENV.SENTINEL_CLIENT_SECRET])assert.ok(!JSON.stringify(body).includes(secret));
  const preflight=await worker.fetch(new Request('https://worker.test/research/imagery',{method:'OPTIONS',headers:{Origin:ORIGIN}}),ENV);assert.equal(preflight.status,204);assert.deepEqual(calls,[]);
 });
});

test('unpaid statistics and imagery fail before any satellite provider is contacted',async()=>{
 for(const body of [{field_id:FIELD},{field_id:FIELD,action:'imagery',map_date:TODAY,map_index:'NDVI'}]){
  await fixture(async calls=>{
   const response=await worker.fetch(request(body),ENV),value=await response.json();
   assert.equal(response.status,403);assert.equal(value.code,'SATELLITE_PAYMENT_REQUIRED');assert.match(value.message,/مدفوعة/);
   assert.equal(response.headers.get('access-control-allow-origin'),ORIGIN);assert.equal(response.headers.get('cache-control'),'no-store');
   assert.equal(entitlements(calls).length,1);assert.deepEqual(JSON.parse(entitlements(calls)[0].options.body),{p_field_id:FIELD});assert.deepEqual(providers(calls),[]);
  },{access:{field_id:FIELD,active:false,expires_at:null,order_id:null}});
 }
});

test('expired, wrong-field, malformed-date and missing-order entitlements cannot authorize imagery',async()=>{
 for(const access of [
  {...paidStatus(),expires_at:new Date(Date.now()-1).toISOString()},
  {...paidStatus(),field_id:OTHER},
  {...paidStatus(),expires_at:'not-a-date'},
  {...paidStatus(),order_id:null},
 ])await fixture(async calls=>{const response=await worker.fetch(request({field_id:FIELD,action:'imagery',map_date:TODAY,map_index:'NDVI'}),ENV);assert.equal(response.status,403);assert.equal((await response.json()).code,'SATELLITE_PAYMENT_REQUIRED');assert.deepEqual(providers(calls),[]);},{access});
});

test('custom paths, internal-looking hostnames, body flags and headers never bypass the payment RPC',async()=>{
 for(const input of [
  request({field_id:FIELD},{path:'/internal-satellite/'}),
  request({field_id:FIELD},{url:'https://internal-satellite/'}),
  request({field_id:FIELD,included:true,paid:true,paidContext:{approved:true}}),
  request({field_id:FIELD},{headers:{'X-Internal-Satellite':'true','X-Paid':'true','X-Research-Order':ORDER}}),
  request({field_id:FIELD},{path:'/not-a-published-endpoint'}),
 ])await fixture(async calls=>{const response=await worker.fetch(input,ENV);assert.equal(response.status,403);assert.equal((await response.json()).code,'SATELLITE_PAYMENT_REQUIRED');assert.equal(entitlements(calls).length,1);assert.deepEqual(providers(calls),[]);},{access:{field_id:FIELD,active:false,expires_at:null,order_id:null}});
});

test('access lookup HTTP errors, invalid JSON, oversized results and fetch failures fail closed safely',async()=>{
 for(const custom of [
  async url=>url.endsWith('/rpc/satellite_access_status')?new Response('fixture-private-sentinel-secret',{status:503}):null,
  async url=>url.endsWith('/rpc/satellite_access_status')?new Response('{bad-json'):null,
  async url=>url.endsWith('/rpc/satellite_access_status')?new Response('x'.repeat(4097)):null,
  async url=>{if(url.endsWith('/rpc/satellite_access_status'))throw Error('fixture-owner-session');},
  async url=>url.endsWith('/rpc/satellite_access_status')?json({active:'true'}):null,
 ])await fixture(async calls=>{const response=await worker.fetch(request(),ENV),body=await response.json();assert.equal(response.status,502);assert.equal(body.code,'SATELLITE_ACCESS_UNAVAILABLE');assert.ok(!JSON.stringify(body).includes('fixture-private'));assert.ok(!JSON.stringify(body).includes('fixture-owner-session'));assert.deepEqual(providers(calls),[]);},{custom});
});

test('a valid paid owned-field entitlement precedes both actual provider branches',async()=>{
 for(const body of [{field_id:FIELD},{field_id:FIELD,action:'imagery',map_date:TODAY,map_index:'NDVI'}])await fixture(async calls=>{
  const response=await worker.fetch(request(body),ENV),result=await response.json();assert.equal(response.status,200);assert.equal(result.field_id,FIELD);assert.equal(entitlements(calls).length,1);assert.ok(calls.indexOf(entitlements(calls)[0])<calls.indexOf(providers(calls)[0]));
  assert.equal(entitlements(calls)[0].options.headers.Authorization,'Bearer fixture-owner-session');assert.equal(entitlements(calls)[0].options.headers.apikey,ENV.SUPABASE_PUBLISHABLE_KEY);
  assert.ok(!JSON.stringify(result).includes(ENV.SENTINEL_CLIENT_SECRET));assert.ok(!JSON.stringify(result).includes('fixture-private-upstream-token'));
 });
});

test('another-owner boundary is rejected before entitlement or provider access',async()=>{
 await fixture(async calls=>{const response=await worker.fetch(request(),ENV);assert.equal(response.status,404);assert.deepEqual(entitlements(calls),[]);assert.deepEqual(providers(calls),[]);},{boundaryOwner:OTHER});
});

test('research image requests require a session, strict order-only body and paid saved maps',async()=>{
 await fixture(async calls=>{
  let response=await worker.fetch(request({order_id:ORDER},{path:'/research/imagery',headers:{Authorization:''}}),ENV);assert.equal(response.status,401);assert.deepEqual(calls,[]);
  for(const body of [{order_id:ORDER,field_id:FIELD},{order_id:ORDER,map_date:TODAY},{order_id:ORDER,map_index:'NDVI'},{order_id:'not-an-order'},[]]){response=await worker.fetch(request(body,{path:'/research/imagery'}),ENV);assert.equal(response.status,400);}
  assert.deepEqual(calls,[]);
 });
 for(const order of [null,{...paidResearch(),owner_id:OTHER},{...paidResearch(),id:OTHER}])await fixture(async calls=>{const response=await worker.fetch(request({order_id:ORDER},{path:'/research/imagery'}),ENV);assert.equal(response.status,404);assert.deepEqual(providers(calls),[]);},{order});
 for(const order of [
  {...paidResearch(),approved_at:null},
  {...paidResearch(),status:'running'},
  {...paidResearch(),task_type:'data'},
 ])await fixture(async calls=>{const response=await worker.fetch(request({order_id:ORDER},{path:'/research/imagery'}),ENV);assert.equal(response.status,403);assert.deepEqual(providers(calls),[]);},{order});
});

test('paid researcher imagery derives the immutable saved field/date and does not require a second broad entitlement',async()=>{
 for(const status of ['completed','needs_review'])await fixture(async calls=>{
  const response=await worker.fetch(request({order_id:ORDER},{path:'/research/imagery'}),ENV),result=await response.json();assert.equal(response.status,200);assert.equal(result.field_id,FIELD);assert.equal(result.date,TODAY);assert.equal(result.index,'NDVI');assert.deepEqual(entitlements(calls),[]);
  const query=new URL(calls.find(c=>c.url.includes('/research_orders?')).url);assert.equal(query.searchParams.get('id'),'eq.'+ORDER);assert.equal(query.searchParams.get('owner_id'),'eq.'+OWNER);
  const boundaryQuery=new URL(calls.find(c=>c.url.includes('/field_boundaries?')).url);assert.equal(boundaryQuery.searchParams.get('field_id'),'eq.'+FIELD);
  const process=JSON.parse(calls.find(c=>c.url.endsWith('/process/v1')).options.body);assert.equal(process.input.data[0].dataFilter.timeRange.from,TODAY+'T00:00:00.000Z');assert.ok(process.evalscript.includes('(s.B08-s.B04)/(s.B08+s.B04)'));
 },{access:{field_id:FIELD,active:false,order_id:null,expires_at:null},order:{...paidResearch(),status}});
});

test('saved paid-image context cannot bypass live field ownership or date validation',async()=>{
 await fixture(async calls=>{const response=await worker.fetch(request({order_id:ORDER},{path:'/research/imagery'}),ENV);assert.equal(response.status,404);assert.deepEqual(providers(calls),[]);},{boundaryOwner:OTHER});
 for(const maps of [null,{field_id:FIELD,date:'2026-02-30'},{field_id:OTHER,date:'not-a-date'},{field_id:null,date:TODAY}])await fixture(async calls=>{const response=await worker.fetch(request({order_id:ORDER},{path:'/research/imagery'}),ENV);assert.equal(response.status,409);assert.deepEqual(providers(calls),[]);},{order:{...paidResearch(),result:{maps}}});
 await fixture(async calls=>{const response=await worker.fetch(request({order_id:ORDER},{path:'/research/imagery'}),ENV);assert.equal(response.status,404);assert.ok(!calls.some(c=>c.url.includes('/field_boundaries?')));assert.deepEqual(providers(calls),[]);},{custom:async url=>url.includes('/rest/v1/fields?')?json([{id:FIELD,farms:{owner_id:OTHER}}]):null});
});
