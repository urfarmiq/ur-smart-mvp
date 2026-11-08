// Heavy GeoTIFF decoding runs in Supabase Edge, within the existing free tier.
// This Worker forwards only this fixed endpoint and never accepts a target URL.
export async function handleTerrainGateway(req,env,{reply,origin,fetchImpl=fetch}={}){
 const base=String(env.SUPABASE_URL||'').replace(/\/$/,'');
 const status=new URL(req.url).pathname==='/terrain/status';
 if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base)||!env.SUPABASE_PUBLISHABLE_KEY)return reply({error:'TERRAIN_NOT_CONFIGURED',message:'خدمة التضاريس غير مهيأة بعد.'},503,origin);
 if(status?req.method!=='GET':req.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED',message:'طريقة الطلب غير مدعومة.'},405,origin);
 const bearer=req.headers.get('authorization')||'';
 if(!status&&!/^Bearer [^ ]+$/.test(bearer))return reply({error:'LOGIN_REQUIRED',message:'سجّل الدخول لتحليل تضاريس حقلك.'},401,origin);
 const headers={'apikey':env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json',Origin:origin};
 if(bearer)headers.Authorization=bearer;
 try{
  let body;
  if(!status){
   const declared=req.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>8192))return reply({error:'REQUEST_TOO_LARGE',message:'حجم الطلب أكبر من الحد المسموح.'},413,origin);
   if(!req.body)return reply({error:'INVALID_REQUEST',message:'طلب التحليل غير صالح.'},400,origin);
   const reader=req.body.getReader(),chunks=[];let total=0;
   const consume=(async()=>{try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>8192){void reader.cancel().catch(()=>{});throw Error('BODY_LIMIT');}chunks.push(value);}const bytes=new Uint8Array(total);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}return bytes;}finally{try{reader.releaseLock();}catch{}}})();
   let timer;try{body=await Promise.race([consume,new Promise((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(Error('BODY_TIMEOUT'));},10000);})]);}catch(error){return reply({error:error.message==='BODY_LIMIT'?'REQUEST_TOO_LARGE':'INVALID_REQUEST',message:'تعذر قراءة طلب التحليل ضمن الحد المسموح.'},error.message==='BODY_LIMIT'?413:408,origin);}finally{clearTimeout(timer);}
  }
  const upstream=await fetchImpl(base+'/functions/v1/terrain-analysis'+(status?'/status':''),{method:status?'GET':'POST',headers,body,signal:AbortSignal.timeout(status?15000:110000),redirect:'error'});
  if(!/^application\/json(?:;|$)/i.test(upstream.headers.get('content-type')||'')){void upstream.body?.cancel().catch(()=>{});return reply({error:'TERRAIN_UNAVAILABLE',message:'تعذر الاتصال بخدمة التضاريس. أعد المحاولة لاحقًا.'},502,origin);}
  // Forward the already-authenticated Edge response as a stream, without
  // parsing large rasters within the Workers CPU budget or caching reports.
  return new Response(upstream.body,{status:upstream.status,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin,vary:'Origin','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
 }catch(error){return reply({error:error?.name==='TimeoutError'||error?.name==='AbortError'?'TERRAIN_TIMEOUT':'TERRAIN_UNAVAILABLE',message:'لم يكتمل تحليل التضاريس. قد يكون المصدر غير متاح أو تجاوز الطلب وقت المعالجة؛ لم نُنشئ نتيجة بديلة.'},error?.name==='TimeoutError'||error?.name==='AbortError'?504:502,origin);}
}
