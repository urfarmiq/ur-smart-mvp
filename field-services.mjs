import {withDeadline} from './request-deadline.mjs';

const $=id=>document.getElementById(id);
const API='https://ur-smart-satellite.alialbatekh111.workers.dev';
const PROJECT='https://ynsmhtsktbubxfhsekjq.supabase.co';
const PUBLIC_KEY='sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc';
const ORDER_COLUMNS='id,owner_id,field_id,service_type,request_note,cadence_days,report_count,status,quote_iqd,quote_scope,quote_version,quoted_at,accepted_at,payment_reference,approved_at,created_at,updated_at,completed_reports,period_attempts,started_at,next_due_at';
const REPORT_COLUMNS='id,order_id,owner_id,report_number,due_at,status,created_at,result';
const SERVICES={field_report:'تقرير شامل للحقل',field_monitoring:'متابعة الحقل الدورية'};
const STATUSES={waiting_quote:'بانتظار عرض الإدارة',quoted:'عرض جاهز للمراجعة',awaiting_payment:'بانتظار تأكيد الدفع',approved:'جاهز للتنفيذ عند الاستحقاق',running:'جارٍ إعداد التقرير',completed:'اكتمل العدد المتفق عليه',failed:'تعذّر التنفيذ؛ راجع المحاولة',rejected:'رفضت الإدارة الطلب'};
const REPORT_STATUSES={completed:'تقرير محفوظ',needs_review:'تقرير جزئي يحتاج مراجعة',failed:'تعذّر التنفيذ'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const params=new URLSearchParams(location.search),initialService=params.get('service'),initialField=params.get('field');
if(Object.hasOwn(SERVICES,initialService))$('serviceType').value=initialService;
let client=null,clientPromise=null,session=null,ownerId=null,generation=0,selectionGeneration=0,authReloadTimer=null,lastAuthOwner=null;
let fields=[],orders=[],reports=[],selectedId=null,selectedQuoteKey='',reportSnapshot=null;
let checking=false,loadingFields=false,loadingOrders=false,loadingReports=false,creating=false,accepting=false,running=false,serviceAvailable=false,statusGeneration=0;
const controllers=new Set();
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined&&text!==null)el.textContent=String(text);if(className)el.className=className;return el;};
const number=(value,digits=1)=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('ar-IQ',{maximumFractionDigits:digits}).format(value):'غير متاح';
const isNumber=value=>typeof value==='number'&&Number.isFinite(value);
const dateText=value=>{if(typeof value!=='string'||!value)return 'غير متاح';const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'}).format(date)+' — بغداد':'غير متاح';};
const dateOnly=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}/.test(value)?dateText(value):'غير متاح';
const say=(id,message,error=false)=>{const el=$(id);el.textContent=message;el.hidden=!message;el.classList.toggle('error',error);};
const order=()=>orders.find(row=>row.id===selectedId&&row.owner_id===ownerId)||null;
const fieldName=id=>id===null?'حقل محذوف — التقارير السابقة محفوظة':fields.find(row=>row.id===id)?.name||'حقل غير متاح حاليًا';
const remaining=row=>Math.max(0,Number(row?.report_count||0)-Number(row?.completed_reports||0));
function canRun(row){
 const due=Date.parse(row?.next_due_at||'');
 return !!row&&UUID.test(row.field_id||'')&&fields.some(field=>field.id===row.field_id)&&!!row.approved_at&&!!row.accepted_at&&['approved','failed'].includes(row.status)&&remaining(row)>0&&Number(row.period_attempts||0)<3&&Number.isFinite(due)&&due<=Date.now();
}
function sync(){
 const signed=!!ownerId;
 $('orderFields').disabled=!signed||creating; $('createOrder').disabled=!signed||creating||!fields.some(field=>field.id===$('orderField').value);
 $('refreshFields').disabled=!signed||loadingFields; $('refreshOrders').disabled=!signed||loadingOrders;
 $('retryAccount').disabled=checking; $('orderField').disabled=!signed||loadingFields||!fields.length;
 const selected=order();
 $('acceptQuote').disabled=!signed||accepting||selected?.status!=='quoted'||!isNumber(selected?.quote_iqd)||selected.quote_iqd<=0||!selected?.quote_scope||!$('acceptQuoteConsent').checked;
 $('quotePaymentReference').disabled=accepting; $('acceptQuoteConsent').disabled=accepting;
 $('runReport').disabled=!signed||running||!serviceAvailable||!canRun(selected)||!$('runConsent').checked;
 $('runReport').textContent=running?'جارٍ إعداد التقرير…':'إنشاء التقرير المستحق';
 $('downloadReport').disabled=$('printReport').disabled=!reportSnapshot;
}
function clearReport(){reportSnapshot=null;$('reportPanel').hidden=true;$('reportContent').replaceChildren();$('reportMeta').textContent='';$('reportQuality').textContent='';sync();}
function clearSelection(){
 selectionGeneration++;selectedId=null;selectedQuoteKey='';reports=[];accepting=false;running=false;$('executionMapLink').hidden=true;
 $('selectedPanel').hidden=true;$('selectedTitle').textContent='';$('selectedOrderMeta').textContent='';$('selectedPlan').textContent='';$('quoteAmount').textContent='';$('quoteScope').textContent='';$('quoteMeta').textContent='';$('selectedRequestNote').textContent='';$('quotePaymentReference').value='';$('acceptQuoteConsent').checked=false;$('runConsent').checked=false;$('reportsList').replaceChildren();$('planProgress').replaceChildren();$('paymentStatus').textContent='';for(const id of ['quoteStatus','executionStatus','reportsStatus'])say(id,'');clearReport();
}
function resetPrivate(message){
 generation++;selectionGeneration++;for(const controller of controllers)controller.abort();controllers.clear();ownerId=null;session=null;fields=[];orders=[];reports=[];creating=false;loadingFields=false;loadingOrders=false;loadingReports=false;accepting=false;running=false;
 clearSelection();$('orderForm').reset();if(Object.hasOwn(SERVICES,initialService))$('serviceType').value=initialService;serviceFields();$('orderField').replaceChildren(new Option('سجّل الدخول لعرض حقولك',''));$('ordersList').replaceChildren();$('paidContent').hidden=true;$('loginLink').hidden=false;$('accountStatus').textContent=message;for(const id of ['createStatus','fieldsStatus','ordersStatus'])say(id,'');sync();
}
function authChange(event,incoming){
 if(event==='INITIAL_SESSION'){lastAuthOwner=incoming?.user?.id??null;return;}
 if(event==='SIGNED_OUT'){lastAuthOwner=null;clearTimeout(authReloadTimer);resetPrivate('لا توجد جلسة دخول. استخدم حساب أور الحالي لعرض طلباتك.');return;}
 if(!['SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event)||!incoming?.user?.id)return;
 if(lastAuthOwner&&lastAuthOwner!==incoming.user.id){resetPrivate('تغيّر الحساب؛ جارٍ تحميل بيانات الحساب الحالي.');lastAuthOwner=incoming.user.id;clearTimeout(authReloadTimer);authReloadTimer=setTimeout(()=>void openAccount(),0);return;}
 lastAuthOwner=incoming.user.id;if(ownerId===incoming.user.id){session=incoming;return;}
 if(!checking){clearTimeout(authReloadTimer);authReloadTimer=setTimeout(()=>void openAccount(),0);}
}
async function connection(){
 if(client)return client;
 if(!clientPromise)clientPromise=withDeadline(import('./supabase-client.mjs')).then(({createClient})=>{client=createClient(PROJECT,PUBLIC_KEY);client.auth.onAuthStateChange?.(authChange);return client;}).catch(error=>{clientPromise=null;throw error;});
 return clientPromise;
}
async function currentSession(token,expected=ownerId){
 const response=await withDeadline(client.auth.getSession());if(token!==generation)return null;
 const value=response.data?.session;if(response.error)throw Error('تعذر التحقق من الجلسة الآن. أعد الاتصال دون مسح بياناتك.');
 if(!value?.access_token||value.user?.id!==expected){resetPrivate('انتهت الجلسة أو تغيّر الحساب. سجّل الدخول بالحساب الحالي ثم أعد المحاولة.');return null;}
 session=value;return value;
}
async function openAccount(){
 if(checking)return;checking=true;const attempt=++generation,previous=ownerId;for(const c of controllers)c.abort();controllers.clear();clearSelection();orders=[];fields=[];$('ordersList').replaceChildren();$('orderField').replaceChildren(new Option('جارٍ استعادة حقولك…',''));$('paidContent').hidden=true;session=null;ownerId=null;$('accountStatus').textContent='جارٍ استعادة جلسة حسابك…';sync();
 try{
  const sdk=await connection();if(attempt!==generation)return;
  const response=await withDeadline(sdk.auth.getSession());if(attempt!==generation)return;
  if(response.error)throw Error('session unavailable');const value=response.data?.session;
  if(!value?.access_token||!UUID.test(value.user?.id||'')){resetPrivate('سجّل الدخول بحساب أور الحالي لإنشاء طلب ومراجعة عروضه.');return;}
  if((previous&&previous!==value.user.id)||(lastAuthOwner&&lastAuthOwner!==value.user.id)){$('orderForm').reset();if(Object.hasOwn(SERVICES,initialService))$('serviceType').value=initialService;serviceFields();}
  session=value;ownerId=value.user.id;lastAuthOwner=ownerId;$('paidContent').hidden=false;$('loginLink').hidden=true;$('accountStatus').textContent='تم الاتصال بحسابك. تظهر حقولك وطلباتك فقط.';
  await Promise.allSettled([loadFields(),loadOrders()]);
 }catch{if(attempt===generation){$('accountStatus').textContent='تعذر الاتصال بالحساب الآن. أعد المحاولة؛ لم نمسح جلسة الدخول أو الحقول.';$('loginLink').hidden=false;}}
 finally{checking=false;sync();}
}
async function availability(){
 const attempt=++statusGeneration;serviceAvailable=false;$('serviceStatus').textContent='جارٍ التحقق من خدمة التقارير…';sync();
 try{const response=await fetch(API+'/field-service/status',{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(12000)}),status=await response.json();if(attempt!==statusGeneration)return;serviceAvailable=response.ok&&status?.available===true;$('serviceStatus').textContent=serviceAvailable?'خدمة التقارير مهيأة؛ التنفيذ بعد الموافقة والدفع وعند الاستحقاق.':'خدمة التقارير غير متاحة للتنفيذ الآن. يمكنك مراجعة طلباتك والمحاولة لاحقًا.';}
 catch{if(attempt===statusGeneration)$('serviceStatus').textContent='تعذر التحقق من جاهزية الخدمة؛ أعد الاتصال للمحاولة.';}
 finally{if(attempt===statusGeneration)sync();}
}
function serviceFields(){const monitoring=$('serviceType').value==='field_monitoring';$('monitoringControls').hidden=!monitoring;$('serviceDescription').textContent=monitoring?'سلسلة تقارير للحقل نفسه، بعدد وفاصل تقترحهما وتؤكدهما الإدارة في العرض.':'تقرير واحد يجمع بيانات الحقل والطقس والمشهد الفضائي المتاح مع الإرشاد وحدود البيانات.';$('reportCount').required=monitoring;}
async function loadFields(){
 if(!ownerId||loadingFields)return;const token=generation,account=ownerId,previous=$('orderField').value;loadingFields=true;sync();say('fieldsStatus','جارٍ تحميل الحقول المحفوظة…');
 try{const response=await withDeadline(client.from('fields').select('id,name,farms!inner(owner_id)').eq('farms.owner_id',account).order('name'));if(token!==generation||ownerId!==account)return;if(response.error)throw Error();fields=(Array.isArray(response.data)?response.data:[]).filter(row=>UUID.test(row?.id||'')&&typeof row.name==='string'&&row.farms?.owner_id===account);$('orderField').replaceChildren(new Option(fields.length?'اختر الحقل':'لا توجد حقول محفوظة',''));for(const field of fields)$('orderField').add(new Option(field.name,field.id));
  const wanted=previous||initialField;if(wanted&&fields.some(field=>field.id===wanted))$('orderField').value=wanted;
  say('fieldsStatus',initialField&&!fields.some(field=>field.id===initialField)?'الحقل المطلوب غير متاح لهذا الحساب. اختر أحد حقولك دون تحميل بيانات حقل آخر.':fields.length?'سيُربط الطلب بهذا الحقل ولا يتغير بعد إنشائه.':'أضف حقلًا وحدوده من الخريطة ثم حدّث القائمة.');
 }catch{if(token===generation)say('fieldsStatus','تعذر تحميل حقول الحساب. اضغط تحديث للمحاولة مجددًا.',true);}
 finally{if(token===generation){loadingFields=false;renderOrders();if(order())renderSelected();sync();}}
}
function normalizeOrders(rows){return (Array.isArray(rows)?rows:[]).filter(row=>row&&UUID.test(row.id||'')&&row.owner_id===ownerId&&(row.field_id===null||UUID.test(row.field_id||''))&&Object.hasOwn(SERVICES,row.service_type)&&Object.hasOwn(STATUSES,row.status)&&Number.isInteger(row.report_count)&&row.report_count>=1&&row.report_count<=12&&Number.isInteger(row.completed_reports)&&row.completed_reports>=0&&row.completed_reports<=row.report_count);}
async function loadOrders(){
 if(!ownerId||loadingOrders)return;const token=generation,account=ownerId;loadingOrders=true;sync();say('ordersStatus','جارٍ تحميل الطلبات…');
 try{const response=await withDeadline(client.from('field_service_orders').select(ORDER_COLUMNS).eq('owner_id',account).order('created_at',{ascending:false}).limit(50));if(token!==generation||ownerId!==account)return;if(response.error)throw Error();orders=normalizeOrders(response.data);if(selectedId&&!order())clearSelection();renderOrders();if(order()){renderSelected();void loadReports();}say('ordersStatus',orders.length?'آخر تحديث: '+dateText(new Date().toISOString()):'لا توجد طلبات بعد. أنشئ طلبك الأول لمراجعة الإدارة.');
 }catch{if(token===generation)say('ordersStatus','تعذر تحميل الطلبات. أعد التحديث؛ بياناتك المحفوظة لم تتغير.',true);}
 finally{if(token===generation){loadingOrders=false;sync();}}
}
function renderOrders(){
 const list=$('ordersList');list.replaceChildren();for(const row of orders){const card=node('article',undefined,'order-card'+(row.id===selectedId?' selected':'')),head=node('div',undefined,'order-top');head.append(node('h3',SERVICES[row.service_type]),node('span',STATUSES[row.status],'badge '+row.status));card.append(head,node('p',fieldName(row.field_id)),node('p','رقم الطلب: '+row.id),node('p',row.service_type==='field_monitoring'?number(row.report_count,0)+' تقارير · فاصل '+number(row.cadence_days,0)+' يومًا':'تقرير واحد'),node('p','أُنشئ: '+dateText(row.created_at)));if(isNumber(row.quote_iqd))card.append(node('p','عرض الإدارة: '+number(row.quote_iqd,0)+' دينار عراقي'));const button=node('button','عرض الطلب وتقاريره','button secondary');button.type='button';button.dataset.orderId=row.id;button.onclick=()=>chooseOrder(row.id);card.append(button);list.append(card);}
}
function chooseOrder(id){
 const chosen=orders.find(row=>row.id===id&&row.owner_id===ownerId);if(!chosen)return;selectionGeneration++;selectedId=id;selectedQuoteKey='';reports=[];running=false;accepting=false;clearReport();$('runConsent').checked=false;$('executionMapLink').hidden=true;$('quotePaymentReference').value='';$('acceptQuoteConsent').checked=false;say('quoteStatus','');say('executionStatus','');$('reportsList').replaceChildren();renderOrders();renderSelected();void loadReports();
}
function renderSelected(){
 const row=order();if(!row){$('selectedPanel').hidden=true;return;}
 $('selectedPanel').hidden=false;$('selectedTitle').textContent=SERVICES[row.service_type];$('selectedOrderStatus').textContent=STATUSES[row.status];$('selectedOrderStatus').className='badge '+row.status;$('selectedOrderMeta').textContent=fieldName(row.field_id)+' · رقم الطلب: '+row.id+' · '+dateText(row.created_at);$('selectedRequestNote').textContent=row.request_note||'';$('selectedRequestNote').hidden=!row.request_note;
 const plan=row.service_type==='field_monitoring'?number(row.report_count,0)+' تقارير عند الطلب · يبدأ الاستحقاق التالي بعد إتمام السابق بـ '+number(row.cadence_days,0)+' يومًا':'تقرير واحد عند الطلب';$('selectedPlan').textContent=plan;
 const quoteValid=isNumber(row.quote_iqd)&&row.quote_iqd>0&&typeof row.quote_scope==='string'&&row.quote_scope.trim();$('quoteDetails').hidden=!quoteValid;$('quoteAmount').textContent=quoteValid?number(row.quote_iqd,0)+' د.ع':'';$('quoteScope').textContent=row.quote_scope||'';$('quoteMeta').textContent='نسخة العرض: '+number(row.quote_version,0)+' · '+plan+(row.quoted_at?' · '+dateText(row.quoted_at):'');$('quoteAcceptance').hidden=row.status!=='quoted';
 const key=[row.id,row.quote_version,row.status,row.quote_iqd,row.quote_scope,row.cadence_days,row.report_count].join('|');if(key!==selectedQuoteKey){selectedQuoteKey=key;$('acceptQuoteConsent').checked=false;$('quotePaymentReference').value=row.payment_reference||'';$('runConsent').checked=false;say('quoteStatus','');clearReport();}
 const messages={waiting_quote:'الطلب لدى الإدارة لمراجعة النطاق وإعداد العرض. لم يبدأ التنفيذ أو الدفع.',quoted:'راجع المبلغ والنطاق أعلاه، ثم وافق على هذا العرض قبل تنسيق الدفع.',awaiting_payment:'وافقت على العرض. تنتظر الخدمة تأكيد الإدارة لاستلام الدفع قبل التنفيذ.',approved:'أكدت الإدارة الدفع؛ يمكنك إنشاء التقرير عند استحقاقه.',running:'بدأ إعداد تقرير لهذا الطلب. حدّث الطلبات للاطلاع على النتيجة؛ لا تطلب تنفيذًا مكررًا.',completed:'اكتمل عدد التقارير المتفق عليه. يمكنك مراجعة التقارير المحفوظة وتنزيلها.',failed:'تعذر إعداد التقرير السابق. راجع رسالة الحالة وحدّث الطلب لإعادة المحاولة عند إتاحتها.',rejected:'رفضت الإدارة هذا الطلب. راجع نطاقه معها قبل إنشاء طلب جديد.'};$('paymentStatus').textContent=messages[row.status]||'';
 const progress=$('planProgress');progress.replaceChildren();for(const [title,value] of [['المتفق عليه',number(row.report_count,0)],['المحفوظ',number(row.completed_reports,0)],['المتبقي',number(remaining(row),0)]]){const item=node('div',undefined,'plan-metric');item.append(node('span',title),node('strong',value));progress.append(item);}
 $('nextReportDue').textContent=!UUID.test(row.field_id||'')||!fields.some(field=>field.id===row.field_id)?'الحقل غير متاح في حسابك حاليًا؛ حُفظ سجل الطلب وتقاريره، ويتوقف التنفيذ حتى مراجعة الإدارة.':remaining(row)===0?'اكتمل العدد المتفق عليه.':Number(row.period_attempts||0)>=3?'بلغت الفترة حد محاولات التنفيذ. تواصل مع الإدارة قبل إعادة المحاولة؛ التقارير الفاشلة لا تُحتسب ضمن العدد.':row.next_due_at?'الاستحقاق القادم: '+dateText(row.next_due_at)+(Date.parse(row.next_due_at)>Date.now()?' · يتاح التنفيذ عند الطلب بعد هذا الموعد.':' · راجع حالة الموافقة قبل التنفيذ.'):'يحدد موعد أول تقرير بعد تأكيد الدفع. التقرير الجزئي المحفوظ يُحتسب ضمن عدد التقارير.';sync();
}
async function createOrder(event){
 event.preventDefault();if(creating||!ownerId||!$('orderForm').reportValidity())return;const selectedField=fields.find(field=>field.id===$('orderField').value);if(!selectedField){say('createStatus','اختر حقلًا من حسابك أولًا.',true);return;}
 const type=$('serviceType').value,monitoring=type==='field_monitoring',count=monitoring?Number($('reportCount').value):1,cadence=monitoring?Number($('cadenceDays').value):null;
 if(!Object.hasOwn(SERVICES,type)||!Number.isInteger(count)||(monitoring&&(count<2||count>12||![7,14,30].includes(cadence)))){say('createStatus','راجع نوع الخدمة وعدد التقارير والفاصل بينها.',true);return;}
 const token=generation,account=ownerId;creating=true;sync();say('createStatus','جارٍ إنشاء الطلب لمراجعة الإدارة…');
 try{if(!await currentSession(token,account))return;const response=await withDeadline(client.rpc('create_field_service_order',{p_field_id:selectedField.id,p_service_type:type,p_request_note:$('orderNotes').value.trim()||null,p_cadence_days:cadence,p_report_count:count}));if(token!==generation||ownerId!==account)return;if(response.error)throw Error();const value=Array.isArray(response.data)?response.data[0]:response.data;if(!UUID.test(value?.id||''))throw Error();$('orderNotes').value='';say('createStatus','أُنشئ الطلب. ستراجعه الإدارة وتحدد عرض الخدمة قبل الدفع. رقم الطلب: '+value.id);await loadOrders();if(token===generation&&orders.some(row=>row.id===value.id))chooseOrder(value.id);
 }catch{if(token===generation)say('createStatus','تعذر إنشاء الطلب. تحقق من الاتصال ثم أعد المحاولة؛ لم نعرض تأكيد دفع أو تنفيذ.',true);}
 finally{if(token===generation){creating=false;sync();}}
}
async function acceptQuote(){
 const row=order();if(!row||accepting||row.status!=='quoted'||!$('acceptQuoteConsent').checked)return;const token=generation,selection=selectionGeneration,account=ownerId,id=row.id,version=row.quote_version;accepting=true;sync();say('quoteStatus','جارٍ اعتماد موافقتك على نسخة العرض…');
 try{if(!await currentSession(token,account)||selection!==selectionGeneration)return;const response=await withDeadline(client.rpc('accept_field_service_quote',{p_order_id:id,p_quote_version:version,p_payment_reference:$('quotePaymentReference').value.trim()||null}));if(token!==generation||selection!==selectionGeneration||ownerId!==account)return;if(response.error)throw Error();const value=Array.isArray(response.data)?response.data[0]:response.data;if(value?.id!==id||value?.status!=='awaiting_payment')throw Error();say('quoteStatus','تمت الموافقة على العرض. التنفيذ ينتظر تأكيد الإدارة لاستلام الدفع.');await loadOrders();
 }catch{if(token===generation&&selection===selectionGeneration)say('quoteStatus','تعذر اعتماد العرض، أو تغيرت نسخته. حدّث الطلب وراجع أحدث مبلغ ونطاق قبل المحاولة.',true);}
 finally{if(token===generation&&selection===selectionGeneration){accepting=false;sync();}}
}
async function loadReports(){
 const row=order();if(!row)return;const token=generation,selection=selectionGeneration,id=row.id,account=ownerId;loadingReports=true;say('reportsStatus','جارٍ تحميل تقارير الطلب…');
 try{const response=await withDeadline(client.from('field_service_reports').select(REPORT_COLUMNS).eq('order_id',id).eq('owner_id',account).order('report_number',{ascending:false}).limit(12));if(token!==generation||selection!==selectionGeneration||selectedId!==id||ownerId!==account)return;if(response.error)throw Error();reports=(Array.isArray(response.data)?response.data:[]).filter(item=>item&&UUID.test(item.id||'')&&item.order_id===id&&item.owner_id===account&&Number.isInteger(item.report_number)&&item.report_number>=1&&item.report_number<=row.report_count&&['completed','needs_review','failed'].includes(item.status));renderReports();say('reportsStatus',reports.length?'التقارير المحفوظة لهذا الطلب فقط.':'لا توجد تقارير محفوظة بعد.');
 }catch{if(token===generation&&selection===selectionGeneration)say('reportsStatus','تعذر تحميل التقارير الآن. حدّث الطلب للمحاولة مجددًا.',true);}
 finally{if(token===generation&&selection===selectionGeneration)loadingReports=false;}
}
function renderReports(){
 const box=$('reportsList');box.replaceChildren();for(const item of reports){const card=node('article',undefined,'report-card');card.append(node('h4','التقرير '+number(item.report_number,0)),node('p',REPORT_STATUSES[item.status]),node('p','تاريخ الحفظ: '+dateText(item.created_at)),node('p','موعد الفترة: '+dateText(item.due_at)));const button=node('button','عرض التقرير','button secondary');button.type='button';button.dataset.reportId=item.id;button.disabled=!item.result;button.onclick=()=>showReport(item);card.append(button);box.append(card);}
}
async function runReport(){
 const row=order();if(!row||running||!canRun(row)||!$('runConsent').checked||!serviceAvailable)return;const token=generation,selection=selectionGeneration,account=ownerId,id=row.id;running=true;clearReport();$('executionMapLink').hidden=true;say('executionStatus','جارٍ جلب بيانات الحقل وإعداد التقرير. أبقِ الصفحة مفتوحة…');sync();const controller=new AbortController();controllers.add(controller);let timer;
 try{const active=await currentSession(token,account);if(!active||selection!==selectionGeneration)return;timer=setTimeout(()=>controller.abort(),180000);const response=await fetch(API+'/field-service',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+active.access_token},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,body:JSON.stringify({order_id:id,consent:true})});const raw=await response.text();if(token!==generation||selection!==selectionGeneration||ownerId!==account)return;if(raw.length>600000)throw Error('وصل تقرير أكبر من الحجم المقبول. حدّث الطلب للتحقق من الحالة.');let data;try{data=JSON.parse(raw);}catch{throw Error('تعذر قراءة رد الخدمة. حدّث الطلب قبل إعادة التنفيذ.');}
  if(!response.ok){if(response.status===401){resetPrivate('انتهت جلسة الدخول. افتح حسابك مجددًا قبل متابعة الطلب.');return;}if(data?.code==='FIELD_UNAVAILABLE'){$('executionMapLink').hidden=false;throw Error('الحقل أو حدوده غير متاحة لهذا الحساب. راجع الحقل واحفظ حدوده من الخريطة قبل إعادة المحاولة.');}throw Error(typeof data?.message==='string'&&data.message.length<1400?data.message:'تعذر تنفيذ الطلب الآن. حدّثه للتحقق من الموافقة والاستحقاق.');}
  if(data.order_id!==id||!UUID.test(data.report_id||'')||!Number.isInteger(data.report_number)||!['completed','needs_review','failed'].includes(data.status))throw Error('لم يصل تقرير صالح لهذا الطلب. حدّث القائمة للتحقق من حالته.');
  const record={id:data.report_id,order_id:id,owner_id:account,report_number:data.report_number,due_at:data.result?.due_at,status:data.status,created_at:data.result?.created_at,result:data.result};showReport(record);say('executionStatus',data.status==='failed'?'تعذر الحصول على تقرير صالح؛ لا تُحتسب هذه المحاولة ضمن العدد المتفق عليه. راجع سجل المحاولة.':data.status==='needs_review'?'حُفظ تقرير جزئي من البيانات المتاحة؛ يُحتسب ضمن العدد المتفق عليه. راجع القيود والمصادر.':'حُفظ التقرير. راجع المصادر والتاريخ والتوصيات قبل استخدامها.',data.status==='failed');await loadOrders();if(token===generation&&selection===selectionGeneration){await loadReports();const saved=reports.find(item=>item.id===record.id);if(saved)showReport(saved);}
 }catch(error){if(token===generation&&selection===selectionGeneration)say('executionStatus',error?.name==='AbortError'?'انتهت مهلة الانتظار. حدّث الطلب للتحقق من حالته قبل إعادة التنفيذ.':error?.message||'تعذر تنفيذ الطلب الآن.',true);}
 finally{clearTimeout(timer);controllers.delete(controller);if(token===generation&&selection===selectionGeneration){running=false;sync();void loadOrders();}}
}
const LABELS={schema_version:'نسخة التقرير',created_at:'تاريخ التقرير',service_type:'الخدمة',report_number:'رقم التقرير',due_at:'موعد الفترة',field:'بيانات الحقل',id:'المعرّف',name:'اسم الحقل',crop:'المحصول',area_donum:'المساحة بالدونم العراقي',soil:'نوع التربة',irrigation:'طريقة الري',satellite:'المؤشرات الفضائية',source:'المصدر',date:'تاريخ المشهد',valid_pixels:'البكسلات الصالحة',geometry_pixels:'بكسلات الحقل',coverage_percent:'تغطية المشهد %',resolution_m:'دقة المصدر بالمتر',geometry:'حدود الحقل',series:'المشاهد المتاحة',indices:'المؤشرات',weather:'الطقس',source_url:'رابط المصدر',source_license:'الترخيص',timezone:'التوقيت',fetched_at:'آخر جلب',model_updated_at:'تحديث النموذج',current:'الحالة المقدّرة الحالية',daily:'الأيام القادمة',rain_forecast:'الهطول المتوقع',alerts:'الإرشادات الجوية',temperature_c:'الحرارة °م',tmax_c:'العظمى °م',tmin_c:'الصغرى °م',humidity_percent:'الرطوبة %',wind_kmh:'الرياح كم/ساعة',wind_max_kmh:'أعلى رياح كم/ساعة',wind_gusts_max_kmh:'أعلى هبّات كم/ساعة',precipitation_mm:'الهطول ملم',time:'الوقت',start:'بداية الفترة',end:'نهاية الفترة',covered_hours:'الساعات المغطاة',complete:'اكتمال التغطية',total_hours:'مجموع الساعات',known_precipitation_mm:'الهطول المعلوم ملم',rain_probability_percent:'احتمال الهطول %',rain_probability_percent_max:'أعلى احتمال لفترة %',next_rain:'أقرب فترة هطول',interval_seconds:'مدة الفترة بالثواني',irrigation_logs:'سجل الري المتاح',irrigated_at:'تاريخ الري',water_depth_mm:'عمق الماء ملم',duration_minutes:'مدة الري بالدقائق',method:'الطريقة',notes:'ملاحظات',comparison:'المقارنة بالتقرير السابق',previous_report_at:'تاريخ التقرير السابق',previous_scene_date:'تاريخ المشهد السابق',current_scene_date:'تاريخ المشهد الحالي',same_scene:'المشهد نفسه',deltas:'فرق المؤشر',recommendations:'التوصيات الأولية',limitations:'حدود البيانات',summary:'ملخص التقرير',interpretation:'الإرشاد',weather_code:'رمز الحالة الجوية',note:'ملاحظة',field_id:'معرّف الحقل',stale:'قدم الحالة الحالية',kind:'النوع',level:'المستوى',title:'العنوان',text:'الوصف'};
LABELS.source_license_url='رابط الترخيص';
function stringValue(value){return value===null||value===undefined?'غير متاح':typeof value==='boolean'?(value?'نعم':'لا'):isNumber(value)?number(value,4):String(value);}
function plain(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
function validateReport(record,row){
 const value=record?.result;if(!plain(value)||value.schema_version!==1||!plain(value.field)||!UUID.test(value.field.id||'')||(row.field_id!==null&&value.field.id!==row.field_id)||value.service_type!==row.service_type||value.report_number!==record.report_number||!Number.isInteger(value.report_number)||value.report_number<1||value.report_number>row.report_count||!Number.isFinite(Date.parse(value.created_at||''))||!plain(value.sources))throw Error('invalid report');
 for(const key of ['summary'])if(typeof value[key]!=='string'||value[key].length>5000)throw Error('invalid report');
 for(const key of ['recommendations','limitations','notes'])if(!Array.isArray(value[key])||value[key].length>30||value[key].some(item=>typeof item!=='string'||item.length>5000))throw Error('invalid report');
 let encoded;try{encoded=JSON.stringify(value);}catch{throw Error('invalid report');}if(encoded.length>550000)throw Error('invalid report');return value;
}
function scalarGrid(parent,entries){if(!entries.length)return;const dl=node('dl',undefined,'data-grid');for(const [key,value] of entries){const item=node('div',undefined,'data-item');item.append(node('dt',LABELS[key]||key),node('dd',stringValue(value)));dl.append(item);}parent.append(dl);}
function renderData(parent,value,{depth=0,budget={count:0}}={}){
 if(depth>5||++budget.count>500)return;
 if(value===null||value===undefined){parent.append(node('p','غير متاح'));return;}
 if(Array.isArray(value)){if(!value.length){parent.append(node('p','لا توجد بيانات متاحة في هذا القسم.','hint'));return;}if(value.every(item=>item===null||['string','number','boolean'].includes(typeof item))){const list=node('ul');for(const item of value.slice(0,30))list.append(node('li',stringValue(item)));parent.append(list);return;}
  for(const item of value.slice(0,12)){if(!plain(item))continue;const block=node('div',undefined,'record-block');renderData(block,item,{depth:depth+1,budget});parent.append(block);}return;
 }
 if(plain(value)){
  const entries=Object.entries(value).filter(([key])=>!['geometry','sources','field_id','id','owner_id'].includes(key));scalarGrid(parent,entries.filter(([,item])=>item===null||['string','number','boolean'].includes(typeof item)).slice(0,35));
  for(const [key,item] of entries){if(!item||typeof item!=='object')continue;parent.append(node('h4',LABELS[key]||key));renderData(parent,item,{depth:depth+1,budget});}return;
 }
 parent.append(node('p',stringValue(value)));
}
function reportSection(title){const section=node('section',undefined,'report-section');section.append(node('h3',title));$('reportContent').append(section);return section;}
function showReport(record){
 const row=order();if(!row||record.order_id!==row.id||record.owner_id!==ownerId)return;let result;try{result=validateReport(record,row);}catch{say('reportsStatus','تعذر عرض تقرير غير مكتمل أو لا يطابق هذا الطلب.',true);return;}
 clearReport();$('reportPanel').hidden=false;$('reportTitle').textContent='تقرير '+(typeof result.field.name==='string'?result.field.name:fieldName(row.field_id));$('reportQuality').textContent=REPORT_STATUSES[record.status]||'تقرير للمراجعة';$('reportQuality').className='badge '+record.status;$('reportMeta').textContent='أور الزراعية · رقم التقرير '+number(record.report_number,0)+' · أُعدّ: '+dateText(result.created_at)+' · موعد الفترة: '+dateText(result.due_at)+' · '+SERVICES[row.service_type];
 if(result.summary)reportSection('ملخص التقرير').append(node('p',result.summary));
 renderData(reportSection('بيانات الحقل'),result.field);
 const satellite=reportSection('المؤشرات والمشاهد الفضائية');if(result.satellite)renderData(satellite,result.satellite);else satellite.append(node('p','لم يتوفر مشهد فضائي صالح لهذا التقرير. لا تعني البيانات المفقودة انخفاض المؤشر.'));
 const weather=reportSection('الطقس والهطول');if(result.weather)renderData(weather,result.weather);else weather.append(node('p','لم تتوفر بيانات الطقس لهذا التقرير.'));
 if(result.comparison){const comparison=reportSection('مقارنة مع التقرير السابق');if(result.comparison.same_scene===true)comparison.append(node('p','المقارنة تستخدم المشهد نفسه؛ لا يدل فرق التقرير على وصول صورة فضائية جديدة.','notice'));renderData(comparison,result.comparison);}
 renderData(reportSection('سجل الري المتاح'),result.irrigation_logs||[]);
 for(const [title,values] of [['الإرشاد الزراعي الأولي',result.recommendations],['حدود البيانات والمراجعة',result.limitations],['ملاحظات التقرير',result.notes]])if(values.length)renderData(reportSection(title),values);
 renderData(reportSection('مصادر البيانات'),result.sources);
 $('reportContent').append(node('p','الإرشاد أولي من البيانات المتاحة، وليس تشغيل أجهزة أو تشخيصًا مخبريًا. البيانات الناقصة لا تُستبدل بقياسات مختلقة.','notice'));
 reportSnapshot={service:'تقرير أور للحقل',order_id:row.id,report_id:record.id,report_status:record.status,result};sync();
}
$('serviceType').onchange=serviceFields;$('orderField').onchange=sync;
$('orderForm').addEventListener('submit',event=>void createOrder(event));$('refreshFields').onclick=()=>void loadFields();$('refreshOrders').onclick=()=>void loadOrders();
$('acceptQuoteConsent').onchange=sync;$('runConsent').onchange=sync;$('acceptQuote').onclick=()=>void acceptQuote();$('runReport').onclick=()=>void runReport();
$('retryAccount').onclick=()=>{if(!client&&!checking){location.reload();return;}void openAccount();void availability();};
$('downloadReport').onclick=()=>{if(!reportSnapshot)return;const url=URL.createObjectURL(new Blob([JSON.stringify(reportSnapshot,null,2)],{type:'application/json;charset=utf-8'})),link=node('a');link.href=url;link.download='ur-field-report-'+new Date(reportSnapshot.result.created_at).toISOString().slice(0,10)+'.json';link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('printReport').onclick=()=>{if(reportSnapshot)window.print();};
window.addEventListener('pagehide',()=>{statusGeneration++;clearTimeout(authReloadTimer);resetPrivate('جارٍ استعادة جلسة حسابك…');});
window.addEventListener('pageshow',event=>{if(event.persisted){void openAccount();void availability();}});
setInterval(()=>{if(document.visibilityState!=='hidden')sync();},15000);
serviceFields();sync();void openAccount();void availability();
