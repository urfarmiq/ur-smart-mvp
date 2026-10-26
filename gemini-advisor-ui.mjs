import {buildAdvisorReport} from './advisor-handoff.mjs';

const RESPONSE_SECTIONS=[['evidence','المعلومات التي تستند إليها التوصية'],['missing_data','المعلومات الناقصة'],['irrigation','إرشادات الري المشروطة'],['fertilization','تقييم التسميد'],['follow_up','الفحص والمتابعة'],['limitations','حدود التوصية']];
const FIELD_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function prepareGeminiReport(report){
 if(!report||typeof report!=='object'||Array.isArray(report))throw Error('جهّز بيانات الحقل أولًا.');
 const weather=report.weather;
 const clean=buildAdvisorReport({field:report.field,satellite:report.satellite,weather:weather?{...weather,...weather.summary}:null,irrigationLogs:report.irrigation_logs||report.irrigationLogs,observations:report.observations});
 // The Worker will apply its own allowlist and verify field ownership again.
 delete clean.field.name;
 return clean;
}

export function parseGeminiRecommendation(value){
 const recommendation=value?.recommendation;
 if(!recommendation||typeof recommendation.summary!=='string'||!recommendation.summary.trim())throw Error('لم تصل توصية صالحة من المساعد.');
 const clean={summary:recommendation.summary.trim().slice(0,3000)};
 for(const [key] of RESPONSE_SECTIONS){
  const rows=recommendation[key];
  if(!Array.isArray(rows)||rows.some(row=>typeof row!=='string'))throw Error('لم تصل توصية صالحة من المساعد.');
  clean[key]=rows.slice(0,20).map(row=>row.trim().slice(0,1500)).filter(Boolean);
 }
 return {provider:'Google Gemini',model:typeof value.model==='string'?value.model.slice(0,100):null,generated_at:typeof value.generated_at==='string'?value.generated_at.slice(0,40):null,recommendation:clean};
}

export function geminiErrorMessage(status,code){
 if(status===401||code==='AUTH_REQUIRED')return 'انتهت جلسة الدخول أو لم تُسجّل الدخول. افتح حسابك ثم أعد المحاولة.';
 if(status===403||code==='FIELD_ACCESS_DENIED')return 'لا يمكنك طلب توصية لهذا الحقل من الحساب الحالي.';
 if(code==='ADVICE_BUSY')return 'يوجد طلب حديث لهذا الحساب. انتظر قليلًا ثم أعد المحاولة.';
 if(status===429||code==='FREE_QUOTA_EXHAUSTED')return 'وصل المساعد إلى حد الاستخدام المجاني أو حد الطلبات. أعد المحاولة لاحقًا؛ لن ننتقل تلقائيًا إلى خدمة مدفوعة.';
 if(status===503||code==='GEMINI_SETUP_REQUIRED'||code==='GEMINI_FREE_TIER_CONFIRMATION_REQUIRED')return 'ربط Gemini يحتاج إكمال إعداد المفتاح والخطة المجانية في الخادم. لا تضع المفتاح في المنصة أو المحادثة.';
 if(status===413)return 'التقرير أكبر من الحد المسموح. اختصر الملاحظات ثم جهّزه مجددًا.';
 if(status===400)return 'بعض بيانات الطلب غير صالحة. جهّز التقرير من الحقل المختار مجددًا.';
 return 'تعذر الحصول على توصية صالحة الآن. أعد المحاولة لاحقًا؛ لم يُنفّذ أي إجراء زراعي.';
}

function serverEndpoint(endpoint){
 const url=new URL(endpoint);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('عنوان خادم المساعد غير صالح.');
 return url.href.replace(/\/$/,'');
}

export async function requestGeminiAdvice({endpoint,fieldId,report,session,signal,fetchImpl=globalThis.fetch}){
 if(!FIELD_ID.test(fieldId||''))throw Error('اختر حقلًا محفوظًا في حسابك أولًا.');
 if(!session?.access_token)throw Error('سجّل الدخول لطلب توصية لحقل محفوظ.');
 const response=await fetchImpl(serverEndpoint(endpoint)+'/advice',{method:'POST',signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action:'advice',field_id:fieldId,report:prepareGeminiReport(report),consent:true})});
 let body;try{body=await response.json();}catch{throw Error(geminiErrorMessage(response.status));}
 if(!response.ok)throw Error(geminiErrorMessage(response.status,body?.code||body?.error_code));
 return parseGeminiRecommendation(body);
}

