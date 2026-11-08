import {fetchTerrainDem} from './terrain-dem.mjs';
import {analyzeTerrain,validateTerrainPolygon} from '../terrain-core.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BYTES=8192,MAX_REPORT_BYTES=2*1024*1024,MAX_DIMENSION=128;
const SOURCE_ID='copernicus-glo30-aws-2021';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const problem=(code,status=400)=>Object.assign(new Error(code),{code,status});
const MESSAGES={
 METHOD_NOT_ALLOWED:'استخدم زر تحليل تضاريس الحقل لإرسال الطلب.',
 TERRAIN_SETUP_REQUIRED:'خدمة التضاريس تحتاج إكمال إعداد الخادم الآمن قبل التشغيل. لم تُنشأ نتائج بديلة.',
 TERRAIN_INVALID_REQUEST:'طلب التحليل غير صالح. اختر حقلًا محفوظًا وحدودًا صحيحة ثم أعد المحاولة.',
 TERRAIN_REQUEST_TOO_LARGE:'حجم الطلب أكبر من المسموح. أرسل معرّف الحقل فقط.',
 TERRAIN_REQUEST_TIMEOUT:'تأخر إرسال الطلب. تحقق من الاتصال ثم أعد المحاولة.',
 AUTH_REQUIRED:'سجّل الدخول بحسابك قبل تحليل التضاريس.',
 AUTH_UNAVAILABLE:'تعذر التحقق من جلسة الحساب الآن. أعد المحاولة لاحقًا.',
 FIELD_UNAVAILABLE:'الحقل أو حدوده غير متاحة لهذا الحساب. احفظ حدود الحقل أولًا.',
 FIELD_READ_FAILED:'تعذر قراءة الحقل وحدوده الآن. أعد المحاولة لاحقًا.',
 TERRAIN_BOUNDARY_INVALID:'حدود الحقل غير صالحة للتحليل. راجع رسم الحدود وحجم الحقل.',
 TERRAIN_REPORT_UNAVAILABLE:'التقرير غير متاح لهذا الحساب أو حُذف.',
 TERRAIN_REPORT_READ_FAILED:'تعذر تحميل تقارير التضاريس المحفوظة الآن.',
 TERRAIN_BUSY:'يوجد تحليل قيد التنفيذ. انتظر اكتماله ثم حاول مجددًا.',
 TERRAIN_RATE_LIMIT:'وصلت إلى الحد المؤقت للطلبات. انتظر قليلًا قبل إعادة التحليل.',
 TERRAIN_DEM_UNAVAILABLE:'تعذر الحصول على بيانات ارتفاع حقيقية لهذا الحقل الآن. لم تُستخدم ارتفاعات افتراضية.',
 TERRAIN_DEM_TIMEOUT:'تأخر مصدر الارتفاعات. أعد المحاولة لاحقًا؛ لم يُنشأ تقرير ناجح.',
 TERRAIN_DEM_LIMIT:'تتجاوز حدود الحقل حد المعالجة الحالية: كتلتان من بيانات DEM أو ٨ ميغابايت للتحميل. حدّد جزءًا أصغر من الحقل ثم حلّله؛ لم تُنشأ نتائج بديلة.',
 TERRAIN_DEM_COVERAGE:'لا تتوفر تغطية ارتفاعات مدعومة لهذا الموقع في المصدر الحالي. يلزم مصدر DEM فعلي يغطي الحقل؛ لم تُنشأ ارتفاعات افتراضية.',
 TERRAIN_INSUFFICIENT_DEM:'لا توجد خلايا ارتفاع صالحة ومتجاورة تكفي للتحليل. قد يكون الحقل أصغر من دقة المصدر، أو تكون تغطيته ناقصة. يلزم مصدر ارتفاع أدق أو رفع مساحي؛ تكبير الشبكة لا يضيف قياسات حقيقية.',
 TERRAIN_ANALYSIS_FAILED:'لم تكتمل معالجة التضاريس من البيانات الفعلية. راجع حدود الحقل أو حاول لاحقًا.',
 TERRAIN_REPORT_TOO_LARGE:'الحقل أو تفاصيل النتيجة تتجاوز حدود هذه النسخة. جرّب تحليل حقل أصغر.',
 TERRAIN_SAVE_FAILED:'اكتمل الحساب لكن تعذر حفظ التقرير في حسابك. لم يُعلن اكتمال الطلب؛ أعد المحاولة لاحقًا.',
 TERRAIN_QUOTA_EXHAUSTED:'وصلت إلى حد تقارير التضاريس خلال هذه الساعة. أعد المحاولة لاحقًا.',
 TERRAIN_STORAGE_LIMIT:'لديك عشرون تقرير تضاريس محفوظًا. صدّر التقارير التي تحتاجها ثم احذف تقريرًا قديمًا قبل تحليل جديد.',
 TERRAIN_BOUNDARY_CHANGED:'تغيّرت حدود الحقل أثناء المعالجة. حدّث الحقل ثم أعد التحليل؛ لم يُحفظ تقرير بحدود قديمة.',
 TERRAIN_UNAVAILABLE:'خدمة التضاريس غير متاحة مؤقتًا. لم يُنشأ تقرير ناجح.'
};

