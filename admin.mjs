const $=id=>document.getElementById(id);
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const PUBLIC_FIELDS='id,user_id,email,display_name,registered_at,email_confirmed_at,seen_at';
const RESEARCH_FIELDS='id,owner_id,topic,task_type,fee_iqd,status,payment_reference,admin_note,approved_at,created_at,updated_at,attempt_count,started_at,result_status';
const RESEARCH_STATUSES=Object.freeze({waiting_payment:'بانتظار مراجعة الدفع',approved:'مسموح بالتنفيذ',running:'قيد التنفيذ',completed:'مكتمل',needs_review:'يحتاج مراجعة',failed:'تعذّر التنفيذ',rejected:'مرفوض'});
const RESEARCH_TYPES=Object.freeze({combined:'طلب متكامل',data:'تحليل بيانات',maps:'خرائط وتحليل مكاني',study:'دراسة بحثية'});
let client=null,userId=null,allowed=false,mfaReady=false,generation=0,busy=false,loading=false,pendingFactor=null,rows=[],authSubscription=null,pageOffset=0,hasMore=false,olderOpen=false,visitsLoading=false;
let researchRows=[],researchLoading=false,researchReviewBusy=false,researchPageOffset=0,researchHasMore=false,researchOlderOpen=false,researchFilter='waiting_payment';
const researchDrafts=new Map();