let counter=0;
export function createGeminiAdvisor({getContext,getSession,endpoint,fetchImpl=globalThis.fetch}){
 if(typeof getContext!=='function'||typeof getSession!=='function')throw Error('يلزم توفير بيانات الحقل والجلسة للمساعد.');
 const base=serverEndpoint(endpoint),prefix='ur-gemini-'+(++counter);
 const element=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
 const section=element('section');section.className='gemini-advisor';section.style.cssText='margin:18px 0;padding:16px;background:#eff7f1;border:1px solid #c6dccb;border-radius:12px;';
 const title=element('h3','توصية Gemini داخل المنصة'),lead=element('p','يراجع المساعد بيانات الحقل ويشرح توصيات مشروطة. لا يشغّل أجهزة الري ولا يطبّق جرعات تلقائيًا.');
 const availability=element('p','جارٍ فحص جاهزية المساعد…');availability.className='gemini-availability';availability.setAttribute('role','status');
 const refresh=element('button','تحديث حالة المساعد');refresh.type='button';refresh.className='secondary';
 const prepare=element('button','مراجعة البيانات قبل إرسالها إلى Gemini');prepare.type='button';prepare.className='secondary';
 const previewWrap=element('div');previewWrap.hidden=true;
 const label=element('label','البيانات التي ستُرسل للمساعد');label.htmlFor=prefix+'-preview';
 const preview=element('textarea');preview.id=prefix+'-preview';preview.className='gemini-preview';preview.readOnly=true;preview.rows=10;preview.dir='auto';preview.style.cssText='box-sizing:border-box;width:100%;font:13px/1.6 Tahoma,Arial,sans-serif;padding:10px;border:1px solid #b7ccbd;border-radius:8px;';
 const disclosure=element('p','تُستخدم مدخلات Gemini المجاني ومخرجاته لتحسين منتجات Google، وقد يراجعها أشخاص. يستبعد التقرير اسم الحقل ومعرّفاته وحدوده تلقائيًا، لكن ملاحظاتك قد تحتوي معلومات شخصية؛ احذفها من النموذج قبل تجهيز التقرير.');disclosure.style.fontSize='13px';
 const terms=element('a','شروط استخدام البيانات في Gemini');terms.href='https://ai.google.dev/gemini-api/terms';terms.target='_blank';terms.rel='noopener noreferrer';disclosure.append(' ',terms);
 const consentLabel=element('label');consentLabel.style.cssText='display:flex;gap:9px;align-items:flex-start;';
 const consent=element('input');consent.type='checkbox';consent.id=prefix+'-consent';consent.style.cssText='width:auto;min-width:18px;margin-top:7px;';
 consentLabel.htmlFor=consent.id;consentLabel.append(consent,element('span','راجعت البيانات وأوافق على إرسال هذا التقرير إلى Gemini وفق هذه الشروط.'));
 const send=element('button','طلب توصية Gemini');send.type='button';send.className='primary';send.disabled=true;
 const status=element('p','جهّز التقرير للمراجعة قبل طلب التوصية.');status.className='gemini-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const result=element('div');result.className='gemini-result';result.setAttribute('aria-live','polite');
 previewWrap.append(label,preview,disclosure,consentLabel,send);section.append(title,lead,availability,refresh,prepare,previewWrap,status,result);
 let available=false,busy=false,prepared=null,statusGeneration=0,contextGeneration=0;
 const identity=context=>String(context?.fieldId||'')+'\n'+String(context?.report?.satellite?.date||'').slice(0,10);
 const requestIsCurrent=request=>request.generation===contextGeneration&&identity(getContext())===request.identity;
 function sync(){send.disabled=!available||busy||!prepared||!consent.checked;prepare.disabled=busy;refresh.disabled=busy;consent.disabled=busy;}
 async function checkStatus(){
  const generation=++statusGeneration;refresh.disabled=true;availability.textContent='جارٍ فحص جاهزية المساعد…';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetchImpl(base+'/advice/status',{method:'GET',cache:'no-store',signal:controller.signal});
   const body=await response.json();if(generation!==statusGeneration)return;
   available=response.ok&&body.available===true;
   availability.textContent=available?'المساعد جاهز باستخدام الحصة المجانية المحددة في إعدادات الخادم.':'المساعد غير مفعّل بعد. يلزم إعداد مفتاح Gemini وتأكيد بقاء المشروع على الخطة المجانية في الخادم، ثم تحديث الحالة.';
  }catch{if(generation!==statusGeneration)return;available=false;availability.textContent='تعذر التحقق من جاهزية الخادم. حدّث الحالة لاحقًا؛ يمكنك مراجعة التقرير الآن.';}
  finally{clearTimeout(timeout);if(generation===statusGeneration)sync();}
 }
 function invalidate(message){contextGeneration++;prepared=null;consent.checked=false;preview.value='';previewWrap.hidden=true;result.replaceChildren();status.textContent=message;sync();}
 section.invalidateContext=(message='تغيّر الحقل أو المشهد. راجع تقريرًا جديدًا قبل طلب التوصية.')=>invalidate(message);
 prepare.onclick=()=>{
  try{const context=getContext();if(!FIELD_ID.test(context?.fieldId||''))throw Error('اختر حقلًا محفوظًا في حسابك أولًا.');prepared={fieldId:context.fieldId,identity:identity(context),generation:contextGeneration,report:prepareGeminiReport(context.report)};preview.value=JSON.stringify(prepared.report,null,2);previewWrap.hidden=false;consent.checked=false;result.replaceChildren();status.textContent='راجع البيانات والملاحظات. أعد تجهيزها إذا غيّرت الحقل أو تاريخ المشهد، ثم وافق على الإرسال.';sync();}
  catch(error){invalidate(error.message||'تعذر تجهيز بيانات الحقل.');}
 };
 consent.onchange=sync;
 refresh.onclick=checkStatus;
 send.onclick=async()=>{
  if(busy||!prepared||!consent.checked||!available)return;
  const request=prepared;let controller,timeout;
  try{
   if(!requestIsCurrent(request)){invalidate('تغيّر الحقل أو المشهد. راجع التقرير الجديد قبل الإرسال.');return;}
   busy=true;sync();result.replaceChildren();status.textContent='جارٍ طلب التوصية من Gemini…';
   const session=await getSession();
   if(!requestIsCurrent(request)){invalidate('تغيّر الحقل أو المشهد؛ لم تُرسل البيانات.');return;}
   controller=new AbortController();timeout=setTimeout(()=>controller.abort(),45000);
   const response=await requestGeminiAdvice({endpoint:base,fieldId:request.fieldId,report:request.report,session,signal:controller.signal,fetchImpl});
   if(!requestIsCurrent(request)||!section.isConnected){invalidate('تغيّر الحقل أو المشهد أثناء الطلب. لم تُعرض التوصية القديمة؛ جهّز التقرير الجديد.');return;}
   result.append(element('h4','توصية Gemini'),element('p',response.recommendation.summary));
   const meta=element('p',[response.provider,response.model,response.generated_at].filter(Boolean).join(' · '));meta.style.fontSize='12px';result.append(meta);
   for(const [key,heading] of RESPONSE_SECTIONS){const rows=response.recommendation[key];if(!rows.length)continue;result.append(element('strong',heading));const list=element('ul');for(const row of rows)list.append(element('li',row));result.append(list);}
   status.textContent='ظهرت التوصية للمراجعة. لم تُطبّق أي عملية ري أو تسميد تلقائيًا.';
  }catch(error){
   let changed=false;try{changed=!requestIsCurrent(request);}catch{changed=true;}
   if(changed)invalidate('تغيّر الحقل أو المشهد. راجع التقرير الجديد قبل طلب التوصية.');
   else status.textContent=error?.name==='AbortError'?'انتهت مهلة طلب التوصية. أعد المحاولة لاحقًا.':error?.message||'تعذر طلب التوصية.';
  }finally{clearTimeout(timeout);busy=false;sync();}
 };
 void checkStatus();
 return section;
}