function response(body,status=200,origin='https://ur-smart-urfarmiq.pages.dev'){
 return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin,'vary':'Origin','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
}
async function boundedJSON(source,limit,timeout=10000){
 const declared=source.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit))throw problem('TERRAIN_REQUEST_TOO_LARGE',413);
 if(!source.body)throw problem('TERRAIN_INVALID_REQUEST');
 const reader=source.body.getReader(),chunks=[];let length=0,timer;
 const consume=(async()=>{try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){void reader.cancel().catch(()=>{});throw problem('TERRAIN_REQUEST_TOO_LARGE',413);}chunks.push(value);}const bytes=new Uint8Array(length);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.byteLength;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{try{reader.releaseLock();}catch{}}})();
 try{return await Promise.race([consume,new Promise((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(problem('TERRAIN_REQUEST_TIMEOUT',408));},timeout);})]);}
 finally{clearTimeout(timer);}
}
async function fetchJSON(fetchImpl,url,options={},limit=64*1024,timeout=10000){
 const controller=new AbortController();let timer;
 try{
  const fetchPromise=fetchImpl(url,{...options,redirect:'error',signal:controller.signal});
  const res=await Promise.race([fetchPromise,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(problem('UPSTREAM_TIMEOUT',504));},timeout);})]);
  if(!res.ok){let code=null,reason=null;try{const data=await boundedJSON(res,4096,3000);if(typeof data?.code==='string'&&/^[0-9A-Z]{5}$/.test(data.code))code=data.code;if(['terrain_hourly_quota_exceeded','terrain_retained_report_limit','terrain_boundary_changed'].includes(data?.message))reason=data.message;}catch{}return {ok:false,status:res.status,code,reason};}
  return {ok:true,status:res.status,data:await boundedJSON(res,limit,timeout)};
 }finally{clearTimeout(timer);}
}
function configured(env,needsWriter=false){
 const missing=[];
 let base='';try{const url=new URL(env.SUPABASE_URL);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error();base=url.origin;}catch{missing.push('SUPABASE_URL');}
 if(!env.SUPABASE_PUBLISHABLE_KEY)missing.push('SUPABASE_PUBLISHABLE_KEY');
 if(needsWriter&&!env.SUPABASE_SERVICE_ROLE_KEY)missing.push('SUPABASE_SERVICE_ROLE_KEY');
 return {base,missing};
}