function status(message,error=false){$('adminStatus').textContent=message;$('adminStatus').className='status'+(error?' error':'');}
function dateText(value){const d=new Date(value);return value&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'}).format(d)+' — بغداد':'غير متاح';}
function cleanText(value,fallback){return typeof value==='string'&&value.trim()?value.trim().slice(0,350):fallback;}
function clearVisits(){for(const id of ['visitsToday','visitsWeek','visitsMonth','visitsTotal'])$(id).textContent='—';$('visitPages').replaceChildren();$('visitDays').replaceChildren();$('visitDetails').hidden=true;$('visitsSince').textContent='';$('visitsStatus').textContent='لم تُحمّل الإحصاءات بعد.';$('visitsStatus').className='muted';}
function researchStatus(message,error=false){$('researchOrdersStatus').textContent=message;$('researchOrdersStatus').className='muted'+(error?' error':'');}
function clearResearchOrders(){researchRows=[];researchPageOffset=0;researchHasMore=false;researchOlderOpen=false;researchFilter='waiting_payment';researchDrafts.clear();$('researchOrderList').replaceChildren();$('researchPendingCount').textContent='—';$('researchOrderFilter').value=researchFilter;$('researchOrderPaginationStatus').textContent='';$('loadOlderResearchOrders').hidden=true;researchStatus('لم تُحمّل الطلبات بعد.');}
function clearSetup(){pendingFactor=null;$('mfaSecret').value='';$('mfaQr').removeAttribute('src');$('mfaSetup').hidden=true;$('mfaCode').value='';}
function lock(message){
 generation++;allowed=false;mfaReady=false;userId=null;rows=[];pageOffset=0;hasMore=false;olderOpen=false;clearSetup();clearVisits();clearResearchOrders();
 $('adminContent').hidden=true;$('mfaPanel').hidden=true;$('adminGate').hidden=false;
 $('notificationList').replaceChildren();$('unreadCount').textContent='—';$('markAllSeen').disabled=true;
 $('paginationStatus').textContent='';$('loadOlderNotifications').hidden=true;
 $('gateMessage').textContent=message;status(message,true);
}
function sync(){for(const id of ['enrollMfa','verifyMfaButton','mfaFactor'])$(id).disabled=busy;$('refreshNotifications').disabled=loading||busy;$('refreshVisits').disabled=visitsLoading||busy;$('markAllSeen').disabled=loading||busy||!rows.some(row=>!row.seen_at);$('loadOlderNotifications').disabled=loading||busy||!hasMore;for(const id of ['refreshResearchOrders','researchOrderFilter'])$(id).disabled=researchLoading||researchReviewBusy||busy;$('loadOlderResearchOrders').disabled=researchLoading||researchReviewBusy||busy||!researchHasMore;for(const control of $('researchOrderList').querySelectorAll('input,textarea,button'))control.disabled=researchLoading||researchReviewBusy||busy;}
async function currentAccess({mfa=false}={}){
 const token=generation;
 const auth=await client.auth.getUser();if(token!==generation)return null;
 if(auth.error||!auth.data?.user){lock('سجّل الدخول بحساب المدير للوصول إلى هذه الصفحة.');return null;}
 if(userId&&userId!==auth.data.user.id){lock('تغيّر حساب الدخول. أعد فتح لوحة الإدارة من حسابك المصرّح.');return null;}
 const role=await client.rpc('admin_access');if(token!==generation)return null;
 if(role.error||role.data!==true){lock('لا يملك هذا الحساب صلاحية الدخول إلى لوحة الإدارة.');return null;}
 userId=auth.data.user.id;allowed=true;$('logoutAdmin').hidden=false;
 const assurance=await client.auth.mfa.getAuthenticatorAssuranceLevel();if(token!==generation)return null;
 if(assurance.error)throw Error('تعذر التحقق من حماية الجلسة. أعد تسجيل الدخول.');
 mfaReady=assurance.data?.currentLevel==='aal2';
 if(mfa&&!mfaReady){generation++;clearVisits();clearResearchOrders();$('adminContent').hidden=true;$('notificationList').replaceChildren();rows=[];$('unreadCount').textContent='—';$('mfaPanel').hidden=false;status('يلزم التحقق من تطبيق المصادقة قبل قراءة الإشعارات والطلبات.');return null;}
 return {token,ready:mfaReady};
}
function saveResearchDrafts(){for(const form of $('researchOrderList').querySelectorAll('form'))researchDrafts.set(form.dataset.orderId,{note:form.elements.admin_note.value,verified:form.elements.payment_verified.checked});}
function editingResearchOrder(){return $('researchOrderList').contains(document.activeElement)&&document.activeElement.matches('textarea,input')||[...$('researchOrderList').querySelectorAll('form')].some(form=>form.elements.admin_note.value.trim()||form.elements.payment_verified.checked);}
function renderResearchOrders(){
 saveResearchDrafts();const list=$('researchOrderList');list.replaceChildren();
 $('loadOlderResearchOrders').hidden=!researchHasMore;$('researchOrderPaginationStatus').textContent=researchRows.length?'تعرض القائمة '+researchRows.length.toLocaleString('ar-IQ')+' طلبًا.'+(researchOlderOpen?' اضغط «تحديث الطلبات» للعودة إلى الأحدث.':''):'';
 if(!researchRows.length)list.append(el('p','لا توجد طلبات بهذه الحالة.','empty'));
 for(const row of researchRows){
  const card=el('article',undefined,'research-order');card.dataset.orderId=row.id;
  const top=el('div',undefined,'notification-top');top.append(el('h3',row.topic),el('span',RESEARCH_STATUSES[row.status],'badge'+(row.status==='waiting_payment'?' unread':'')));
  const details=el('dl');for(const [label,value] of [['نوع الخدمة',RESEARCH_TYPES[row.task_type]],['أجرة الخدمة',row.fee_iqd.toLocaleString('ar-IQ')+' دينار عراقي'],['مرجع الدفع',cleanText(row.payment_reference,'لم يُدخل مرجعًا')],['تاريخ الطلب',dateText(row.created_at)],['تأكيد الدفع',row.approved_at?dateText(row.approved_at):'لم يُؤكّد بعد']]){const line=el('div');line.append(el('dt',label),el('dd',value));details.append(line);}card.append(top,details);
  if(row.admin_note){const note=el('p','ملاحظة الإدارة: '+row.admin_note,'muted research-admin-note');card.append(note);}
  if(row.status==='waiting_payment'){
   const form=el('form',undefined,'research-review');form.dataset.orderId=row.id;
   const noteId='research-note-'+row.id,checkId='research-check-'+row.id,label=el('label','ملاحظة الإدارة (اختياري)');label.htmlFor=noteId;
   const note=el('textarea');note.id=noteId;note.name='admin_note';note.maxLength=1000;note.rows=3;
   const check=el('input');check.type='checkbox';check.id=checkId;check.name='payment_verified';check.required=true;
   const checkLabel=el('label',undefined,'payment-check');checkLabel.htmlFor=checkId;checkLabel.append(check,el('span','تحققت من استلام ٢٥٬٠٠٠ دينار ومن نطاق الطلب'));
   const draft=researchDrafts.get(row.id);if(draft){note.value=draft.note;check.checked=draft.verified;}
   const actions=el('div',undefined,'actions'),approve=el('button','تأكيد الدفع والسماح بالتنفيذ'),reject=el('button','رفض الطلب','reject-order');approve.type='submit';reject.type='button';actions.append(approve,reject);
   form.append(label,note,checkLabel,actions);form.addEventListener('submit',event=>{event.preventDefault();if(form.reportValidity())void reviewResearchOrder(row.id,'approve',form);});reject.addEventListener('click',()=>void reviewResearchOrder(row.id,'reject',form));card.append(form);
  }
  list.append(card);
 }
 sync();
}
async function loadResearchOrders({quiet=false,append=false,force=false}={}){
 if(!client||researchLoading||researchReviewBusy&&!force||busy||!allowed||!mfaReady||append&&!researchHasMore||quiet&&researchOlderOpen)return false;
 if(!force&&editingResearchOrder()){if(!quiet)researchStatus('أكمل المراجعة الحالية أو امسح الملاحظة وعلامة التحقق قبل تحديث الطلبات.');return false;}
 const token=generation,filter=researchFilter;researchLoading=true;sync();if(!quiet)researchStatus('جارٍ تحميل طلبات الباحثين…');
 try{
  const access=await currentAccess({mfa:true});if(!access||token!==generation)return false;
  let query=client.from('research_orders').select(RESEARCH_FIELDS).order('created_at',{ascending:false}).order('id',{ascending:false});if(filter!=='all')query=query.eq('status',filter);
  const [orders,count]=await Promise.all([query.range(append?researchPageOffset:0,(append?researchPageOffset:0)+49),client.from('research_orders').select('id',{count:'exact',head:true}).eq('status','waiting_payment')]);if(token!==generation)return false;
  if(orders.error||count.error||!Array.isArray(orders.data)||!Number.isSafeInteger(count.count)||count.count<0)throw Error();
  const batch=orders.data;if(batch.some(row=>!row||typeof row.id!=='string'||typeof row.topic!=='string'||!Object.hasOwn(RESEARCH_STATUSES,row.status)||!Object.hasOwn(RESEARCH_TYPES,row.task_type)||row.fee_iqd!==25000))throw Error();
  const confirmed=await currentAccess({mfa:true});if(!confirmed||token!==generation)return false;
  researchRows=append?[...new Map([...researchRows,...batch].map(row=>[row.id,row])).values()]:batch;researchRows.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||b.id.localeCompare(a.id));
  researchPageOffset=(append?researchPageOffset:0)+batch.length;researchHasMore=batch.length===50;researchOlderOpen=append;$('researchPendingCount').textContent=count.count.toLocaleString('ar-IQ');renderResearchOrders();researchStatus('آخر تحديث: '+dateText(new Date().toISOString()));return true;
 }catch{if(token===generation){researchStatus('تعذر تحميل طلبات الباحثين. تحقق من الاتصال وصلاحية الجلسة ثم أعد المحاولة.',true);}return false;}
 finally{researchLoading=false;sync();}
}
async function reviewResearchOrder(id,decision,form){
 if(!allowed||!mfaReady||busy||researchLoading||researchReviewBusy||!form.isConnected||!researchRows.some(row=>row.id===id&&row.status==='waiting_payment')||decision==='approve'&&!form.reportValidity())return;
 const note=form.elements.admin_note.value.trim();if(note.length>1000)return;
 const token=generation;researchReviewBusy=true;sync();researchStatus('جارٍ حفظ قرار المراجعة…');
 try{
  const access=await currentAccess({mfa:true});if(!access||token!==generation)return;
  const result=await client.rpc('review_research_order',{p_order_id:id,p_decision:decision,p_note:note||null});if(token!==generation)return;
  if(result.error||result.data?.id!==id||result.data?.status!==(decision==='approve'?'approved':'rejected')||result.data?.fee_iqd!==25000)throw Error();
  const confirmed=await currentAccess({mfa:true});if(!confirmed||token!==generation)return;
  form.elements.admin_note.value='';form.elements.payment_verified.checked=false;researchDrafts.delete(id);
  if(await loadResearchOrders({force:true})){if(token===generation)researchStatus(decision==='approve'?'تم تأكيد الدفع والسماح بالتنفيذ. بعد التأكيد يستطيع الباحث بدء التنفيذ الآلي من صفحة الخدمة.':'تم رفض الطلب.');}
 }catch{if(token===generation)researchStatus('تعذر تأكيد قرار المراجعة. حدّث الطلبات للتحقق من الحالة ثم أعد المحاولة عند الحاجة.',true);}
 finally{researchReviewBusy=false;sync();}
}
const PAGE_LABELS=Object.freeze({home:'الرئيسية',dashboard:'لوحة المزارع','field-map':'خرائط الحقول','field-analysis':'تحليل الحقل','satellite-analysis':'التحليل الفضائي',operations:'العمليات الزراعية',weather:'الطقس'});
function checkedVisits(value){
 const count=v=>Number.isSafeInteger(v)&&v>=0;
 const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
 if(!value||typeof value!=='object'||typeof value.started_at!=='string'||!Number.isFinite(Date.parse(value.started_at)))throw Error();
 if(!['today_views','week_views','month_views','total_views'].every(key=>count(value[key])))throw Error();
 if(!Array.isArray(value.daily)||value.daily.length!==30||!Array.isArray(value.pages)||value.pages.length>7)throw Error();
 const days=new Set(),pages=new Set();let previous=null;
 for(const row of value.daily){if(!row||!date(row.day)||!count(row.views)||days.has(row.day)||previous&&Date.parse(row.day)-Date.parse(previous)!==86400000)throw Error();days.add(row.day);previous=row.day;}
 for(const row of value.pages){if(!row||typeof row.page!=='string'||!Object.hasOwn(PAGE_LABELS,row.page)||!count(row.views)||pages.has(row.page))throw Error();pages.add(row.page);}
 const sum=rows=>rows.reduce((total,row)=>total+row.views,0);
 if(sum(value.daily)!==value.month_views||sum(value.daily.slice(-7))!==value.week_views||value.daily.at(-1).views!==value.today_views||sum(value.pages)!==value.total_views||value.total_views<value.month_views)throw Error();
 return value;
}
function renderVisits(value){
 for(const [id,key] of [['visitsToday','today_views'],['visitsWeek','week_views'],['visitsMonth','month_views'],['visitsTotal','total_views']])$(id).textContent=value[key].toLocaleString('ar-IQ');
 $('visitsSince').textContent='بداية الإحصاء: '+dateText(value.started_at);
 const pages=$('visitPages'),days=$('visitDays');pages.replaceChildren();days.replaceChildren();
 for(const row of [...value.pages].sort((a,b)=>b.views-a.views||a.page.localeCompare(b.page))){const tr=el('tr');tr.append(el('td',PAGE_LABELS[row.page]),el('td',row.views.toLocaleString('ar-IQ')));pages.append(tr);}
 if(!value.pages.length){const tr=el('tr'),td=el('td','لا توجد مشاهدات مسجّلة بعد.');td.colSpan=2;tr.append(td);pages.append(tr);}
 for(const row of [...value.daily].reverse()){const tr=el('tr');const day=new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeZone:'Asia/Baghdad'}).format(new Date(row.day+'T12:00:00Z'));tr.append(el('td',day),el('td',row.views.toLocaleString('ar-IQ')));days.append(tr);}
 $('visitDetails').hidden=false;$('visitsStatus').className='muted';$('visitsStatus').textContent='آخر تحديث: '+dateText(new Date().toISOString());
}
async function loadVisits(){
 if(!client||visitsLoading||busy||!allowed||!mfaReady)return;
 const token=generation;visitsLoading=true;sync();$('visitsStatus').className='muted';$('visitsStatus').textContent='جارٍ تحميل إحصاءات المشاهدات…';
 try{
  const access=await currentAccess({mfa:true});if(!access||token!==generation)return;
  const response=await client.rpc('admin_site_visits');if(token!==generation)return;
  if(response.error)throw Error();const value=checkedVisits(response.data);
  const confirmed=await currentAccess({mfa:true});if(!confirmed||token!==generation)return;
  renderVisits(value);
 }catch{if(token===generation){clearVisits();$('visitsStatus').className='muted error';$('visitsStatus').textContent='تعذر تحميل إحصاءات المشاهدات. تحقق من الاتصال ثم اضغط تحديث الإحصاءات.';}}
 finally{visitsLoading=false;sync();}
}
function render(){
 const list=$('notificationList');list.replaceChildren();
 $('loadOlderNotifications').hidden=!hasMore;
 $('paginationStatus').textContent=rows.length?'تعرض القائمة '+rows.length.toLocaleString('ar-IQ')+' تسجيلًا.'+(olderOpen?' أنت تستعرض تسجيلات أقدم؛ اضغط «تحديث الإشعارات» للعودة إلى الأحدث.':''):'';
 if(!rows.length){list.append(el('p','لا توجد إشعارات تسجيل متاحة بعد. تظهر التسجيلات الجديدة هنا عند إنشائها.','empty'));sync();return;}
 for(const row of rows){
  const card=el('article',undefined,'notification'+(row.seen_at?' seen':''));card.dataset.notificationId=row.id;
  const top=el('div',undefined,'notification-top');top.append(el('h3',cleanText(row.display_name,'حساب جديد — لم يُدخل اسمًا')),el('span',row.seen_at?'مقروء':'جديد','badge'+(row.seen_at?'':' unread')));
  const details=el('dl');for(const [label,value] of [['البريد الإلكتروني',cleanText(row.email,'غير مدخل')],['تاريخ التسجيل',dateText(row.registered_at)],['تأكيد البريد',row.email_confirmed_at?'تم التأكيد':'بانتظار التأكيد'],['وقت قراءة الإشعار',row.seen_at?dateText(row.seen_at):'لم يُقرأ بعد']]){const line=el('div');line.append(el('dt',label),el('dd',value));details.append(line);}
  card.append(top,details);
  if(!row.seen_at){const seen=el('button','تعليم كمقروء','secondary');seen.type='button';seen.onclick=()=>void markSeen([row.id]);card.append(seen);}
  list.append(card);
 }
 sync();
}
async function loadNotifications({quiet=false,append=false}={}){
 if(!client||loading||busy||!allowed||!mfaReady||append&&!hasMore||quiet&&olderOpen)return;
 const token=generation;loading=true;sync();if(!quiet)status('جارٍ تحميل إشعارات التسجيل…');
 try{
  const access=await currentAccess({mfa:true});if(!access||token!==generation)return;
  const [notifications,count]=await Promise.all([
   client.from('signup_notifications').select(PUBLIC_FIELDS).order('registered_at',{ascending:false}).order('id',{ascending:false}).range(append?pageOffset:0,(append?pageOffset:0)+49),
   client.from('signup_notifications').select('id',{count:'exact',head:true}).is('seen_at',null)
  ]);
  if(token!==generation)return;
  if(notifications.error||count.error)throw Error('تعذر تحميل الإشعارات. تحقق من الاتصال وصلاحية الجلسة.');
  const batch=Array.isArray(notifications.data)?notifications.data.filter(row=>row&&typeof row.id==='string'):[];
  rows=append?[...new Map([...rows,...batch].map(row=>[row.id,row])).values()]:batch;
  rows.sort((a,b)=>String(b.registered_at).localeCompare(String(a.registered_at))||String(b.id).localeCompare(String(a.id)));
  pageOffset=(append?pageOffset:0)+batch.length;hasMore=batch.length===50;olderOpen=append;
  $('unreadCount').textContent=Number.isInteger(count.count)&&count.count>=0?count.count.toLocaleString('ar-IQ'):'—';
  $('adminGate').hidden=true;$('mfaPanel').hidden=true;$('adminContent').hidden=false;render();
  status('لوحة الإدارة محمية بالتحقق الثنائي. آخر تحديث: '+dateText(new Date().toISOString()));
 }catch(error){if(token===generation){rows=[];pageOffset=0;hasMore=false;olderOpen=false;$('notificationList').replaceChildren();$('unreadCount').textContent='—';$('paginationStatus').textContent='';$('loadOlderNotifications').hidden=true;status(error.message||'تعذر قراءة الإشعارات الآن.',true);}}
 finally{loading=false;sync();}
}
async function markSeen(ids){
 if(busy||loading||!ids.length||!allowed||!mfaReady)return;
 const token=generation;busy=true;sync();
 try{
  const access=await currentAccess({mfa:true});if(!access||token!==generation)return;
  const seenAt=new Date().toISOString(),updated=new Set();
  for(let offset=0;offset<ids.length;offset+=50){
   const batch=ids.slice(offset,offset+50);let query=client.from('signup_notifications').update({seen_at:seenAt});
   query=batch.length===1?query.eq('id',batch[0]):query.in('id',batch).is('seen_at',null);
   const result=await query.select('id');if(token!==generation)return;
   if(result.error)throw Error('تعذر تحديث حالة قراءة الإشعار. أعد المحاولة.');
   for(const row of Array.isArray(result.data)?result.data:[])if(typeof row.id==='string')updated.add(row.id);
  }
  if(ids.length===1&&!updated.size)throw Error('لم تتغير حالة الإشعار. حدّث الصفحة للتحقق.');
  const count=await client.from('signup_notifications').select('id',{count:'exact',head:true}).is('seen_at',null);if(token!==generation)return;
  if(count.error)throw Error('تم إرسال التحديث، وتعذر تحديث العدد. حدّث الإشعارات للتحقق.');
  const confirmed=await currentAccess({mfa:true});if(!confirmed||token!==generation)return;
  rows=rows.map(row=>updated.has(row.id)?{...row,seen_at:seenAt}:row);
  $('unreadCount').textContent=Number.isInteger(count.count)&&count.count>=0?count.count.toLocaleString('ar-IQ'):'—';render();status('تم تحديث حالة قراءة الإشعارات المعروضة.');
 }catch(error){if(token===generation)status(error.message||'تعذر تحديث الإشعار.',true);return;}
 finally{busy=false;sync();}
}
async function showMfa(){
 const token=generation;clearVisits();clearResearchOrders();$('adminGate').hidden=true;$('mfaPanel').hidden=false;$('adminContent').hidden=true;
 const result=await client.auth.mfa.listFactors();if(token!==generation)return;
 if(result.error)throw Error('تعذر تحميل وسائل التحقق. راجع إعداد المصادقة في الحساب وأعد المحاولة.');
 const factors=(Array.isArray(result.data?.totp)?result.data.totp:[]).filter(factor=>factor.status==='verified');
 $('mfaFactor').replaceChildren();for(const factor of factors)$('mfaFactor').add(new Option(cleanText(factor.friendly_name,'تطبيق مصادقة'),factor.id));
 $('factorPicker').hidden=factors.length<2;$('verifyMfa').hidden=!factors.length;$('enrollMfa').hidden=!!factors.length;
 $('mfaDescription').textContent=factors.length?'أدخل الرمز الحالي من تطبيق المصادقة المرتبط بحسابك.':'لحماية معلومات التسجيل، أضف تطبيق مصادقة إلى حساب المدير مرة واحدة ثم تحقق برمزه.';
 $('mfaStatus').textContent='لن تُحمّل بيانات التسجيل قبل نجاح التحقق الثنائي.';
 status('حساب المدير معروف. أكمل التحقق الثنائي لعرض الإشعارات.');sync();
}
function qrSource(value){
 if(typeof value!=='string'||value.length>150000)return null;
 if(/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(value))return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(value);
 return /^data:image\/(?:svg\+xml|png)(?:;[^,]*)?,/i.test(value)?value:null;
}
$('enrollMfa').onclick=async()=>{
 if(busy||!allowed)return;const token=generation;busy=true;sync();$('mfaStatus').textContent='جارٍ إعداد تطبيق المصادقة…';
 try{
  const access=await currentAccess();if(!access||token!==generation)return;
  const result=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'UR Smart Admin '+new Date().toISOString().slice(0,19)});if(token!==generation)return;
  if(result.error||!result.data?.id||typeof result.data?.totp?.secret!=='string')throw Error('تعذر بدء إعداد تطبيق المصادقة. أعد المحاولة أو راجع إعداد MFA في Supabase.');
  pendingFactor=result.data.id;const source=qrSource(result.data.totp.qr_code);$('mfaQr').hidden=!source;if(source)$('mfaQr').src=source;
  $('mfaSecret').value=result.data.totp.secret;$('mfaSetup').hidden=false;$('verifyMfa').hidden=false;$('enrollMfa').hidden=true;
  $('mfaStatus').textContent='أضف الحساب إلى تطبيق المصادقة، ثم أدخل الرمز الذي يظهر في التطبيق. لا ترسل صورة هذه البيانات إلى المحادثة.';
 }catch(error){if(token===generation){clearSetup();$('mfaStatus').textContent=error.message||'تعذر إعداد المصادقة.';}}
 finally{busy=false;sync();}
};
$('verifyMfa').onsubmit=async event=>{
 event.preventDefault();if(busy||!allowed||!event.currentTarget.reportValidity())return;
 const factorId=pendingFactor||$('mfaFactor').value,code=$('mfaCode').value.trim();if(!factorId||!/^\d{6}$/.test(code)){$('mfaStatus').textContent='أدخل رمز التطبيق المكوّن من ستة أرقام.';return;}
 const token=generation;busy=true;sync();$('mfaStatus').textContent='جارٍ التحقق…';let verified=false;
 try{
  const access=await currentAccess();if(!access||token!==generation)return;
  const result=await client.auth.mfa.challengeAndVerify({factorId,code});if(token!==generation)return;
  if(result.error)throw Error('تعذر التحقق من الرمز. تأكد من الرمز الحالي ووقت الهاتف، ثم حاول مجددًا.');
  const current=await currentAccess({mfa:true});if(!current||token!==generation)return;
  clearSetup();$('mfaPanel').hidden=true;verified=true;status('نجح التحقق الثنائي. جارٍ فتح الإشعارات…');
 }catch(error){if(token===generation)$('mfaStatus').textContent=error.message||'تعذر إكمال التحقق.';}
 finally{$('mfaCode').value='';busy=false;sync();}
 if(verified&&token===generation)await Promise.all([loadNotifications(),loadVisits(),loadResearchOrders()]);
};
$('refreshResearchOrders').onclick=()=>void loadResearchOrders();
$('loadOlderResearchOrders').onclick=()=>void loadResearchOrders({append:true});
$('researchOrderFilter').onchange=()=>{if(editingResearchOrder()){$('researchOrderFilter').value=researchFilter;researchStatus('أكمل المراجعة الحالية أو امسح الملاحظة وعلامة التحقق قبل تغيير الحالة.');return;}researchFilter=$('researchOrderFilter').value;void loadResearchOrders();};
$('refreshVisits').onclick=()=>void loadVisits();
$('refreshNotifications').onclick=()=>void loadNotifications();
$('loadOlderNotifications').onclick=()=>void loadNotifications({append:true});
$('markAllSeen').onclick=()=>void markSeen(rows.filter(row=>!row.seen_at).map(row=>row.id));
$('logoutAdmin').onclick=async()=>{
 if(!client)return;lock('جارٍ تسجيل الخروج…');
 try{const result=await client.auth.signOut();if(result.error)throw Error();$('logoutAdmin').hidden=true;lock('تم تسجيل الخروج. سجّل الدخول مجددًا عند الحاجة.');}catch{status('تعذر إكمال تسجيل الخروج. أعد المحاولة أو أغلق الجلسة من إعدادات الحساب.',true);}
};
async function initialize(){
 const token=++generation;
 try{
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');if(token!==generation)return;
  authSubscription?.unsubscribe();
  client=createClient('https://ynsmhtsktbubxfhsekjq.supabase.co','sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc');
  const subscription=client.auth.onAuthStateChange?.((event,session)=>{if(event==='SIGNED_OUT'||userId&&session?.user?.id&&session.user.id!==userId)lock('انتهت جلسة المدير أو تغيّر الحساب. أعد تسجيل الدخول.');else if(allowed&&mfaReady)setTimeout(()=>{void currentAccess({mfa:true}).catch(()=>lock('تعذر التحقق من حماية الجلسة. أعد تسجيل الدخول.'));},0);});
  authSubscription=subscription?.data?.subscription||null;
  const session=await client.auth.getSession();if(token!==generation)return;
  if(session.error||!session.data?.session){lock('سجّل الدخول بحساب المدير للوصول إلى هذه الصفحة.');return;}
  const access=await currentAccess();if(!access||token!==generation)return;
  if(access.ready){$('adminGate').hidden=true;$('mfaPanel').hidden=true;$('adminContent').hidden=false;await Promise.all([loadNotifications(),loadVisits(),loadResearchOrders()]);}else await showMfa();
 }catch{if(token===generation){lock('تعذر تهيئة لوحة الإدارة. تحقق من الاتصال وإعدادات صلاحية الإدارة، ثم أعد تحميل الصفحة.');}}
}
function refreshVisible(){if(!document.hidden&&allowed&&mfaReady){void loadVisits();void loadResearchOrders({quiet:true});if(!olderOpen)void loadNotifications({quiet:true});}}
setInterval(refreshVisible,60000);
document.addEventListener('visibilitychange',refreshVisible);
window.addEventListener('pagehide',()=>lock('أعد التحقق من الجلسة عند العودة إلى لوحة الإدارة.'));
window.addEventListener('pageshow',event=>{if(event.persisted)void initialize();});
void initialize();
