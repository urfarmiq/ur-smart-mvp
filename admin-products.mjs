import {withDeadline} from './request-deadline.mjs';

const FIELDS='id,owner_id,item_code,quantity,province,district,area_donum,contact_phone,customer_note,status,quote_iqd,admin_reply,created_at,updated_at';
const ITEMS={drip_supplies:'مستلزمات الري بالتنقيط',drip_installation:'تنفيذ الري بالتنقيط — واسط فقط',weather_station:'محطة الطقس الزراعية',pest_station:'محطة مكافحة الحشرات'};
const PROVINCES={baghdad:'بغداد',basra:'البصرة',nineveh:'نينوى',erbil:'أربيل',najaf:'النجف',karbala:'كربلاء',kirkuk:'كركوك',anbar:'الأنبار',diyala:'ديالى',salah_al_din:'صلاح الدين',dhi_qar:'ذي قار',maysan:'ميسان',wasit:'واسط',babil:'بابل',qadisiyyah:'القادسية',muthanna:'المثنى',sulaymaniyah:'السليمانية',duhok:'دهوك'};
const STATES={new:'طلب جديد',reviewing:'قيد المراجعة',quoted:'أُرسل عرض السعر',closed:'مغلق',cancelled:'ألغاه العميل'};
const OPEN=['new','reviewing','quoted'],MAX_QUOTE=1000000000;
const $=id=>document.getElementById(id);
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;};
const date=value=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'}).format(d)+' — بغداد':'غير متاح';};
const money=value=>Number.isSafeInteger(value)&&value>0?value.toLocaleString('ar-IQ')+' دينار عراقي':'لم يُحدد عرض بعد';
const text=(value,fallback='غير مدخل')=>typeof value==='string'&&value.trim()?value:fallback;
const unwrap=value=>Array.isArray(value)?value[0]:value;