/** Abuse protection for one warm Worker instance; never described as a global quota. */
export function createTerrainLimiter({now=()=>Date.now(),cooldownMs=30000,maxPerUserDay=20,maxInstanceDay=200,maxActive=2,maxUsers=1000}={}){
 const users=new Map();let day=-1,total=0,active=0;
 return {acquire(userId){
  const stamp=now(),today=Math.floor(stamp/86400000);if(today!==day){users.clear();day=today;total=0;}
  const previous=users.get(userId);
  if(previous?.active||active>=maxActive)throw problem('TERRAIN_BUSY',429);
  if(previous&&stamp-previous.last<cooldownMs||previous?.count>=maxPerUserDay||total>=maxInstanceDay||!previous&&users.size>=maxUsers)throw problem('TERRAIN_RATE_LIMIT',429);
  const entry={last:stamp,count:(previous?.count||0)+1,active:true};users.set(userId,entry);total++;active++;
  let finished=false;return ()=>{if(!finished){finished=true;entry.active=false;active=Math.max(0,active-1);}};
 }};
}
const warmLimiter=createTerrainLimiter();

export function terrainStatus(env){
 const {missing}=configured(env,true);
 return {available:missing.length===0,required_settings:missing,source:SOURCE_ID,source_name:'Copernicus DEM GLO-30 (DSM)',data_kind:'DSM',lidar:false,source_resolution_m:30,saved_account_required:true,engineering_design:false,limits:{max_dimension:MAX_DIMENSION,max_request_bytes:MAX_REQUEST_BYTES,max_report_bytes:MAX_REPORT_BYTES,warm_instance_concurrent_analyses:2,warm_instance_user_cooldown_seconds:30,warm_instance_user_requests_per_day:20},quota_note:'حماية الطلبات في الخادم مؤقتة لكل نسخة تشغيل؛ ليست حدًا عالميًا أو ضمانًا للتوفر. حدود البيانات والتخزين تُطبَّق أيضًا.',note:'الارتفاعات من نموذج سطح عالمي بدقة اسمية ٣٠ مترًا؛ ليست بيانات LiDAR أو مسح تسوية هندسيًا. الخدمة لا تعلن نجاحًا قبل اكتمال التحليل والحفظ.'};
}

function inputValue(input){
 if(!plain(input))throw problem('TERRAIN_INVALID_REQUEST');
 const action=input.action===undefined?'analyze':input.action;
 if(!['analyze','list','get'].includes(action))throw problem('TERRAIN_INVALID_REQUEST');
 const allowed=action==='get'?['action','report_id']:['action','field_id'];
 if(Object.keys(input).some(key=>!allowed.includes(key)))throw problem('TERRAIN_INVALID_REQUEST');
 const key=action==='get'?'report_id':'field_id';
 if(!UUID.test(input[key]||''))throw problem('TERRAIN_INVALID_REQUEST');
 return {action,[key]:input[key].toLowerCase()};
}
function reportEnvelope(row){
 if(!plain(row)||!UUID.test(row.id||'')||!UUID.test(row.field_id||'')||!Number.isFinite(Date.parse(row.created_at))||!plain(row.report))throw problem('TERRAIN_REPORT_READ_FAILED',502);
 return {report_id:row.id,field_id:row.field_id,created_at:row.created_at,analysis:row.report};
}

