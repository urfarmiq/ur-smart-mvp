import test from 'node:test';
import assert from 'node:assert/strict';
import {handleTerrainGateway} from '../satellite-backend/terrain-gateway.mjs';
import worker from '../satellite-backend/worker.js';
const origin='https://ur-smart-urfarmiq.pages.dev';
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-fixture'};
const reply=(body,status=200)=>Response.json(body,{status});
const post=(body='{}',headers={})=>new Request('https://worker.test/terrain',{method:'POST',headers:{Authorization:'Bearer user-fixture',...headers},body});

test('terrain gateway needs a login, configured fixed project and supported method before network access',async()=>{
 let calls=0;const options={reply,origin,fetchImpl:async()=>{calls++;throw Error();}};
 for(const [req,settings,status] of [[post(),{},503],[post(),{...env,SUPABASE_URL:'https://attacker.test'},503],[new Request('https://worker.test/terrain',{method:'POST',body:'{}'}),env,401],[new Request('https://worker.test/terrain'),env,405]]){
  assert.equal((await handleTerrainGateway(req,settings,options)).status,status);
 }
 assert.equal(calls,0);
});
test('terrain gateway bounds actual and declared bodies, including chunked requests',async()=>{
 let calls=0;const options={reply,origin,fetchImpl:async()=>{calls++;}};
 for(const request of [post('{}',{'content-length':'8193'}),post('x'.repeat(8193))])assert.equal((await handleTerrainGateway(request,env,options)).status,413);
 assert.equal(calls,0);
});
test('only the fixed Edge endpoint receives the authenticated body and report streams with private CORS',async()=>{
 let called;const response=await handleTerrainGateway(post('{"field_id":"fixture","url":"https://attacker.test"}'),env,{reply,origin,fetchImpl:async(url,options)=>{called={url,options};return Response.json({report_id:'actual-edge-result',analysis:{status:'completed'}});}});
 assert.equal(called.url,env.SUPABASE_URL+'/functions/v1/terrain-analysis');
 assert.equal(called.options.headers.Authorization,'Bearer user-fixture');assert.equal(called.options.headers.apikey,'public-fixture');
 assert.equal(called.options.redirect,'manual');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),origin);
 assert.equal((await response.json()).report_id,'actual-edge-result');
});
test('public status, private upstream errors and unavailable services do not claim analysis success or expose bodies',async()=>{
 let request;const status=await handleTerrainGateway(new Request('https://worker.test/terrain/status'),env,{reply,origin,fetchImpl:async(url,options)=>{request={url,options};return Response.json({available:true});}});
 assert.equal(status.status,200);assert.ok(request.url.endsWith('/terrain-analysis/status'));assert.equal(request.options.method,'GET');
 const bad=await handleTerrainGateway(post(),env,{reply,origin,fetchImpl:async()=>new Response('private provider credentials',{status:500})});
 assert.equal(bad.status,502);assert.ok(!(await bad.text()).includes('private provider'));
 const denied=await handleTerrainGateway(post(),env,{reply,origin,fetchImpl:async()=>Response.json({error:'FIELD_UNAVAILABLE'},{status:404})});assert.equal(denied.status,404);
 const moved=await handleTerrainGateway(post(),env,{reply,origin,fetchImpl:async()=>new Response(null,{status:302,headers:{Location:'https://other.test'}})});assert.equal(moved.status,502);
 const timeout=await handleTerrainGateway(post(),env,{reply,origin,fetchImpl:async()=>{throw Object.assign(Error('private-secret'),{name:'TimeoutError'});}});assert.equal(timeout.status,504);assert.ok(!(await timeout.text()).includes('private-secret'));
});
test('the existing Worker applies origin denial and preflight rules to terrain before proxying',async()=>{
 const denied=await worker.fetch(post('{}',{Origin:'https://other.test'}),env);assert.equal(denied.status,403);
 const preflight=await worker.fetch(new Request('https://worker.test/terrain',{method:'OPTIONS',headers:{Origin:origin}}),env);assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({available:true});
 try{const status=await worker.fetch(new Request('https://worker.test/terrain/status',{headers:{Origin:origin}}),env);assert.equal(status.status,200);assert.equal((await status.json()).available,true);}finally{globalThis.fetch=original;}
});
