import {withDeadline} from './request-deadline.mjs';

const FIELDS='id,owner_id,field_id,request_note,status,duration_days,quote_iqd,quote_scope,quote_version,quoted_at,accepted_at,payment_reference,admin_note,approved_at,expires_at,created_at,updated_at';
const STATUSES={waiting_quote:'بانتظار عرض السعر',quoted:'بانتظار قبول العميل',awaiting_payment:'بانتظار مراجعة الدفع',approved:'تم تفعيل الوصول',rejected:'مرفوض'};
const OPEN=['waiting_quote','quoted','awaiting_payment'];
const MAX_QUOTE=1000000000;
const $=id=>document.getElementById(id);
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
const date=value=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'}).format(d)+' — بغداد':'غير محدد';};
const money=value=>Number.isSafeInteger(value)&&value>0?value.toLocaleString('ar-IQ')+' دينار عراقي':'لم يُحدد عرض بعد';
const unwrap=value=>Array.isArray(value)?value[0]:value;

// Uses the parent admin's single client and checked allowlist/MFA gate. The
// database independently enforces the same approval permissions in its RPCs.
export function createAdminSatelliteAccess({getClient,authorize,currentGeneration,isActive}){
 let epoch=0,rows=[],loading=false,mutating=false,offset=0,hasMore=false,olderOpen=false,filter='open';
 const drafts=new Map();
 const current=(task,parent)=>task===epoch&&parent===currentGeneration()&&isActive();
 const status=(message,error=false)=>{$('satelliteAccessAdminStatus').textContent=message;$('satelliteAccessAdminStatus').className='muted'+(error?' error':'');};
 function sync(){
  const blocked=loading||mutating||!isActive();
  for(const id of ['refreshSatelliteAccessOrders','satelliteAccessOrderFilter'])$(id).disabled=blocked;
  $('olderSatelliteAccessOrders').disabled=blocked||!hasMore;
  for(const control of $('satelliteAccessOrderList').querySelectorAll('input,textarea,button'))control.disabled=blocked;
 }
 function lock(){
  epoch++;rows=[];loading=false;mutating=false;offset=0;hasMore=false;olderOpen=false;filter='open';drafts.clear();
  $('satelliteAccessAdminPanel').hidden=true;$('satelliteAccessOrderList').replaceChildren();$('satelliteAccessOrderFilter').value=filter;$('olderSatelliteAccessOrders').hidden=true;$('satelliteAccessAdminCount').textContent='—';status('لم تُحمّل الطلبات بعد.');sync();
 }
 function saveDrafts(){for(const form of $('satelliteAccessOrderList').querySelectorAll('form')){
  drafts.set(form.dataset.orderId,{amount:form.elements.quote_amount?.value||'',duration:form.elements.quote_duration?.value||'',scope:form.elements.quote_scope?.value||'',note:form.elements.admin_note?.value||'',verified:form.elements.payment_verified?.checked===true});
 }}
 function editing(){return [...$('satelliteAccessOrderList').querySelectorAll('form')].some(form=>[form.elements.quote_amount,form.elements.quote_scope,form.elements.admin_note].some(input=>input?.value.trim())||form.elements.quote_duration&&form.elements.quote_duration.value!==form.dataset.initialDuration||form.elements.payment_verified?.checked);}
 function rowValid(row){return row&&typeof row.id==='string'&&typeof row.owner_id==='string'&&(row.field_id===null||typeof row.field_id==='string')&&Object.hasOwn(STATUSES,row.status)&&Number.isSafeInteger(row.duration_days)&&row.duration_days>=1&&row.duration_days<=365&&(row.quote_iqd===null||Number.isSafeInteger(row.quote_iqd)&&row.quote_iqd>=1&&row.quote_iqd<=MAX_QUOTE)&&Number.isSafeInteger(row.quote_version)&&row.quote_version>=0;}
 function detail(list,label,value){const line=el('div');line.append(el('dt',label),el('dd',value));list.append(line);}
 function noteControl(form,row,rejectOnly=false){const id='satellite-access-note-'+row.id,label=el('label',rejectOnly?'ملاحظة عند رفض الطلب (اختياري)':'ملاحظة الإدارة (اختياري)'),note=el('textarea');label.htmlFor=id;note.id=id;note.name='admin_note';note.maxLength=1000;note.rows=3;note.value=drafts.get(row.id)?.note||'';form.append(label,note);}
 function render(){
  saveDrafts();const list=$('satelliteAccessOrderList');list.replaceChildren();$('satelliteAccessAdminCount').textContent=rows.length.toLocaleString('ar-IQ');$('olderSatelliteAccessOrders').hidden=!hasMore;
  if(!rows.length)list.append(el('p','لا توجد طلبات بهذه الحالة.','empty'));
  for(const row of rows){
   const card=el('article',undefined,'research-order satellite-access-order');card.dataset.orderId=row.id;
   const head=el('div',undefined,'notification-top');head.append(el('h3','التحليل الفضائي — وصول لحقل واحد'),el('span',row.status==='approved'?(Date.parse(row.expires_at)>Date.now()?'الوصول مفعّل':'انتهت مدة الوصول'):STATUSES[row.status],'badge'+(OPEN.includes(row.status)?' unread':'')));card.append(head);
   const details=el('dl');
   for(const [label,value] of [['رقم الطلب',row.id],['الحقل',row.field_id||'الحقل غير متاح — حُذف أو لم يعد مرتبطًا بالطلب'],['الحساب صاحب الطلب',row.owner_id],['طلب العميل',typeof row.request_note==='string'&&row.request_note.trim()?row.request_note:'لا توجد ملاحظة إضافية'],['مدة الوصول',row.duration_days.toLocaleString('ar-IQ')+' يومًا من تأكيد الدفع'],['عرض السعر',money(row.quote_iqd)],['نسخة العرض',row.quote_version?row.quote_version.toLocaleString('ar-IQ'):'لم يُرسل عرض بعد'],['قبول العميل للعرض',row.accepted_at?date(row.accepted_at):'لم يقبل العرض بعد'],['مرجع الدفع',typeof row.payment_reference==='string'&&row.payment_reference.trim()?row.payment_reference:'لم يُدخل مرجعًا'],['الموافقة على الدفع',row.approved_at?date(row.approved_at):'لم تُؤكد بعد'],['انتهاء الوصول',date(row.expires_at)],['تاريخ الطلب',date(row.created_at)]])detail(details,label,value);
   card.append(details);
   if(row.quote_scope)card.append(el('p','النطاق المعروض: '+row.quote_scope,'note'));
   if(row.admin_note)card.append(el('p','ملاحظة الإدارة: '+row.admin_note,'muted research-admin-note'));
   const available=typeof row.field_id==='string'&&!!row.field_id;
   const canQuote=available&&['waiting_quote','quoted'].includes(row.status)&&!row.accepted_at&&!row.approved_at;
   const canReview=available&&row.status==='awaiting_payment'&&!!row.accepted_at&&!row.approved_at&&Number.isSafeInteger(row.quote_iqd)&&row.quote_iqd>0&&row.quote_version>0&&typeof row.quote_scope==='string'&&!!row.quote_scope.trim();
   const canReject=OPEN.includes(row.status)&&!row.approved_at;
   if(!available)card.append(el('p','لا يمكن إرسال عرض أو الموافقة على الدفع لهذا الطلب لأن الحقل غير متاح. راجع الطلب مع صاحبه قبل اتخاذ القرار.','note'));
   if(canQuote||canReview||canReject){
    const form=el('form',undefined,'research-review satellite-access-review');form.dataset.orderId=row.id;form.dataset.initialDuration=String(row.duration_days);const draft=drafts.get(row.id);
    if(canQuote){
     const amountId='satellite-access-amount-'+row.id,amountLabel=el('label','المبلغ الإجمالي للطلب بالدينار العراقي'),amount=el('input');amountLabel.htmlFor=amountId;amount.id=amountId;amount.name='quote_amount';amount.type='number';amount.min='1';amount.max=String(MAX_QUOTE);amount.step='1';amount.required=true;amount.inputMode='numeric';amount.value=draft?.amount||'';
     const scopeId='satellite-access-scope-'+row.id,scopeLabel=el('label','نطاق العمل المتفق عليه'),scope=el('textarea');scopeLabel.htmlFor=scopeId;scope.id=scopeId;scope.name='quote_scope';scope.maxLength=2000;scope.required=true;scope.rows=4;scope.value=draft?.scope||'';
     const durationId='satellite-access-duration-'+row.id,durationLabel=el('label','مدة الوصول للحقل بالأيام (١–٣٦٥)'),duration=el('input');durationLabel.htmlFor=durationId;duration.id=durationId;duration.name='quote_duration';duration.type='number';duration.min='1';duration.max='365';duration.step='1';duration.required=true;duration.inputMode='numeric';duration.value=draft?.duration||String(row.duration_days);
     form.append(amountLabel,amount,durationLabel,duration,scopeLabel,scope,el('p','يرى العميل المبلغ والنطاق والمدة ويقبل نسخة العرض قبل تأكيد الدفع. تبدأ المدة من الموافقة الفعلية ولا يتجدد الوصول أو يُخصم مبلغ تلقائيًا.','muted'));
    }
    noteControl(form,row,!canReview);
    if(canReview){
     const check=el('input'),label=el('label',undefined,'payment-check');check.type='checkbox';check.name='payment_verified';check.id='satellite-access-check-'+row.id;check.required=true;check.checked=draft?.verified===true;label.htmlFor=check.id;label.append(check,el('span','تحققت من استلام '+money(row.quote_iqd)+' ومن قبول العميل النطاق ومدة الوصول ('+row.duration_days.toLocaleString('ar-IQ')+' يومًا) قبل التفعيل'));form.append(label);
    }
    const actions=el('div',undefined,'actions');
    if(canQuote){const submit=el('button',row.status==='quoted'?'إرسال عرض محدّث للعميل':'إرسال عرض السعر للعميل');submit.type='submit';actions.append(submit);form.addEventListener('submit',event=>{event.preventDefault();if(form.reportValidity())void mutate(row,'quote',form);});}
    else if(canReview){const approve=el('button','تأكيد الدفع وتفعيل التحليل الفضائي');approve.type='submit';actions.append(approve);form.addEventListener('submit',event=>{event.preventDefault();if(form.reportValidity())void mutate(row,'approve',form);});}
    if(canReject){const reject=el('button','رفض الطلب','reject-order');reject.type='button';reject.addEventListener('click',()=>void mutate(row,'reject',form));actions.append(reject);}
    form.append(actions);card.append(form);
   }
   list.append(card);
  }sync();
 }
 async function load({quiet=false,append=false,force=false}={}){
  if(!getClient()||!isActive()||loading||mutating&&!force||append&&!hasMore||quiet&&olderOpen)return false;
  if(!force&&editing()){if(!quiet)status('أكمل العرض أو مراجعة الدفع الحالية قبل تحديث الطلبات.');return false;}
  const task=epoch,parent=currentGeneration(),selectedFilter=filter;loading=true;sync();if(!quiet)status('جارٍ تحميل طلبات التحليل الفضائي…');
  try{
   const access=await withDeadline(authorize({mfa:true}));if(!access||!current(task,parent))return false;
   $('satelliteAccessAdminPanel').hidden=false;
   let query=getClient().from('satellite_access_orders').select(FIELDS).order('created_at',{ascending:false}).order('id',{ascending:false});
   if(selectedFilter==='open')query=query.in('status',OPEN);else if(selectedFilter!=='all')query=query.eq('status',selectedFilter);
   const result=await withDeadline(query.range(append?offset:0,(append?offset:0)+49));if(!current(task,parent)||filter!==selectedFilter)return false;
   const confirmed=await withDeadline(authorize({mfa:true}));if(!confirmed||!current(task,parent))return false;
   if(result.error||!Array.isArray(result.data)||result.data.some(row=>!rowValid(row)))throw Error('invalid satellite access orders');
   const batch=result.data;rows=append?[...new Map([...rows,...batch].map(row=>[row.id,row])).values()]:batch;offset=(append?offset:0)+batch.length;hasMore=batch.length===50;olderOpen=append;render();status('آخر تحديث: '+date(new Date().toISOString()));return true;
  }catch{if(current(task,parent)){$('satelliteAccessAdminPanel').hidden=false;status('تعذر تحميل طلبات الخدمات المدفوعة. تحقق من الاتصال والصلاحية ثم أعد المحاولة.',true);}return false;}
  finally{if(task===epoch){loading=false;sync();}}
 }
 async function mutate(row,decision,form){
  if(!isActive()||loading||mutating||!form.isConnected||!rows.some(item=>item.id===row.id))return;
  if(decision!=='reject'&&!form.reportValidity())return;
  const task=epoch,parent=currentGeneration(),note=form.elements.admin_note.value.trim();if(note.length>1000)return;
  const amount=decision==='quote'?Number(form.elements.quote_amount.value):null,scope=decision==='quote'?form.elements.quote_scope.value.trim():null,duration=decision==='quote'?Number(form.elements.quote_duration.value):null;
  if(decision==='quote'&&(!row.field_id||!['waiting_quote','quoted'].includes(row.status)||row.accepted_at||row.approved_at||!Number.isSafeInteger(amount)||amount<1||amount>MAX_QUOTE||!scope||scope.length>2000||!Number.isSafeInteger(duration)||duration<1||duration>365))return;
  if(decision==='approve'&&!(row.field_id&&form.elements.payment_verified?.checked&&row.status==='awaiting_payment'&&row.accepted_at&&!row.approved_at&&row.quote_version>0&&typeof row.quote_scope==='string'&&row.quote_scope.trim()))return;
  mutating=true;sync();status(decision==='quote'?'جارٍ إرسال عرض السعر…':'جارٍ حفظ مراجعة الدفع…');
  try{
   const access=await withDeadline(authorize({mfa:true}));if(!access||!current(task,parent))return;
   const name=decision==='quote'?'quote_satellite_access_order':'review_satellite_access_payment';
   const args=decision==='quote'?{p_order_id:row.id,p_amount_iqd:amount,p_scope:scope,p_duration_days:duration}:{p_order_id:row.id,p_decision:decision,p_note:note||null};
   const response=await withDeadline(getClient().rpc(name,args));if(!current(task,parent))return;
   const confirmed=await withDeadline(authorize({mfa:true}));if(!confirmed||!current(task,parent))return;
   const saved=unwrap(response.data);
   if(response.error||saved?.id!==row.id||saved.status!==(decision==='quote'?'quoted':decision==='approve'?'approved':'rejected')||decision==='quote'&&(saved.quote_iqd!==amount||saved.quote_scope!==scope||saved.duration_days!==duration||!Number.isSafeInteger(saved.quote_version)||saved.quote_version<=row.quote_version)||decision==='approve'&&(saved.quote_iqd!==row.quote_iqd||saved.duration_days!==row.duration_days||!Number.isFinite(Date.parse(saved.approved_at))||!Number.isFinite(Date.parse(saved.expires_at))||Math.abs(Date.parse(saved.expires_at)-Date.parse(saved.approved_at)-row.duration_days*86400000)>1000))throw Error('review failed');
   drafts.delete(row.id);for(const input of form.querySelectorAll('input,textarea')){if(input.type==='checkbox')input.checked=false;else input.value='';}
   if(await load({force:true})){if(current(task,parent))status(decision==='quote'?'أُرسل العرض. ينتظر قبول العميل له قبل مراجعة الدفع.':decision==='approve'?'تم تأكيد الدفع وتفعيل التحليل الفضائي للحقل حتى الموعد المحدد في الطلب.':'تم رفض الطلب قبل تفعيله.');}
  }catch{if(current(task,parent))status('تعذر حفظ القرار. حدّث الطلبات للتحقق من الحالة قبل تكرار الإجراء.',true);}
  finally{if(task===epoch){mutating=false;sync();}}
 }
 $('refreshSatelliteAccessOrders').onclick=()=>void load();$('olderSatelliteAccessOrders').onclick=()=>void load({append:true});
 $('satelliteAccessOrderFilter').onchange=()=>{if(editing()){$('satelliteAccessOrderFilter').value=filter;status('أكمل العرض أو مراجعة الدفع الحالية قبل تغيير الحالة.');return;}filter=$('satelliteAccessOrderFilter').value;void load();};
 return {load,lock,sync};
}