/** The browser supplies IDs only. Boundary, DEM, calculations and saved source are server-owned. */
export async function handleTerrain(request,env,{origin='https://ur-smart-urfarmiq.pages.dev',reply=response,fetchImpl=globalThis.fetch,fetchDem=fetchTerrainDem,analyze=analyzeTerrain,validatePolygon=validateTerrainPolygon,limiter=warmLimiter}={}){
 const fail=(code,status=400)=>reply({code,error:code,message:MESSAGES[code]||MESSAGES.TERRAIN_UNAVAILABLE},status,origin);
 if(request.method!=='POST')return fail('METHOD_NOT_ALLOWED',405);
 const {base,missing}=configured(env);if(missing.length)return fail('TERRAIN_SETUP_REQUIRED',503);
 let input;try{input=inputValue(await boundedJSON(request,MAX_REQUEST_BYTES));}catch(error){return fail(error.code in MESSAGES?error.code:'TERRAIN_INVALID_REQUEST',error.status||400);}
 const bearer=request.headers.get('Authorization')||'';
 if(!/^Bearer [^\s]+$/.test(bearer))return fail('AUTH_REQUIRED',401);
 const headers={apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:bearer};
 let user;
 try{const auth=await fetchJSON(fetchImpl,base+'/auth/v1/user',{headers},32*1024);if(!auth.ok)return fail([400,401,403].includes(auth.status)?'AUTH_REQUIRED':'AUTH_UNAVAILABLE',[400,401,403].includes(auth.status)?401:502);user=auth.data;if(!UUID.test(user?.id||'')||user.is_anonymous===true)return fail('AUTH_REQUIRED',401);}catch{return fail('AUTH_UNAVAILABLE',502);}

 if(input.action==='get'||input.action==='list'){
  try{
   const url=new URL(base+'/rest/v1/terrain_reports');url.searchParams.set('user_id','eq.'+user.id);
   if(input.action==='get'){url.searchParams.set('select','id,field_id,user_id,created_at,report');url.searchParams.set('id','eq.'+input.report_id);url.searchParams.set('limit','1');}
   else{url.searchParams.set('select','id,field_id,user_id,created_at,source_id,algorithm_version');url.searchParams.set('field_id','eq.'+input.field_id);url.searchParams.set('order','created_at.desc');url.searchParams.set('limit','20');}
   const result=await fetchJSON(fetchImpl,url.href,{headers},input.action==='get'?MAX_REPORT_BYTES+16384:32*1024);
   if(!result.ok||!Array.isArray(result.data))return fail('TERRAIN_REPORT_READ_FAILED',502);
   const rows=result.data;if(rows.some(row=>row?.user_id!==user.id))return fail('TERRAIN_REPORT_READ_FAILED',502);
   if(input.action==='get'){const row=rows[0];if(!row||row.id!==input.report_id)return fail('TERRAIN_REPORT_UNAVAILABLE',404);return reply(reportEnvelope(row),200,origin);}
   if(rows.some(row=>row.field_id!==input.field_id||!UUID.test(row.id||'')||!Number.isFinite(Date.parse(row.created_at))))return fail('TERRAIN_REPORT_READ_FAILED',502);
   return reply({reports:rows.map(row=>({report_id:row.id,field_id:row.field_id,created_at:row.created_at,source_id:row.source_id,algorithm_version:row.algorithm_version}))},200,origin);
  }catch{return fail('TERRAIN_REPORT_READ_FAILED',502);}
 }
 if(!env.SUPABASE_SERVICE_ROLE_KEY)return fail('TERRAIN_SETUP_REQUIRED',503);

 let polygon;
 try{
  const fieldURL=new URL(base+'/rest/v1/fields');fieldURL.searchParams.set('select','id,farms!inner(owner_id)');fieldURL.searchParams.set('id','eq.'+input.field_id);fieldURL.searchParams.set('farms.owner_id','eq.'+user.id);fieldURL.searchParams.set('limit','1');
  const fieldResult=await fetchJSON(fetchImpl,fieldURL.href,{headers},16*1024);
  if(!fieldResult.ok)return fail('FIELD_READ_FAILED',502);
  const field=Array.isArray(fieldResult.data)?fieldResult.data[0]:null,farm=Array.isArray(field?.farms)?field.farms[0]:field?.farms;
  if(field?.id!==input.field_id||farm?.owner_id!==user.id)return fail('FIELD_UNAVAILABLE',404);
  const boundaryURL=new URL(base+'/rest/v1/field_boundaries');boundaryURL.searchParams.set('select','field_id,owner_id,geometry');boundaryURL.searchParams.set('field_id','eq.'+input.field_id);boundaryURL.searchParams.set('owner_id','eq.'+user.id);boundaryURL.searchParams.set('limit','1');
  const boundaryResult=await fetchJSON(fetchImpl,boundaryURL.href,{headers},192*1024);if(!boundaryResult.ok)return fail('FIELD_READ_FAILED',502);
  const boundary=Array.isArray(boundaryResult.data)?boundaryResult.data[0]:null;if(boundary?.field_id!==input.field_id||boundary?.owner_id!==user.id)return fail('FIELD_UNAVAILABLE',404);
  polygon=boundary.geometry;if(typeof polygon==='string'){try{polygon=JSON.parse(polygon);}catch{return fail('TERRAIN_BOUNDARY_INVALID',400);}}
  try{validatePolygon(polygon);}catch{return fail('TERRAIN_BOUNDARY_INVALID',400);}
 }catch{return fail('FIELD_READ_FAILED',502);}

 let release;
 try{release=limiter.acquire(user.id);}catch(error){return fail(error.code==='TERRAIN_BUSY'?'TERRAIN_BUSY':'TERRAIN_RATE_LIMIT',429);}
 try{
  let raster;
  try{raster=await fetchDem({polygon,maxDimension:MAX_DIMENSION},{fetchImpl});}catch(error){if(error?.status===413&&error?.code==='dem_resource_limit')return fail('TERRAIN_DEM_LIMIT',413);if(error?.status===422&&['dem_missing','dem_coverage'].includes(error?.code))return fail('TERRAIN_DEM_COVERAGE',422);const timedOut=['AbortError','TimeoutError'].includes(error?.name)||error?.status===504;return fail(timedOut?'TERRAIN_DEM_TIMEOUT':'TERRAIN_DEM_UNAVAILABLE',timedOut?504:502);}
  let analysis;
  try{analysis=analyze({polygon,raster});if(!plain(analysis)||analysis.status!=='completed'||!plain(analysis.raster)||!plain(analysis.source)||!plain(analysis.summary))throw Error();}catch(error){if(['insufficient_dem','incomplete_dem'].includes(error?.code))return fail('TERRAIN_INSUFFICIENT_DEM',422);return fail('TERRAIN_ANALYSIS_FAILED',422);}
  const serialized=JSON.stringify(analysis);if(new TextEncoder().encode(serialized).byteLength>MAX_REPORT_BYTES)return fail('TERRAIN_REPORT_TOO_LARGE',413);
  const algorithm=typeof analysis.algorithm_version==='string'?analysis.algorithm_version:'ur-terrain-d8-v1';
  const body={field_id:input.field_id,user_id:user.id,source_id:typeof analysis.source.id==='string'?analysis.source.id:SOURCE_ID,source_metadata:analysis.source,report:analysis,boundary_snapshot:polygon,algorithm_version:algorithm};
  const adminHeaders={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
  let saved;
  try{
   const result=await fetchJSON(fetchImpl,base+'/rest/v1/terrain_reports?select=id,field_id,user_id,created_at',{method:'POST',headers:adminHeaders,body:JSON.stringify(body)},16*1024);
   if(!result.ok){if(result.reason==='terrain_retained_report_limit')return fail('TERRAIN_STORAGE_LIMIT',409);if(result.code==='54000'||result.status===429)return fail('TERRAIN_QUOTA_EXHAUSTED',429);if(result.code==='23514'&&result.reason==='terrain_boundary_changed')return fail('TERRAIN_BOUNDARY_CHANGED',409);return fail('TERRAIN_SAVE_FAILED',503);}
   saved=Array.isArray(result.data)?result.data[0]:null;
   if(!saved||!UUID.test(saved.id||'')||saved.field_id!==input.field_id||saved.user_id!==user.id||!Number.isFinite(Date.parse(saved.created_at)))return fail('TERRAIN_SAVE_FAILED',503);
  }catch{return fail('TERRAIN_SAVE_FAILED',503);}
  return reply({report_id:saved.id,field_id:saved.field_id,created_at:saved.created_at,analysis},200,origin);
 }finally{release();}
}
