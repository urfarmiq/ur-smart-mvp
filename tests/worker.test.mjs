import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../satellite-backend/worker.js',import.meta.url),'utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
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