// Reuses the parent's live allowlist/MFA authorization and single SDK client.
// Every read and mutation also has independent database authorization.
export function createAdminProducts({getClient,authorize,currentGeneration,isActive}){
 let epoch=0,rows=[],loading=false,mutating=false,offset=0,hasMore=false,olderOpen=false,filter='open';
 const drafts=new Map();
 const current=(task,parent)=>task===epoch&&parent===currentGeneration()&&isActive();
 const status=(message,error=false)=>{$('productAdminStatus').textContent=message;$('productAdminStatus').className='muted'+(error?' error':'');};
 function sync(){const blocked=loading||mutating||!isActive();for(const id of ['refreshProductInquiries','productInquiryFilter'])$(id).disabled=blocked;$('olderProductInquiries').disabled=blocked||!hasMore;for(const c of $('productInquiryList').querySelectorAll('input,textarea,button'))c.disabled=blocked;}
 function lock(){epoch++;rows=[];loading=false;mutating=false;offset=0;hasMore=false;olderOpen=false;filter='open';drafts.clear();$('productAdminPanel').hidden=true;$('productInquiryList').replaceChildren();$('productInquiryFilter').value=filter;$('olderProductInquiries').hidden=true;$('productAdminCount').textContent='—';status('لم تُحمّل الطلبات بعد.');sync();}
 function saveDrafts(){for(const form of $('productInquiryList').querySelectorAll('form'))drafts.set(form.dataset.inquiryId,{amount:form.elements.quote_amount.value,reply:form.elements.admin_reply.value});}
 function editing(){return [...$('productInquiryList').querySelectorAll('form')].some(f=>f.elements.quote_amount.value!==f.dataset.initialAmount||f.elements.admin_reply.value!==f.dataset.initialReply);}
 function rowValid(r){return r&&typeof r.id==='string'&&typeof r.owner_id==='string'&&Object.hasOwn(ITEMS,r.item_code)&&Object.hasOwn(STATES,r.status)&&Object.hasOwn(PROVINCES,r.province)&&Number.isSafeInteger(r.quantity)&&r.quantity>=1&&r.quantity<=10000&&(r.quote_iqd===null||Number.isSafeInteger(r.quote_iqd)&&r.quote_iqd>=1&&r.quote_iqd<=MAX_QUOTE);}
 function detail(list,label,value){const line=el('div');line.append(el('dt',label),el('dd',value));list.append(line);}
 function render(){
  saveDrafts();const list=$('productInquiryList');list.replaceChildren();$('productAdminCount').textContent=rows.length.toLocaleString('ar-IQ');$('olderProductInquiries').hidden=!hasMore;
  if(!rows.length)list.append(el('p','لا توجد طلبات بهذه الحالة.','empty'));
  for(const row of rows){
   const card=el('article',undefined,'research-order product-inquiry');card.dataset.inquiryId=row.id;
   const heading=el('div',undefined,'notification-top');heading.append(el('h3',ITEMS[row.item_code]),el('span',STATES[row.status],'badge'+(OPEN.includes(row.status)?' unread':'')));card.append(heading);
   const details=el('dl');
   for(const [label,value] of [['رقم الطلب',row.id],['الحساب صاحب الطلب',row.owner_id],['المحافظة',PROVINCES[row.province]],['القضاء أو المنطقة',text(row.district)],['الكمية المطلوبة',row.quantity.toLocaleString('ar-IQ')],['المساحة بالدونم العراقي',row.area_donum!==null&&row.area_donum!==undefined?String(row.area_donum):'غير مدخلة'],['هاتف التواصل الاختياري',text(row.contact_phone)],['تفاصيل العميل',text(row.customer_note,'لا توجد ملاحظات إضافية')],['إجمالي عرض السعر',money(row.quote_iqd)],['تاريخ الطلب',date(row.created_at)],['آخر تحديث',date(row.updated_at)]])detail(details,label,value);
   card.append(details);if(row.admin_reply)card.append(el('p','رد الإدارة: '+row.admin_reply,'note'));
   const installation=row.item_code==='drip_installation',eligible=!installation||row.province==='wasit'&&row.quantity===1;
   if(installation)card.append(el('p',eligible?'نطاق التنفيذ: محافظة واسط فقط. يحدد العرض المكونات والتكلفة وموعد العمل قبل الاتفاق.':'هذا الطلب خارج نطاق تنفيذ الري المسموح. يمكن إغلاقه فقط؛ لا يُرسل له عرض تنفيذ.','note'));
   if(OPEN.includes(row.status)){
    const form=el('form',undefined,'research-review product-review');form.dataset.inquiryId=row.id;form.addEventListener('submit',event=>event.preventDefault());const draft=drafts.get(row.id);
    const amount=el('input'),amountLabel=el('label','إجمالي عرض السعر (دينار عراقي) — مطلوب عند إرسال العرض');amount.id='product-amount-'+row.id;amountLabel.htmlFor=amount.id;amount.name='quote_amount';amount.type='number';amount.min='1';amount.max=String(MAX_QUOTE);amount.step='1';amount.inputMode='numeric';amount.value=draft?.amount??(row.quote_iqd===null?'':String(row.quote_iqd));form.dataset.initialAmount=row.quote_iqd===null?'':String(row.quote_iqd);
    const reply=el('textarea'),replyLabel=el('label','رد العميل ونطاق العرض (حتى ٢٠٠٠ حرف)');reply.id='product-reply-'+row.id;replyLabel.htmlFor=reply.id;reply.name='admin_reply';reply.rows=4;reply.maxLength=2000;reply.value=draft?.reply??row.admin_reply??'';form.dataset.initialReply=row.admin_reply||'';
    amount.addEventListener('input',()=>amount.setCustomValidity(''));reply.addEventListener('input',()=>reply.setCustomValidity(''));
    form.append(amountLabel,amount,replyLabel,reply,el('p','يظهر هذا الرد والمبلغ لصاحب الطلب. إرسال عرض لا يؤكد دفعًا أو حجز مخزون أو تنفيذًا؛ اتفق على المواصفات والتوفر والتسليم أولًا.','muted'));
    const actions=el('div',undefined,'actions');
    if(eligible){const quote=el('button','إرسال عرض السعر للعميل');quote.type='submit';actions.append(quote);const review=el('button','وضع قيد المراجعة','secondary');review.type='button';review.addEventListener('click',()=>void mutate(row,'reviewing',form));actions.append(review);form.addEventListener('submit',event=>{event.preventDefault();void mutate(row,'quoted',form);});}
    const close=el('button','إغلاق الطلب','secondary');close.type='button';close.addEventListener('click',()=>void mutate(row,'closed',form));actions.append(close);form.append(actions);card.append(form);
   }
   list.append(card);
  }sync();
 }
 async function load({quiet=false,append=false,force=false}={}){
  if(!getClient()||!isActive()||loading||mutating&&!force||append&&!hasMore||quiet&&olderOpen)return false;
  if(!force&&editing()){if(!quiet)status('أكمل الرد الحالي قبل تحديث الطلبات.');return false;}
  const task=epoch,parent=currentGeneration(),chosen=filter;loading=true;sync();if(!quiet)status('جارٍ تحميل طلبات المنتجات والتنفيذ…');
  try{
   const access=await withDeadline(authorize({mfa:true}));if(!access||!current(task,parent))return false;$('productAdminPanel').hidden=false;
   let query=getClient().from('product_inquiries').select(FIELDS).order('created_at',{ascending:false}).order('id',{ascending:false});if(chosen==='open')query=query.in('status',OPEN);else if(chosen!=='all')query=query.eq('status',chosen);
   const result=await withDeadline(query.range(append?offset:0,(append?offset:0)+49));if(!current(task,parent)||filter!==chosen)return false;
   const confirmed=await withDeadline(authorize({mfa:true}));if(!confirmed||!current(task,parent))return false;
   if(result.error||!Array.isArray(result.data)||result.data.some(r=>!rowValid(r)))throw Error('invalid product inquiry response');
   const batch=result.data;rows=append?[...new Map([...rows,...batch].map(r=>[r.id,r])).values()]:batch;offset=(append?offset:0)+batch.length;hasMore=batch.length===50;olderOpen=append;render();status('آخر تحديث: '+date(new Date().toISOString()));return true;
  }catch{if(current(task,parent)){$('productAdminPanel').hidden=false;status('تعذر تحميل طلبات المنتجات. تحقق من الاتصال والصلاحية ثم أعد المحاولة.',true);}return false;}
  finally{if(task===epoch){loading=false;sync();}}
 }
 async function mutate(row,decision,form){
  if(!isActive()||loading||mutating||!form.isConnected||!rows.some(r=>r.id===row.id)||!OPEN.includes(row.status)||!['reviewing','quoted','closed'].includes(decision))return;
  if(decision!=='closed'&&row.item_code==='drip_installation'&&(row.province!=='wasit'||row.quantity!==1))return;
  const reply=form.elements.admin_reply.value.trim(),amount=decision==='quoted'?Number(form.elements.quote_amount.value):null;if(reply.length>2000)return;
  form.elements.admin_reply.setCustomValidity(decision==='quoted'&&!reply?'اكتب المواصفات والنطاق والتوفر ضمن عرض السعر.':'');form.elements.quote_amount.setCustomValidity(decision==='quoted'&&(!Number.isSafeInteger(amount)||amount<1||amount>MAX_QUOTE)?'أدخل مبلغًا صحيحًا للعرض بالدينار العراقي.':'');
  if(decision==='quoted'&&!form.reportValidity())return;
  const task=epoch,parent=currentGeneration();mutating=true;sync();status('جارٍ حفظ الرد على الطلب…');
  try{
   const access=await withDeadline(authorize({mfa:true}));if(!access||!current(task,parent))return;
   const response=await withDeadline(getClient().rpc('review_product_inquiry',{p_inquiry_id:row.id,p_status:decision,p_admin_reply:reply||null,p_quote_iqd:amount}));if(!current(task,parent))return;
   const confirmed=await withDeadline(authorize({mfa:true}));if(!confirmed||!current(task,parent))return;
   const saved=unwrap(response.data);if(response.error||saved?.id!==row.id||saved.status!==decision||saved.quote_iqd!==amount||saved.admin_reply!==(reply||null))throw Error('invalid review response');
   drafts.delete(row.id);form.remove();if(await load({force:true})){if(current(task,parent))status(decision==='quoted'?'أُرسل عرض السعر والرد إلى صاحب الطلب.':decision==='closed'?'أُغلق الطلب دون تسجيل دفع أو تنفيذ تلقائي.':'حُفظ الطلب قيد المراجعة.');}
  }catch{if(current(task,parent))status('تعذر حفظ الرد. حدّث الطلبات للتحقق من الحالة قبل تكرار الإجراء.',true);}
  finally{if(task===epoch){mutating=false;sync();}}
 }
 $('refreshProductInquiries').onclick=()=>void load();$('olderProductInquiries').onclick=()=>void load({append:true});
 $('productInquiryFilter').onchange=()=>{if(editing()){$('productInquiryFilter').value=filter;status('أكمل الرد الحالي قبل تغيير الحالة.');return;}filter=$('productInquiryFilter').value;void load();};
 return {load,lock,sync};
}
