import {withDeadline} from './request-deadline.mjs';
import {CATALOG,PROVINCES,catalogItem,provinceName} from './catalog.mjs';

const $=id=>document.getElementById(id);
const PROJECT='https://ynsmhtsktbubxfhsekjq.supabase.co';
const KEY='sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc';
const COLUMNS='id,owner_id,item_code,quantity,province,district,area_donum,contact_phone,customer_note,status,quote_iqd,admin_reply,created_at,updated_at';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES={new:'بانتظار مراجعة الإدارة',reviewing:'قيد المراجعة',quoted:'عرض جاهز للمراجعة',closed:'مغلق',cancelled:'ألغيت الطلب'};
const initialItem=new URLSearchParams(location.search).get('item');
let client=null,clientPromise=null,ownerId=null,lastOwner=null,generation=0,selection=0,selectedId=null;
let rows=[],checking=false,loading=false,creating=false,cancelling=false,reloadPending=false,reloadTimer=null;
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;};
const say=(id,text,bad=false)=>{const n=$(id);n.textContent=text;n.hidden=!text;n.classList.toggle('error',bad);};
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'}).format(new Date(value))+' — بغداد':'غير محدد';
const number=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('ar-IQ'):'غير محدد';
const money=value=>Number.isSafeInteger(value)&&value>0?value.toLocaleString('ar-IQ')+' دينار عراقي':'السعر حسب العرض';
const selected=()=>rows.find(row=>row.id===selectedId&&row.owner_id===ownerId)||null;
const installation=()=>catalogItem($('itemCode').value)?.installation===true;
const eligible=()=>!installation()||$('province').value==='wasit';
function sync(){
 const signed=!!ownerId;$('inquiryFields').disabled=!signed||creating;
 $('quantity').disabled=creating||!signed||installation();
 $('createInquiry').disabled=!signed||creating||!eligible();
 $('refreshInquiries').disabled=!signed||loading;$('retryAccount').disabled=checking||creating||cancelling;
 $('cancelInquiry').disabled=!signed||cancelling||!['new','reviewing'].includes(selected()?.status);
}
function serviceFields(){
 const item=catalogItem($('itemCode').value);$('itemScope').textContent=item?.scope||'';
 $('areaGroup').hidden=!item?.installation;
 if(item?.installation)$('quantity').value='1';
 $('provinceHelp').textContent=item?.installation?'موقع التنفيذ يجب أن يكون داخل محافظة واسط.':'المحافظة هي مكان التسليم المقترح. تؤكد الإدارة إمكانية التسليم وتكلفته في العرض.';
 say('eligibility',item?.installation&&$('province').value&&$('province').value!=='wasit'?'خدمة تنفيذ الري بالتنقيط متاحة داخل واسط فقط. اختر واسط إذا كان موقع التنفيذ فيها.':'',true);sync();
}
function chooseItem(code,{setProvince=false}={}){if(!catalogItem(code))return;$('itemCode').value=code;if(setProvince&&code==='drip_installation')$('province').value='wasit';serviceFields();}
function clearSelection(){selection++;selectedId=null;cancelling=false;$('detailPanel').hidden=true;$('detailFacts').replaceChildren();for(const id of ['detailTitle','detailStatus','detailMeta','detailNote','adminReply','quoteAmount','awaitingReply'])$(id).textContent='';say('cancelStatus','');}
function reset(message){generation++;ownerId=null;rows=[];creating=false;loading=false;clearSelection();$('inquiryForm').reset();$('inquiriesList').replaceChildren();$('privateContent').hidden=true;$('loginLink').hidden=false;$('accountLogin').hidden=false;$('accountStatus').textContent=message;for(const id of ['createStatus','inquiriesStatus'])say(id,'');chooseItem(catalogItem(initialItem)?initialItem:'drip_supplies',{setProvince:true});sync();}
function scheduleReload(){clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>{if(checking){reloadPending=true;return;}void openAccount();},0);}
function authChanged(event,incoming){
 if(event==='INITIAL_SESSION'){lastOwner=incoming?.user?.id??null;return;}
 if(event==='SIGNED_OUT'){lastOwner=null;reloadPending=false;clearTimeout(reloadTimer);reset('انتهت جلسة الحساب. سجّل الدخول لمتابعة طلباتك وردود الإدارة.');return;}
 if(!['SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event)||!incoming?.user?.id)return;
 if(lastOwner&&lastOwner!==incoming.user.id){reset('تغيّر الحساب؛ جارٍ استعادة طلبات الحساب الحالي.');lastOwner=incoming.user.id;scheduleReload();return;}
 lastOwner=incoming.user.id;if(ownerId!==incoming.user.id)scheduleReload();
}
async function connection(){if(client)return client;if(!clientPromise)clientPromise=withDeadline(import('./supabase-client.mjs')).then(({createClient})=>{client=createClient(PROJECT,KEY);client.auth.onAuthStateChange(authChanged);return client;}).catch(error=>{clientPromise=null;throw error;});return clientPromise;}
async function currentSession(token,account=ownerId){const r=await withDeadline(client.auth.getSession());if(token!==generation)return null;if(r.error)throw Error('تعذر التحقق من الحساب.');const value=r.data?.session;if(!value?.access_token||value.user?.id!==account){reset('انتهت الجلسة أو تغيّر الحساب. سجّل الدخول بالحساب الحالي ثم أعد المحاولة.');return null;}return value;}
async function openAccount(){
 if(checking){reloadPending=true;return;}checking=true;const token=++generation;loading=false;creating=false;clearSelection();rows=[];ownerId=null;$('inquiriesList').replaceChildren();$('privateContent').hidden=true;$('accountStatus').textContent='جارٍ استعادة جلسة حسابك…';sync();
 try{const sdk=await connection();if(token!==generation)return;const r=await withDeadline(sdk.auth.getSession());if(token!==generation)return;if(r.error)throw Error();const value=r.data?.session;if(!value?.access_token||!UUID.test(value.user?.id||'')){reset('سجّل الدخول بحساب أور لإرسال الطلب ومتابعة الرد. تصفّح المنتجات متاح للجميع.');return;}if(lastOwner&&lastOwner!==value.user.id)$('inquiryForm').reset();ownerId=value.user.id;lastOwner=ownerId;$('privateContent').hidden=false;$('loginLink').hidden=true;$('accountLogin').hidden=true;$('accountStatus').textContent='تم الاتصال بحسابك. تظهر طلباتك وردود الإدارة الخاصة بها فقط.';serviceFields();await loadInquiries();}
 catch{if(token===generation){$('accountStatus').textContent='تعذر الاتصال بالحساب الآن. أعد المحاولة دون مسح جلسة الدخول أو طلباتك.';$('accountLogin').hidden=false;}}
 finally{checking=false;sync();if(reloadPending){reloadPending=false;scheduleReload();}}
}
function validRows(value){return(Array.isArray(value)?value:[]).filter(row=>row&&UUID.test(row.id||'')&&row.owner_id===ownerId&&catalogItem(row.item_code)&&Object.hasOwn(STATUSES,row.status)&&Number.isInteger(row.quantity)&&row.quantity>=1&&row.quantity<=10000&&PROVINCES.some(p=>p[0]===row.province)&&(row.item_code!=='drip_installation'||row.quantity===1&&row.province==='wasit'));}
async function loadInquiries(){
 if(!ownerId||loading)return;const token=generation,account=ownerId;loading=true;sync();say('inquiriesStatus','جارٍ تحميل الطلبات…');
 try{const r=await withDeadline(client.from('product_inquiries').select(COLUMNS).eq('owner_id',account).order('created_at',{ascending:false}).limit(50));if(token!==generation||ownerId!==account)return;if(r.error)throw Error();if(!await currentSession(token,account))return;rows=validRows(r.data);if(selectedId&&!selected())clearSelection();renderRows();renderSelected();say('inquiriesStatus',rows.length?'آخر تحديث: '+date(new Date().toISOString()):'لا توجد طلبات بعد. اختر المنتج أو خدمة التنفيذ وأرسل احتياجك.');}
 catch{if(token===generation)say('inquiriesStatus','تعذر تحميل الطلبات. أعد التحديث؛ طلباتك المحفوظة لم تتغير.',true);}
 finally{if(token===generation){loading=false;sync();}}
}
function renderRows(){const list=$('inquiriesList');list.replaceChildren();for(const row of rows){const card=el('article',undefined,'inquiry-card'+(row.id===selectedId?' selected':'')),head=el('div',undefined,'inquiry-top');head.append(el('h3',catalogItem(row.item_code).title),el('span',STATUSES[row.status],'badge '+row.status));card.append(head,el('p',provinceName(row.province)+(row.district?' · '+row.district:'')),el('p','رقم الطلب: '+row.id),el('p','أُرسل: '+date(row.created_at)));if(Number.isSafeInteger(row.quote_iqd)&&row.quote_iqd>0)card.append(el('p','إجمالي عرض الإدارة: '+money(row.quote_iqd)));const button=el('button','عرض الطلب والرد','button secondary');button.type='button';button.dataset.inquiryId=row.id;button.onclick=()=>choose(row.id);card.append(button);list.append(card);}}
function choose(id){if(!rows.some(row=>row.id===id&&row.owner_id===ownerId))return;selection++;selectedId=id;cancelling=false;say('cancelStatus','');renderRows();renderSelected();}
function renderSelected(){
 const row=selected();if(!row){$('detailPanel').hidden=true;return;}$('detailPanel').hidden=false;$('detailTitle').textContent=catalogItem(row.item_code).title;$('detailStatus').textContent=STATUSES[row.status];$('detailStatus').className='badge '+row.status;$('detailMeta').textContent='رقم الطلب: '+row.id+' · آخر تحديث: '+date(row.updated_at);
 const facts=[['المحافظة',provinceName(row.province)],['الكمية',number(row.quantity)]];if(row.district)facts.push(['القضاء أو الناحية',row.district]);if(typeof row.area_donum==='number'&&row.area_donum>0)facts.push(['المساحة بالدونم العراقي',number(row.area_donum)]);if(row.contact_phone)facts.push(['رقم التواصل',row.contact_phone]);$('detailFacts').replaceChildren();for(const [title,value] of facts){const box=el('div');box.append(el('dt',title),el('dd',value));$('detailFacts').append(box);}
 $('detailNote').textContent=row.customer_note||'';$('detailNote').hidden=!row.customer_note;
 const hasReply=typeof row.admin_reply==='string'&&row.admin_reply.trim();$('replyPanel').hidden=!hasReply;$('adminReply').textContent=row.admin_reply||'';$('quoteAmount').textContent=Number.isSafeInteger(row.quote_iqd)&&row.quote_iqd>0?'إجمالي عرض السعر: '+money(row.quote_iqd):'';
 $('awaitingReply').textContent=row.status==='cancelled'?'أُلغي هذا الطلب. يمكنك إرسال طلب جديد عند الحاجة.':row.status==='closed'?'أُغلق الطلب. راجع رد الإدارة لمعرفة التفاصيل.':row.status==='quoted'?'راجع مواصفات العرض ونطاقه والتوفر والسعر، واتفق مع الإدارة على طريقة الدفع والتسليم أو موعد التنفيذ. لم يُحصّل الموقع دفعًا.':row.status==='reviewing'?'تراجع الإدارة احتياجك. يظهر ردها هنا عند تحديث الطلب.':'أُرسل طلبك إلى الإدارة. ستظهر تفاصيل ردها وعرضها هنا.';
 $('cancelInquiry').hidden=!['new','reviewing'].includes(row.status);sync();
}
function rpcError(error,fallback){return error?.code==='55000'?'تغيّرت حالة الطلب أو وصلت إلى حد الطلبات المتاحة. حدّث القائمة قبل إعادة المحاولة.':error?.code==='42501'?'الطلب غير متاح لهذا الحساب. راجع جلسة الدخول وأعد التحديث.':error?.code==='22023'?'راجع نوع الطلب والكمية والمحافظة والمدخلات. تنفيذ الري متاح داخل واسط فقط.':fallback;}
async function createInquiry(event){
 event.preventDefault();if(creating||!ownerId)return;const item=catalogItem($('itemCode').value),province=$('province').value,quantity=item?.installation?1:Number($('quantity').value),district=$('district').value.trim(),phone=$('contactPhone').value.trim(),note=$('customerNote').value.trim(),areaText=$('areaDonum').value.trim(),area=item?.installation&&areaText?Number(areaText):null;
 if(!item||!PROVINCES.some(p=>p[0]===province)||!Number.isInteger(quantity)||quantity<1||quantity>10000||!eligible()||district.length>120||phone.length>32||note.length>1500||(area!==null&&(!Number.isFinite(area)||area<=0||area>1000000))){say('createStatus','راجع المنتج والمحافظة والكمية والبيانات. التنفيذ متاح داخل واسط فقط، والمساحة إن ذُكرت يجب أن تكون موجبة.',true);return;}
 const token=generation,account=ownerId;creating=true;sync();say('createStatus','جارٍ إرسال طلبك…');try{if(!await currentSession(token,account))return;const response=await withDeadline(client.rpc('create_product_inquiry',{p_item_code:item.code,p_quantity:quantity,p_province:province,p_district:district||null,p_area_donum:area,p_contact_phone:phone||null,p_customer_note:note||null}));if(token!==generation||ownerId!==account)return;if(!await currentSession(token,account))return;if(response.error)throw response.error;const saved=Array.isArray(response.data)?response.data[0]:response.data;if(!UUID.test(saved?.id||'')||saved.status!=='new')throw Error();$('customerNote').value='';await loadInquiries();if(token!==generation)return;choose(saved.id);say('createStatus','أُرسل طلب عرض السعر إلى الإدارة. لم يتم تأكيد شراء أو حجز أو دفع.');}catch(error){if(token===generation)say('createStatus',rpcError(error,'تعذر إرسال الطلب. حدّث طلباتك قبل إعادة الإرسال لتجنب تكراره.'),true);}finally{if(token===generation){creating=false;sync();}}
}
async function cancelInquiry(){const row=selected();if(cancelling||!row||!['new','reviewing'].includes(row.status))return;const token=generation,chosen=selection,account=ownerId;cancelling=true;sync();say('cancelStatus','جارٍ إلغاء الطلب…');try{if(!await currentSession(token,account))return;const r=await withDeadline(client.rpc('cancel_product_inquiry',{p_inquiry_id:row.id}));if(token!==generation||chosen!==selection||ownerId!==account)return;if(!await currentSession(token,account))return;if(r.error)throw r.error;const saved=Array.isArray(r.data)?r.data[0]:r.data;if(saved?.id!==row.id||saved.status!=='cancelled')throw Error();await loadInquiries();if(token===generation&&chosen===selection)say('cancelStatus','أُلغي الطلب.');}catch(error){if(token===generation&&chosen===selection)say('cancelStatus',rpcError(error,'تعذر إلغاء الطلب. حدّث القائمة وراجع حالته.'),true);}finally{if(token===generation&&chosen===selection){cancelling=false;sync();}}}
for(const [code,title] of PROVINCES)$('province').add(new Option(title,code));
chooseItem(catalogItem(initialItem)?initialItem:'drip_supplies',{setProvince:true});
for(const link of document.querySelectorAll('[data-choose]'))link.addEventListener('click',()=>{chooseItem(link.dataset.choose,{setProvince:true});if(ownerId)$('itemCode').focus();});
$('itemCode').onchange=()=>{if(installation()&&!$('province').value)$('province').value='wasit';serviceFields();};$('province').onchange=serviceFields;
$('inquiryForm').addEventListener('submit',createInquiry);$('retryAccount').onclick=()=>void openAccount();$('refreshInquiries').onclick=()=>void loadInquiries();$('cancelInquiry').onclick=()=>void cancelInquiry();
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&ownerId)void loadInquiries();});
void openAccount();
