import test from 'node:test';
import assert from 'node:assert/strict';
import {handleTerrain,terrainStatus,createTerrainLimiter} from '../satellite-backend/terrain-service.mjs';
import {analyzeTerrain} from '../terrain-core.mjs';

const USER='11111111-1111-4111-8111-111111111111',FIELD='22222222-2222-4222-8222-222222222222',REPORT='33333333-3333-4333-8333-333333333333',OTHER='44444444-4444-4444-8444-444444444444';
const ENV={SUPABASE_URL:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-test-key',SUPABASE_SERVICE_ROLE_KEY:'private-service-secret-fixture'};
const ORIGIN='https://ur-smart-urfarmiq.pages.dev',STAMP='2026-11-08T14:00:00.000Z';
const POLYGON={type:'Polygon',coordinates:[[[45.5,32.5],[45.502,32.5],[45.502,32.502],[45.5,32.502],[45.5,32.5]]]};
// Deterministic synthetic plane solely for unit tests. Production only reads real provider data.
const RASTER={width:4,height:4,bounds:[45.5,32.5,45.502,32.502],elevations:Array.from({length:16},(_,i)=>30+i%4),source:{id:'copernicus_dsm_glo30',name:'Test-only plane',native_resolution_m:30,resolution_m:55,kind:'DSM'}};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const request=(body={field_id:FIELD},headers={})=>new Request('https://worker.test/terrain',{method:'POST',headers:{Authorization:'Bearer user-session-fixture','Content-Type':'application/json',Origin:ORIGIN,...headers},body:JSON.stringify(body)});
function fixture(overrides={}){
 const calls=[],events=[];let savedBody=null;
 const env={...ENV,...overrides.env};
 const fetchImpl=async(url,options={})=>{
  const parsed=new URL(url),headers=new Headers(options.headers);calls.push({url:String(url),path:parsed.pathname,options,headers});
  if(parsed.pathname==='/auth/v1/user')return json(overrides.auth||{id:USER},overrides.authStatus||200);
  if(parsed.pathname==='/rest/v1/fields')return json(overrides.fields||[{id:FIELD,farms:{owner_id:USER}}],overrides.fieldsStatus||200);
  if(parsed.pathname==='/rest/v1/field_boundaries')return json(overrides.boundaries||[{field_id:FIELD,owner_id:USER,geometry:POLYGON}],overrides.boundaryStatus||200);
  if(parsed.pathname==='/rest/v1/terrain_reports'){
   if(options.method==='POST'){
    events.push('persist');savedBody=JSON.parse(options.body);
    return json(overrides.saveBody||[{id:REPORT,field_id:FIELD,user_id:USER,created_at:STAMP}],overrides.saveStatus||201);
   }
   return json(overrides.reports||[],overrides.reportsStatus||200);
  }
  throw Error('Unexpected fixture network request: '+url);
 };
 const deps={origin:ORIGIN,fetchImpl,limiter:createTerrainLimiter({cooldownMs:0}),fetchDem:async(options,dependencies)=>{
  events.push('dem');assert.equal(options.maxDimension,128);assert.deepEqual(options.polygon,POLYGON);assert.equal(dependencies.fetchImpl,fetchImpl);
  if(overrides.demError)throw overrides.demError;
  return structuredClone(RASTER);
 },analyze:options=>{
  events.push('analyze');if(overrides.analysisError)throw overrides.analysisError;
  return overrides.analysis!==undefined?overrides.analysis:analyzeTerrain(options);
 },...overrides.deps};
 return {env,deps,calls,events,saved:()=>savedBody};
}
const run=async(settings={},body,headers)=>{const f=fixture(settings),response=await handleTerrain(request(body,headers),f.env,f.deps);return {...f,response,body:await response.json()};};
const writes=calls=>calls.filter(call=>call.options.method==='POST');

test('terrain readiness declares real source and limits without exposing credentials',()=>{
 const ready=terrainStatus(ENV);assert.equal(ready.available,true);assert.equal(ready.data_kind,'DSM');assert.equal(ready.lidar,false);assert.equal(ready.source_resolution_m,30);assert.equal(ready.limits.max_dimension,128);assert.equal(ready.limits.max_report_bytes,2*1024*1024);assert.match(ready.quota_note,/لكل نسخة/);
 const disabled=terrainStatus({...ENV,SUPABASE_SERVICE_ROLE_KEY:''});assert.equal(disabled.available,false);assert.ok(disabled.required_settings.includes('SUPABASE_SERVICE_ROLE_KEY'));assert.ok(!JSON.stringify(ready).includes(ENV.SUPABASE_SERVICE_ROLE_KEY));
});

test('terrain handler rejects unsupported methods and missing server setup before networking',async()=>{
 const f=fixture();const method=await handleTerrain(new Request('https://worker.test/terrain'),f.env,f.deps);assert.equal(method.status,405);
 for(const env of [{SUPABASE_URL:''},{SUPABASE_URL:'http://project.supabase.co'},{SUPABASE_URL:'https://project.supabase.co/path'},{SUPABASE_PUBLISHABLE_KEY:''}]){const result=await run({env});assert.equal(result.response.status,503);assert.equal(result.calls.length,0);assert.equal(result.body.code,'TERRAIN_SETUP_REQUIRED');}
});

test('IDs only: invalid JSON shapes, actions, geometry, source and output injection are rejected',async()=>{
 for(const body of [null,[],{}, {field_id:'bad'}, {field_id:FIELD,action:'delete'}, {field_id:FIELD,user_id:OTHER},{field_id:FIELD,geometry:POLYGON},{field_id:FIELD,url:'http://169.254.169.254/'},{field_id:FIELD,source:'LiDAR'},{field_id:FIELD,report:{status:'completed'}},{report_id:REPORT,action:'get',field_id:FIELD}]){
  const result=await run({},body);assert.equal(result.response.status,400,JSON.stringify(body));assert.equal(result.calls.length,0);assert.equal(result.events.length,0);
 }
 const f=fixture(),req=new Request('https://worker.test/terrain',{method:'POST',body:'{"bad":',headers:{Authorization:'Bearer user'}});const response=await handleTerrain(req,f.env,f.deps);assert.equal(response.status,400);assert.equal(f.calls.length,0);
});

test('both declared and actual request byte limits are enforced before auth and DEM traffic',async()=>{
 for(const req of [request({field_id:FIELD},{'Content-Length':'8193'}),request({field_id:FIELD,padding:'x'.repeat(9000)}),request({field_id:FIELD},{'Content-Length':'invalid'})]){
  const f=fixture(),response=await handleTerrain(req,f.env,f.deps);assert.equal(response.status,413);assert.equal(f.calls.length,0);assert.equal(f.events.length,0);
 }
});

test('only a valid nonanonymous Supabase user session can request analysis',async()=>{
 const noBearer=await run({},undefined,{Authorization:''});assert.equal(noBearer.response.status,401);assert.equal(noBearer.calls.length,0);
 for(const settings of [{authStatus:401},{authStatus:403},{auth:{id:USER,is_anonymous:true}},{auth:{id:'invalid'}}]){const r=await run(settings);assert.equal(r.response.status,401);assert.equal(r.events.length,0);assert.equal(writes(r.calls).length,0);}
 const unavailable=await run({authStatus:503});assert.equal(unavailable.response.status,502);assert.equal(unavailable.body.code,'AUTH_UNAVAILABLE');
});

test('analyze requires writer readiness while saved report reads remain available',async()=>{
 const r=await run({env:{SUPABASE_SERVICE_ROLE_KEY:''}});assert.equal(r.response.status,503);assert.equal(r.events.length,0);
 const list=await run({env:{SUPABASE_SERVICE_ROLE_KEY:''}},{action:'list',field_id:FIELD});assert.equal(list.response.status,200);assert.deepEqual(list.body,{reports:[]});
});

test('field and boundary ownership are independently checked before touching the DEM',async()=>{
 for(const settings of [{fields:[]},{fields:[{id:FIELD,farms:{owner_id:OTHER}}]},{fields:[{id:OTHER,farms:{owner_id:USER}}]},{boundaries:[]},{boundaries:[{field_id:FIELD,owner_id:OTHER,geometry:POLYGON}]},{boundaries:[{field_id:OTHER,owner_id:USER,geometry:POLYGON}]}]){
  const r=await run(settings);assert.equal(r.response.status,404);assert.equal(r.body.code,'FIELD_UNAVAILABLE');assert.equal(r.events.length,0);assert.equal(writes(r.calls).length,0);
 }
 for(const settings of [{fieldsStatus:503},{boundaryStatus:503}]){const r=await run(settings);assert.equal(r.response.status,502);assert.equal(r.body.code,'FIELD_READ_FAILED');assert.equal(r.events.length,0);}
});

test('invalid saved geometry fails closed, while valid JSON-string polygon is parsed from storage',async()=>{
 for(const geometry of ['not-json',{type:'Point',coordinates:[45.5,32.5]},{type:'Polygon',coordinates:[[[45,32],[46,32],[45,33]]]}]){const r=await run({boundaries:[{field_id:FIELD,owner_id:USER,geometry}]});assert.equal(r.response.status,400);assert.equal(r.events.length,0);}
 const r=await run({boundaries:[{field_id:FIELD,owner_id:USER,geometry:JSON.stringify(POLYGON)}]});assert.equal(r.response.status,200);
});

test('successful analysis computes a real algorithm result then persists before returning success',async()=>{
 const r=await run();assert.equal(r.response.status,200);assert.deepEqual(r.events,['dem','analyze','persist']);assert.equal(r.body.report_id,REPORT);assert.equal(r.body.field_id,FIELD);assert.equal(r.body.created_at,STAMP);assert.equal(r.body.analysis.status,'completed');assert.equal(r.body.analysis.summary.min_elevation_m,30);assert.equal(r.body.analysis.summary.max_elevation_m,33);assert.ok(r.body.analysis.summary.mean_slope_percent>0);assert.ok(r.body.analysis.area_dunam>0);
 const saved=r.saved();assert.equal(saved.user_id,USER);assert.equal(saved.field_id,FIELD);assert.deepEqual(saved.boundary_snapshot,POLYGON);assert.deepEqual(saved.report,r.body.analysis);assert.equal(saved.source_id,RASTER.source.id);assert.deepEqual(saved.source_metadata,r.body.analysis.source);
 assert.equal(writes(r.calls).length,1);
 for(const call of r.calls){if(call.options.method==='POST'){assert.equal(call.headers.get('apikey'),ENV.SUPABASE_SERVICE_ROLE_KEY);assert.equal(call.headers.get('authorization'),'Bearer '+ENV.SUPABASE_SERVICE_ROLE_KEY);}else{assert.equal(call.headers.get('apikey'),ENV.SUPABASE_PUBLISHABLE_KEY);assert.equal(call.headers.get('authorization'),'Bearer user-session-fixture');}}
 assert.ok(!JSON.stringify(r.body).includes(ENV.SUPABASE_SERVICE_ROLE_KEY));assert.equal(r.response.headers.get('cache-control'),'no-store');assert.equal(r.response.headers.get('access-control-allow-origin'),ORIGIN);
});

test('DEM unavailability and timeout never synthesize elevations, call the algorithm or persist a result',async()=>{
 for(const error of [new Error('provider-private-body '+ENV.SUPABASE_SERVICE_ROLE_KEY),Object.assign(new Error('timeout'),{name:'TimeoutError'}),Object.assign(new Error('timeout'),{status:504})]){
  const r=await run({demError:error});assert.ok([502,504].includes(r.response.status));assert.deepEqual(r.events,['dem']);assert.equal(writes(r.calls).length,0);assert.equal(r.body.analysis,undefined);assert.ok(!JSON.stringify(r.body).includes('provider-private-body'));assert.ok(!JSON.stringify(r.body).includes(ENV.SUPABASE_SERVICE_ROLE_KEY));
 }
});

test('failed, empty or excessive computations do not create a saved success',async()=>{
 for(const settings of [{analysisError:new Error('nodata')},{analysis:null},{analysis:{status:'failed'}},{analysis:{status:'completed',source:{},summary:{},raster:{padding:'x'.repeat(2*1024*1024)}}}]){
  const r=await run(settings);assert.ok([413,422].includes(r.response.status));assert.deepEqual(r.events,['dem','analyze']);assert.equal(writes(r.calls).length,0);assert.equal(r.body.analysis,undefined);
 }
});

test('known DEM resource and coverage failures tell the farmer what to change without disclosing upstream text',async()=>{
 const privateText='private provider text '+ENV.SUPABASE_SERVICE_ROLE_KEY;
 const limit=await run({demError:Object.assign(new Error(privateText),{status:413,code:'dem_resource_limit'})});
 assert.equal(limit.response.status,413);assert.equal(limit.body.code,'TERRAIN_DEM_LIMIT');assert.match(limit.body.message,/جزءًا أصغر/);assert.match(limit.body.message,/كتلتان/);assert.match(limit.body.message,/٨ ميغابايت/);assert.deepEqual(limit.events,['dem']);assert.equal(writes(limit.calls).length,0);
 for(const code of ['dem_missing','dem_coverage']){const coverage=await run({demError:Object.assign(new Error(privateText),{status:422,code})});assert.equal(coverage.response.status,422);assert.equal(coverage.body.code,'TERRAIN_DEM_COVERAGE');assert.match(coverage.body.message,/تغطية/);assert.match(coverage.body.message,/لم تُنشأ ارتفاعات افتراضية/);assert.equal(writes(coverage.calls).length,0);}
 const unknown=await run({demError:Object.assign(new Error(privateText),{status:413,code:'unknown_private_failure'})});assert.equal(unknown.response.status,502);assert.equal(unknown.body.code,'TERRAIN_DEM_UNAVAILABLE');
 assert.ok(!JSON.stringify([limit.body,unknown.body]).includes(privateText));
});

test('insufficient actual cells require finer data instead of upsampling or reporting a successful analysis',async()=>{
 for(const code of ['insufficient_dem','incomplete_dem']){
  const r=await run({analysisError:Object.assign(new Error('secret diagnostic detail'),{code})});
  assert.equal(r.response.status,422);assert.equal(r.body.code,'TERRAIN_INSUFFICIENT_DEM');assert.match(r.body.message,/الحقل أصغر من دقة المصدر/);assert.match(r.body.message,/مصدر ارتفاع أدق أو رفع مساحي/);assert.match(r.body.message,/تكبير الشبكة لا يضيف قياسات حقيقية/);assert.ok(!JSON.stringify(r.body).includes('secret diagnostic'));assert.deepEqual(r.events,['dem','analyze']);assert.equal(writes(r.calls).length,0);assert.equal(r.body.analysis,undefined);
 }
});

test('storage failures, database quotas and changed boundaries are explicit and never return success',async()=>{
 for(const [settings,status,code] of [
  [{saveStatus:503},503,'TERRAIN_SAVE_FAILED'],
  [{saveStatus:400,saveBody:{code:'54000',message:'terrain_hourly_quota_exceeded'}},429,'TERRAIN_QUOTA_EXHAUSTED'],
  [{saveStatus:400,saveBody:{code:'54000',message:'terrain_retained_report_limit'}},409,'TERRAIN_STORAGE_LIMIT'],
  [{saveStatus:400,saveBody:{code:'23514',message:'terrain_boundary_changed'}},409,'TERRAIN_BOUNDARY_CHANGED'],
  [{saveStatus:400,saveBody:{code:'23514',message:'secret database details'}},503,'TERRAIN_SAVE_FAILED'],
  [{saveBody:[]},503,'TERRAIN_SAVE_FAILED'],
  [{saveBody:[{id:REPORT,field_id:FIELD,user_id:OTHER,created_at:STAMP}]},503,'TERRAIN_SAVE_FAILED'],
  [{saveBody:[{id:REPORT,field_id:OTHER,user_id:USER,created_at:STAMP}]},503,'TERRAIN_SAVE_FAILED']
 ]){const r=await run(settings);assert.equal(r.response.status,status);assert.equal(r.body.code,code);assert.equal(r.body.analysis,undefined);assert.ok(!JSON.stringify(r.body).includes('secret database details'));}
});

test('owner report listing uses user JWT and bounded explicit owner and field filters',async()=>{
 const rows=[{id:REPORT,field_id:FIELD,user_id:USER,created_at:STAMP,source_id:'copernicus_dsm_glo30',algorithm_version:'ur-terrain-d8-v1'}];
 const r=await run({reports:rows},{action:'list',field_id:FIELD});assert.equal(r.response.status,200);assert.deepEqual(r.body,{reports:[{report_id:REPORT,field_id:FIELD,created_at:STAMP,source_id:'copernicus_dsm_glo30',algorithm_version:'ur-terrain-d8-v1'}]});assert.equal(r.events.length,0);
 const call=r.calls.find(x=>x.path==='/rest/v1/terrain_reports'),url=new URL(call.url);assert.equal(url.searchParams.get('user_id'),'eq.'+USER);assert.equal(url.searchParams.get('field_id'),'eq.'+FIELD);assert.equal(url.searchParams.get('limit'),'20');assert.equal(call.headers.get('apikey'),ENV.SUPABASE_PUBLISHABLE_KEY);assert.ok(!url.searchParams.get('select').split(',').includes('report'));
 const bad=await run({reports:[{...rows[0],user_id:OTHER}]},{action:'list',field_id:FIELD});assert.equal(bad.response.status,502);assert.equal(bad.body.reports,undefined);
});

test('report retrieval returns only its authenticated owner snapshot and handles missing or foreign data',async()=>{
 const analysis=analyzeTerrain({polygon:POLYGON,raster:RASTER}),row={id:REPORT,field_id:FIELD,user_id:USER,created_at:STAMP,report:analysis};
 const r=await run({reports:[row]},{action:'get',report_id:REPORT});assert.equal(r.response.status,200);assert.deepEqual(r.body.analysis,analysis);assert.equal(r.events.length,0);assert.equal(writes(r.calls).length,0);
 const call=r.calls.find(x=>x.path==='/rest/v1/terrain_reports'),url=new URL(call.url);assert.equal(url.searchParams.get('id'),'eq.'+REPORT);assert.equal(url.searchParams.get('user_id'),'eq.'+USER);
 for(const [settings,status] of [[{reports:[]},404],[{reports:[{...row,user_id:OTHER}]},502],[{reports:[{...row,id:OTHER}]},404],[{reportsStatus:503},502],[{reports:[{...row,created_at:'invalid'}]},502]]){const failed=await run(settings,{action:'get',report_id:REPORT});assert.equal(failed.response.status,status);assert.equal(failed.body.analysis,undefined);}
});

test('warm-instance limiter bounds concurrent work, enforces cooldown and releases after provider failure',async()=>{
 let now=0;const limiter=createTerrainLimiter({now:()=>now,cooldownMs:30000,maxPerUserDay:2,maxInstanceDay:3,maxActive:2});
 const release=limiter.acquire(USER);assert.throws(()=>limiter.acquire(USER),/TERRAIN_BUSY/);const second=limiter.acquire(OTHER);assert.throws(()=>limiter.acquire(FIELD),/TERRAIN_BUSY/);release();release();assert.throws(()=>limiter.acquire(USER),/TERRAIN_RATE_LIMIT/);second();now=30000;limiter.acquire(USER)();now=60000;assert.throws(()=>limiter.acquire(USER),/TERRAIN_RATE_LIMIT/);now=86400000;limiter.acquire(USER)();
 const f=fixture({demError:new Error('failed'),deps:{limiter:createTerrainLimiter({cooldownMs:0,maxPerUserDay:10})}});
 for(let attempt=0;attempt<2;attempt++){const response=await handleTerrain(request(),f.env,f.deps);assert.equal(response.status,502);assert.notEqual((await response.json()).code,'TERRAIN_BUSY');}
});
