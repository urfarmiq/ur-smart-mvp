import {satelliteFetch} from './satellite-security.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

async function boundedJSON(response,limit,timeout=8000){
 if(!response.body)throw Error('Missing body');
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit))throw Error('Body too large');
 const reader=response.body.getReader(),chunks=[];let size=0,timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{});},timeout);
 try{
  for(;;){const {value,done}=await reader.read();if(timedOut)throw Error('Body timeout');if(done)break;size+=value.byteLength;if(size>limit){void reader.cancel().catch(()=>{});throw Error('Body too large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }finally{clearTimeout(timer);try{reader.releaseLock();}catch{}}
}

export function satellitePaidStatus(env={}){
 return {available:!!(env.SUPABASE_URL&&env.SUPABASE_PUBLISHABLE_KEY&&env.SENTINEL_CLIENT_ID&&env.SENTINEL_CLIENT_SECRET),paid_service:true,manual_admin_approval_required:true,quote_required:true,customer_acceptance_required:true,field_specific:true,automatic_renewal:false,duration:'Quoted number of days starting at manual payment approval',included_research_image_route:'/research/imagery'};
}

// RLS and the checked RPC determine the current owner and accepted paid terms.
// In-memory UI state, custom headers and provider credentials are not entitlements.
export async function checkSatelliteAccess(env,headers,fieldId){
 try{
  const response=await satelliteFetch(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/satellite_access_status',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_field_id:fieldId})},8000);
  if(!response.ok){if(response.body)void response.body.cancel().catch(()=>{});return {available:false,active:false};}
  const status=await boundedJSON(response,4096);
  if(!plain(status)||typeof status.active!=='boolean')return {available:false,active:false};
  const active=status.active===true&&typeof status.field_id==='string'&&status.field_id.toLowerCase()===fieldId.toLowerCase()&&UUID.test(status.order_id||'')&&typeof status.expires_at==='string'&&Number.isFinite(Date.parse(status.expires_at))&&Date.parse(status.expires_at)>Date.now();
  return {available:true,active};
 }catch{return {available:false,active:false};}
}

// An already paid researcher may retrieve the NDVI raster for the exact saved
// report scene. This grants neither fresh statistics nor unrelated imagery.
export async function handleResearchImagery(request,env,{reply,origin,satellite}){
 const fail=(code,status,message)=>reply({code,error:code,message},status,origin);
 if(request.method!=='POST')return fail('METHOD_NOT_ALLOWED',405,'POST only');
 if(!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY)return fail('SETUP_REQUIRED',503,'تعذر تهيئة خدمة الصور.');
 const bearer=request.headers.get('Authorization')||'';
 if(bearer.length>8200||!/^Bearer [^\s]+$/.test(bearer))return fail('AUTH_REQUIRED',401,'سجّل الدخول لفتح صورة تقريرك.');
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||'')||!['','identity'].includes(request.headers.get('Content-Encoding')||''))return fail('INVALID_REQUEST',415,'صيغة الطلب غير صالحة.');
 let body;try{body=await boundedJSON(request,4096);if(!plain(body)||Object.keys(body).length!==1||!UUID.test(body.order_id||''))throw Error();body.order_id=body.order_id.toLowerCase();}catch{return fail('INVALID_REQUEST',400,'أرسل رقم الطلب فقط.');}
 const base=env.SUPABASE_URL.replace(/\/$/,''),headers={apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:bearer};
 let user;try{const response=await satelliteFetch(base+'/auth/v1/user',{headers},8000);if(!response.ok)return [400,401,403].includes(response.status)?fail('AUTH_REQUIRED',401,'انتهت جلسة الدخول.'):fail('AUTH_UNAVAILABLE',502,'تعذر التحقق من الحساب.');user=await boundedJSON(response,32*1024);if(!UUID.test(user?.id||'')||user.is_anonymous===true)return fail('AUTH_REQUIRED',401,'سجّل الدخول بحسابك.');}catch{return fail('AUTH_UNAVAILABLE',502,'تعذر التحقق من الحساب.');}
 let order;try{const url=new URL(base+'/rest/v1/research_orders');url.searchParams.set('select','id,owner_id,status,approved_at,task_type,result');url.searchParams.set('id','eq.'+body.order_id);url.searchParams.set('owner_id','eq.'+user.id);url.searchParams.set('limit','1');const response=await satelliteFetch(url.href,{headers},8000);if(!response.ok)throw Error();const rows=await boundedJSON(response,160*1024);order=Array.isArray(rows)?rows[0]:null;}catch{return fail('ORDER_READ_FAILED',502,'تعذر قراءة التقرير.');}
 if(!order||order.id!==body.order_id||order.owner_id!==user.id)return fail('ORDER_UNAVAILABLE',404,'التقرير غير متاح لهذا الحساب.');
 if(!order.approved_at||!['completed','needs_review'].includes(order.status)||!['maps','combined'].includes(order.task_type))return fail('PAYMENT_REQUIRED',403,'الصورة متاحة ضمن تقرير خرائط مدفوع ومكتمل.');
 const maps=order.result?.maps,date=typeof maps?.date==='string'?maps.date.slice(0,10):'',day=new Date(date+'T00:00:00.000Z');
 if(!plain(maps)||!UUID.test(maps.field_id||'')||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==date||day>Date.now())return fail('REPORT_IMAGE_UNAVAILABLE',409,'لا يحتوي التقرير على حقل ومشهد صالحين للصورة.');
 // Recheck the present farm owner as well as the boundary check in the actual
 // satellite handler. A historical paid report does not transfer field access.
 try{const url=new URL(base+'/rest/v1/fields');url.searchParams.set('select','id,farms!inner(owner_id)');url.searchParams.set('id','eq.'+maps.field_id.toLowerCase());url.searchParams.set('farms.owner_id','eq.'+user.id);url.searchParams.set('limit','1');const response=await satelliteFetch(url.href,{headers},8000);if(!response.ok)throw Error();const rows=await boundedJSON(response,32*1024),field=Array.isArray(rows)?rows[0]:null,farm=Array.isArray(field?.farms)?field.farms[0]:field?.farms;if(field?.id!==maps.field_id.toLowerCase()||farm?.owner_id!==user.id)return fail('FIELD_UNAVAILABLE',404,'الحقل غير متاح لهذا الحساب الآن.');}catch{return fail('FIELD_READ_FAILED',502,'تعذر التحقق من ملكية الحقل.');}
 return satellite(new Request('https://internal-satellite/',{method:'POST',headers:{Authorization:bearer,'Content-Type':'application/json'},body:JSON.stringify({field_id:maps.field_id.toLowerCase(),action:'imagery',map_date:date,map_index:'NDVI'})}));
}
