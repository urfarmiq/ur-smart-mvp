import {withDeadline} from './request-deadline.mjs';
const $=id=>document.getElementById(id);
const PROJECT='https://ynsmhtsktbubxfhsekjq.supabase.co';
const KEY='sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc';
const COLUMNS='id,owner_id,company_name,contact_name,contact_phone,request_note,placement,duration_days,ad_title,ad_body,target_url,status,quote_iqd,quote_scope,quote_version,quoted_at,accepted_at,payment_reference,admin_note,approved_at,starts_at,ends_at,created_at,updated_at';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES={new:'بانتظار مراجعة الإدارة',quoted:'عرض جاهز للمراجعة',awaiting_payment:'بانتظار تأكيد الدفع',approved:'الدفع مؤكد — بانتظار النشر',active:'منشور',paused:'متوقف مؤقتًا',closed:'مغلق',rejected:'مرفوض',cancelled:'أُلغي الطلب'};
const PLACES={home:'الصفحة الرئيسية',services:'مركز الخدمات'};
const UNPAID=['new','quoted','awaiting_payment'];
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
const money=n=>Number.isSafeInteger(n)&&n>0?n.toLocaleString('ar-IQ')+' دينار عراقي':'لم يصدر عرض بعد';
const days=n=>Number.isInteger(n)?n.toLocaleString('ar-IQ')+' يومًا':'غير محددة';
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'}).format(new Date(v))+' — بغداد':'غير محدد';
const say=(id,text,bad=false)=>{const n=$(id);n.textContent=text;n.hidden=!text;n.classList.toggle('error',bad);};
let client=null,clientPromise=null,ownerId=null,lastOwner=null,generation=0,selection=0,selectedId=null,quoteKey='';
let orders=[],checking=false,loading=false,creating=false,accepting=false,cancelling=false,reloadPending=false,reloadTimer=null;
function safeUrl(value){
 if(typeof value!=='string'||value.length>1000||/[\s\u0000-\u001f\u007f]/.test(value))return null;
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||url.href.length>1000||url.hostname.length>253||! /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)||/(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname))return null;return url.href;}catch{return null;}
}
const selected=()=>orders.find(r=>r.id===selectedId&&r.owner_id===ownerId)||null;
const quoted=r=>!!r&&Number.isSafeInteger(r.quote_iqd)&&r.quote_iqd>0&&r.quote_iqd<=1000000000&&typeof r.quote_scope==='string'&&r.quote_scope.trim().length>0&&r.quote_scope.length<=2000&&Number.isInteger(r.quote_version)&&r.quote_version>0&&typeof r.ad_title==='string'&&r.ad_title.trim()&&r.ad_title.length<=120&&typeof r.ad_body==='string'&&r.ad_body.trim()&&r.ad_body.length<=800&&safeUrl(r.target_url);
const expired=r=>['active','paused'].includes(r?.status)&&Number.isFinite(Date.parse(r.ends_at))&&Date.parse(r.ends_at)<=Date.now();
const stateText=r=>expired(r)?'انتهت مدة الإعلان':STATES[r.status];
const cancellable=r=>!!r&&UNPAID.includes(r.status)&&!r.approved_at;
function sync(){
 const signed=!!ownerId,mutation=creating||accepting||cancelling,r=selected();
 $('orderFields').disabled=!signed||mutation||loading;$('createOrder').disabled=!signed||mutation||loading;
 $('refreshOrders').disabled=!signed||loading||mutation;$('retryAccount').disabled=checking||mutation;
 $('acceptQuote').disabled=!signed||mutation||r?.status!=='quoted'||!quoted(r)||!$('acceptConsent').checked;
 $('acceptConsent').disabled=mutation;$('paymentReference').disabled=mutation;
 $('cancelOrder').disabled=!signed||mutation||!cancellable(r);
 for(const b of $('ordersList').querySelectorAll('button'))b.disabled=mutation;
}
function clearSelected(){selection++;selectedId=null;quoteKey='';accepting=false;cancelling=false;$('selectedPanel').hidden=true;$('acceptConsent').checked=false;$('paymentReference').value='';$('selectedFacts').replaceChildren();$('creativeLink').removeAttribute('href');for(const id of ['selectedTitle','selectedMeta','selectedStatus','selectedNote','creativeCompany','creativeTitle','creativeBody','quoteAmount','quoteScope','quoteMeta','paymentStatus','publicationStatus','adminNote'])$(id).textContent='';say('quoteStatus','');say('cancelStatus','');}
function reset(message){generation++;ownerId=null;orders=[];loading=false;creating=false;clearSelected();$('orderForm').reset();$('ordersList').replaceChildren();$('privateContent').hidden=true;$('loginLink').hidden=false;$('accountLogin').hidden=false;$('accountStatus').textContent=message;for(const id of ['createStatus','ordersStatus'])say(id,'');sync();}
function scheduleReload(){clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>{if(checking){reloadPending=true;return;}void openAccount();},0);}
function authChanged(event,incoming){
 if(event==='INITIAL_SESSION'){lastOwner=incoming?.user?.id??null;return;}
 if(event==='SIGNED_OUT'){lastOwner=null;reloadPending=false;clearTimeout(reloadTimer);reset('سجّل الدخول بحساب أور لإنشاء طلب إعلان ومتابعة عروضك.');return;}
 if(!['SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event)||!UUID.test(incoming?.user?.id||''))return;
 if(lastOwner&&lastOwner!==incoming.user.id){reset('تغيّر الحساب؛ جارٍ تحميل طلبات الحساب الحالي.');lastOwner=incoming.user.id;scheduleReload();return;}
 lastOwner=incoming.user.id;if(ownerId!==incoming.user.id)scheduleReload();
}
async function connection(){if(client)return client;if(!clientPromise)clientPromise=withDeadline(import('./supabase-client.mjs')).then(({createClient})=>{client=createClient(PROJECT,KEY);client.auth.onAuthStateChange(authChanged);return client;}).catch(error=>{clientPromise=null;throw error;});return clientPromise;}
async function currentSession(token,account=ownerId){const result=await withDeadline(client.auth.getSession());if(token!==generation)return null;if(result.error)throw Error('تعذر التحقق من الجلسة. أعد الاتصال دون مسح بياناتك.');const value=result.data?.session;if(!value?.access_token||value.user?.id!==account){reset('انتهت الجلسة أو تغيّر الحساب. سجّل الدخول بالحساب الحالي ثم أعد المحاولة.');return null;}return value;}
async function openAccount(){
 if(checking){reloadPending=true;return;}checking=true;const token=++generation;loading=false;clearSelected();orders=[];ownerId=null;$('ordersList').replaceChildren();$('privateContent').hidden=true;$('accountStatus').textContent='جارٍ استعادة جلسة حسابك…';sync();
 try{const sdk=await connection();if(token!==generation)return;const result=await withDeadline(sdk.auth.getSession());if(token!==generation)return;if(result.error)throw Error();const value=result.data?.session;if(!value?.access_token||!UUID.test(value.user?.id||'')){reset('سجّل الدخول بحساب أور لإنشاء طلب إعلان ومتابعة عروضك. تصفّح الخيارات متاح للجميع.');return;}if(lastOwner&&lastOwner!==value.user.id)$('orderForm').reset();ownerId=value.user.id;lastOwner=ownerId;$('privateContent').hidden=false;$('loginLink').hidden=true;$('accountLogin').hidden=true;$('accountStatus').textContent='تم الاتصال بحسابك. تظهر طلبات إعلانك وعروض الإدارة الخاصة بك فقط.';await loadOrders();}
 catch{if(token===generation){$('accountStatus').textContent='تعذر الاتصال بحسابك الآن. أعد المحاولة؛ لم نمسح جلسة الدخول أو طلباتك.';$('loginLink').hidden=false;$('accountLogin').hidden=false;}}
 finally{checking=false;sync();if(reloadPending){reloadPending=false;scheduleReload();}}
}
function validOrders(value){return(Array.isArray(value)?value:[]).filter(r=>r&&UUID.test(r.id||'')&&r.owner_id===ownerId&&Object.hasOwn(STATES,r.status)&&Object.hasOwn(PLACES,r.placement)&&Number.isInteger(r.duration_days)&&r.duration_days>=1&&r.duration_days<=365&&typeof r.company_name==='string'&&r.company_name.length<=120);}
async function loadOrders(){
 if(!ownerId||loading)return;const token=generation,account=ownerId;loading=true;sync();say('ordersStatus','جارٍ تحديث طلباتك…');
 try{const result=await withDeadline(client.from('advertising_orders').select(COLUMNS).eq('owner_id',account).order('created_at',{ascending:false}).limit(50));if(token!==generation||ownerId!==account)return;if(result.error)throw result.error;if(!await currentSession(token,account))return;orders=validOrders(result.data);if(selectedId&&!selected())clearSelected();renderOrders();renderSelected();say('ordersStatus',orders.length?'أحدث خمسين طلبًا · آخر تحديث: '+date(new Date().toISOString()):'لا توجد طلبات إعلان بعد. أرسل طلبك الأول لتراجعه الإدارة.');}
 catch{if(token===generation)say('ordersStatus','تعذر تحديث الطلبات. أعد المحاولة؛ الطلبات المحفوظة لم تتغير.',true);}
 finally{if(token===generation){loading=false;sync();}}
}
function renderOrders(){const box=$('ordersList');box.replaceChildren();for(const r of orders){const card=node('article',undefined,'inquiry-card'+(r.id===selectedId?' selected':'')),head=node('div',undefined,'inquiry-top');head.append(node('h3',r.company_name),node('span',stateText(r),'badge '+r.status));card.append(head,node('p',r.ad_title||'طلب إعلان زراعي'),node('p',PLACES[r.placement]+' · '+days(r.duration_days)),node('p','رقم الطلب: '+r.id),node('p','أُنشئ: '+date(r.created_at)));if(quoted(r))card.append(node('p','إجمالي العرض: '+money(r.quote_iqd)));const b=node('button','راجع تفاصيل الطلب','button secondary');b.type='button';b.dataset.orderId=r.id;b.onclick=()=>choose(r.id);card.append(b);box.append(card);}sync();}
function choose(id){if(!orders.some(r=>r.id===id&&r.owner_id===ownerId))return;selection++;selectedId=id;quoteKey='';accepting=false;cancelling=false;$('acceptConsent').checked=false;$('paymentReference').value='';say('quoteStatus','');say('cancelStatus','');renderOrders();renderSelected();}
function fact(label,value){const box=node('div');box.append(node('dt',label),node('dd',value));$('selectedFacts').append(box);}
function renderSelected(){
 const r=selected();if(!r){$('selectedPanel').hidden=true;return;}$('selectedPanel').hidden=false;$('selectedTitle').textContent=r.company_name;$('selectedStatus').textContent=stateText(r);$('selectedStatus').className='badge '+r.status;$('selectedMeta').textContent='رقم الطلب: '+r.id+' · '+date(r.created_at);$('selectedNote').textContent=r.request_note||'';$('selectedNote').hidden=!r.request_note;
 const key=[r.id,r.quote_version,r.quote_iqd,r.quote_scope,r.duration_days,r.ad_title,r.ad_body,r.target_url,r.placement,r.status].join('|');if(key!==quoteKey){quoteKey=key;$('acceptConsent').checked=false;$('paymentReference').value=r.payment_reference||'';say('quoteStatus','');}
 $('selectedFacts').replaceChildren();fact('موضع الإعلان',PLACES[r.placement]);fact(r.quote_version?'المدة المعروضة':'المدة المقترحة',days(r.duration_days));fact('اسم التواصل',r.contact_name||'غير مضاف');fact('هاتف التواصل',r.contact_phone||'غير مضاف');
 $('creativeCompany').textContent=r.company_name;$('creativeTitle').textContent=r.ad_title||'';$('creativeBody').textContent=r.ad_body||'';const url=safeUrl(r.target_url);$('creativeLink').hidden=!url;if(url){$('creativeLink').href=url;$('creativeLink').textContent=url;}else $('creativeLink').removeAttribute('href');
 $('quoteDetails').hidden=!quoted(r);$('quoteAmount').textContent=quoted(r)?'إجمالي عرض السعر: '+money(r.quote_iqd):'';$('quoteScope').textContent=r.quote_scope||'';$('quoteMeta').textContent='نسخة العرض: '+Number(r.quote_version||0).toLocaleString('ar-IQ')+' · '+PLACES[r.placement]+' · '+days(r.duration_days)+(r.quoted_at?' · '+date(r.quoted_at):'');$('quoteAcceptance').hidden=r.status!=='quoted'||!quoted(r);
 const messages={new:'تراجع الإدارة نشاطك والنص والموضع المطلوب قبل إعداد العرض. لم يُسجّل دفع أو نشر.',quoted:'راجع السعر والمدة والموضع والنص والرابط والنطاق، ثم وافق على هذه النسخة قبل تنسيق الدفع.',awaiting_payment:'حُفظ قبول العرض. تنتظر الإدارة تأكيد استلام الدفع؛ المرجع وحده لا يثبت الدفع ولا ينشر الإعلان.',approved:'أكدت الإدارة استلام الدفع. الإعلان لم يُنشر بعد؛ تبدأ المدة عند النشر اليدوي.',active:expired(r)?'انتهت مدة الإعلان؛ لا يوجد تجديد أو خصم تلقائي.':'نُشر الإعلان بعد تأكيد الدفع. تُحدد الإتاحة الفعلية بحسب مواعيده في الخادم.',paused:expired(r)?'انتهت المدة الأصلية للإعلان المتوقف؛ الإيقاف لا يمددها.':'أوقفت الإدارة الإعلان مؤقتًا. يبقى موعد الانتهاء الأصلي دون تمديد تلقائي.',closed:'أُغلق هذا الطلب. ناقش أي إعلان جديد مع الإدارة.',rejected:'رفضت الإدارة الطلب. راجع الملاحظة قبل اقتراح إعلان جديد.',cancelled:'ألغيت هذا الطلب غير المدفوع؛ لم يبدأ نشره.'};$('paymentStatus').textContent=messages[r.status];
 $('publicationStatus').textContent=r.starts_at?'بداية النشر: '+date(r.starts_at)+' · نهاية المدة: '+date(r.ends_at)+' · الوقت المعروض بتوقيت بغداد.':'لا توجد مدة نشر جارية لهذا الطلب. تأكيد الدفع يسبق نشر الإدارة للإعلان.';$('adminNote').textContent=r.admin_note?'ملاحظة الإدارة: '+r.admin_note:'';$('adminNote').hidden=!r.admin_note;$('cancelOrder').hidden=!cancellable(r);sync();
}
function issue(error,fallback){return error?.code==='55000'?'تغيّرت حالة الطلب أو نسخة العرض. حدّث الطلب وراجع النص والسعر والمدة مجددًا.':error?.code==='54000'?'بلغت الحد اليومي للطلبات. راجع طلباتك الحالية أو أعد المحاولة لاحقًا.':error?.code==='42501'?'الطلب غير متاح لهذا الحساب. راجع جلسة الدخول ثم حدّث القائمة.':error?.code==='22023'?'تحقق من النص والرابط والمدة وحدود الحقول ثم أعد المحاولة.':fallback;}
async function createOrder(event){
 event.preventDefault();if(creating||accepting||cancelling||loading||!ownerId)return;const form=$('orderForm'),company=$('companyName').value.trim(),placement=$('placement').value,duration=Number($('durationDays').value),title=$('adTitle').value.trim(),body=$('adBody').value.trim(),rawUrl=$('targetUrl').value.trim(),url=safeUrl(rawUrl),contact=$('contactName').value.trim(),phone=$('contactPhone').value.trim(),notes=$('requestNote').value.trim();
 $('targetUrl').setCustomValidity(url?'':'أدخل رابط HTTPS عامًا دون معلومات دخول أو عنوان محلي.');if(!form.reportValidity())return;if(!company||company.length>120||!Object.hasOwn(PLACES,placement)||!Number.isInteger(duration)||duration<1||duration>365||!title||title.length>120||!body||body.length>800||!url||contact.length>100||phone.length>32||notes.length>1500){say('createStatus','تحقق من النص والرابط والمدة والحقول قبل الإرسال.',true);return;}
 const token=generation,account=ownerId;creating=true;sync();say('createStatus','جارٍ إرسال طلبك إلى الإدارة…');
 try{if(!await currentSession(token,account))return;const result=await withDeadline(client.rpc('create_advertising_order',{p_company_name:company,p_placement:placement,p_duration_days:duration,p_ad_title:title,p_ad_body:body,p_target_url:url,p_contact_name:contact||null,p_contact_phone:phone||null,p_request_note:notes||null}));if(token!==generation||ownerId!==account)return;if(!await currentSession(token,account))return;if(result.error)throw result.error;const row=Array.isArray(result.data)?result.data[0]:result.data;if(!UUID.test(row?.id||'')||row.status!=='new')throw Error();form.reset();await loadOrders();if(token!==generation)return;choose(row.id);say('createStatus','أُرسل طلبك للمراجعة. لم يُسجّل دفع ولم يبدأ نشر إعلان.');}
 catch(error){if(token===generation)say('createStatus',issue(error,'تعذر إنشاء الطلب. حدّث القائمة قبل إعادة الإرسال لتجنب تكرار طلب محفوظ.'),true);}
 finally{if(token===generation){creating=false;sync();}}
}
async function acceptQuote(){
 const r=selected();if(creating||accepting||cancelling||r?.status!=='quoted'||!quoted(r)||!$('acceptConsent').checked)return;const token=generation,chosen=selection,account=ownerId,version=r.quote_version,reference=$('paymentReference').value.trim();if(reference.length>120)return;accepting=true;sync();say('quoteStatus','جارٍ حفظ موافقتك على العرض…');
 try{if(!await currentSession(token,account))return;const response=await withDeadline(client.rpc('accept_advertising_quote',{p_order_id:r.id,p_quote_version:version,p_payment_reference:reference||null}));if(token!==generation||chosen!==selection||ownerId!==account)return;if(!await currentSession(token,account))return;if(response.error)throw response.error;const value=Array.isArray(response.data)?response.data[0]:response.data;if(value?.id!==r.id||value.status!=='awaiting_payment'||value.quote_version!==version)throw Error();await loadOrders();if(token===generation&&chosen===selection)say('quoteStatus','حُفظ قبول العرض. يتبقى تأكيد الإدارة للدفع ثم النشر اليدوي.');}
 catch(error){if(token===generation&&chosen===selection){$('acceptConsent').checked=false;if(error?.code==='55000')await loadOrders();if(token===generation&&chosen===selection)say('quoteStatus',issue(error,'تعذر حفظ القبول. حدّث الطلب وراجع العرض قبل إعادة المحاولة.'),true);}}
 finally{if(token===generation&&chosen===selection){accepting=false;sync();}}
}
async function cancelOrder(){
 const r=selected();if(creating||accepting||cancelling||!cancellable(r))return;const token=generation,chosen=selection,account=ownerId;cancelling=true;sync();say('cancelStatus','جارٍ إلغاء الطلب غير المدفوع…');
 try{if(!await currentSession(token,account))return;const response=await withDeadline(client.rpc('cancel_advertising_order',{p_order_id:r.id}));if(token!==generation||chosen!==selection||ownerId!==account)return;if(!await currentSession(token,account))return;if(response.error)throw response.error;const value=Array.isArray(response.data)?response.data[0]:response.data;if(value?.id!==r.id||value.status!=='cancelled')throw Error();await loadOrders();if(token===generation&&chosen===selection)say('cancelStatus','أُلغي الطلب غير المدفوع.');}
 catch(error){if(token===generation&&chosen===selection)say('cancelStatus',issue(error,'تعذر الإلغاء. حدّث الطلب للتحقق من حالته قبل إعادة المحاولة.'),true);}
 finally{if(token===generation&&chosen===selection){cancelling=false;sync();}}
}
$('orderForm').addEventListener('submit',createOrder);$('retryAccount').onclick=()=>void openAccount();$('refreshOrders').onclick=()=>void loadOrders();$('acceptConsent').onchange=sync;$('acceptQuote').onclick=()=>void acceptQuote();$('cancelOrder').onclick=()=>void cancelOrder();$('targetUrl').addEventListener('input',()=>$('targetUrl').setCustomValidity(''));
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&ownerId){renderOrders();renderSelected();void loadOrders();}});
setInterval(()=>{if(!document.hidden&&ownerId){renderOrders();renderSelected();}},60000);
window.addEventListener('pagehide',()=>{clearTimeout(reloadTimer);reset('جارٍ استعادة جلسة حسابك…');});
window.addEventListener('pageshow',event=>{if(event.persisted)void openAccount();});
sync();void openAccount();
