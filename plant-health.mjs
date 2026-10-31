import {withDeadline} from './request-deadline.mjs';

const ENDPOINT='https://ur-smart-satellite.alialbatekh111.workers.dev/plant-health';
const SUPABASE_URL='https://ynsmhtsktbubxfhsekjq.supabase.co';
const PUBLIC_KEY='sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc';
const MAX_SOURCE_BYTES=10*1024*1024,MAX_SOURCE_PIXELS=24000000,MAX_SIDE=1536,MAX_ENCODED_BYTES=160*1024,MAX_TOTAL_BYTES=512*1024;
const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(className)value.className=className;return value;};
const format=(number,options={})=>new Intl.NumberFormat('ar-IQ',options).format(number);
let photos=[],processing=false,busy=false,generation=0,photoGeneration=0,controller=null,report=null;
let client=null,clientPromise=null,session=null,accountState='loading',accountGeneration=0,lastUserId=null;
let serviceAvailable=false,availabilityGeneration=0,cooldownUntil=0,cooldownTimer=null;

function say(message,state='ready'){$('plantHealthStatus').textContent=message;$('plantHealthStatus').dataset.state=state;}
function invalidate(message){
 generation++;controller?.abort();controller=null;busy=false;report=null;$('resultPanel').hidden=true;
 $('resultSummary').textContent='';$('resultDetails').replaceChildren();$('resultMeta').textContent='';$('resultNote').textContent='';
 if(message)say(message);updateControls();
}
function updateControls(){
 const eligible=accountState==='ready'&&session?.access_token&&serviceAvailable&&photos.length&&$('crop').value.trim()&&$('symptoms').value.trim()&&$('shareConsent').checked;
 const cooling=Date.now()<cooldownUntil;
 $('analyzePlant').disabled=!eligible||busy||processing||cooling;
 $('analyzePlant').textContent=processing?'جارٍ تجهيز الصور…':busy?'جارٍ فحص الصور…':cooling?'انتظر قبل طلب فحص آخر':'افحص صور النبات';
 $('cancelPlantAnalysis').hidden=!busy&&!processing;
 $('plantImages').disabled=$('plantCamera').disabled=processing||photos.length>=3;
 for(const id of ['addPhotoButton','cameraPhotoButton'])$(id).setAttribute('aria-disabled',String(processing||photos.length>=3));
 $('photoCount').textContent=format(photos.length)+' / ٣';
}
function closePreview(){const dialog=$('photoDialog');if(dialog.open){if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}$('expandedPlantPhoto').removeAttribute('src');delete dialog.dataset.photoId;}
function clearPhotos(){photoGeneration++;processing=false;closePreview();for(const photo of photos)URL.revokeObjectURL(photo.url);photos=[];$('photoPreviews').replaceChildren();$('plantImages').value='';$('plantCamera').value='';}
function clearInputs(message='تم مسح المدخلات من هذه الصفحة.'){clearPhotos();$('plantHealthForm').reset();invalidate(message);}
function showPhotos(){
 const list=$('photoPreviews');list.replaceChildren();
 photos.forEach((photo,index)=>{
  const card=node('article',undefined,'photo-card'),expand=node('button',undefined,'expand-photo'),image=node('img'),caption=node('div',undefined,'photo-caption'),label=node('div'),remove=node('button','حذف الصورة','remove-photo');
  expand.type='button';expand.setAttribute('aria-label','تكبير الصورة '+format(index+1));image.src=photo.url;image.alt='الصورة '+format(index+1)+' للنبات قبل الإرسال';image.width=photo.width;image.height=photo.height;expand.append(image);
  expand.onclick=()=>{const dialog=$('photoDialog');$('expandedPlantPhoto').src=photo.url;dialog.dataset.photoId=photo.id;if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');};
  label.append(node('p','الصورة '+format(index+1)+' · '+format(Math.round(photo.bytes/1024))+' كيلوبايت · '+format(photo.width)+'×'+format(photo.height)+' بكسل'),node('p','اضغط الصورة لتكبيرها','photo-view-hint'));
  remove.type='button';remove.setAttribute('aria-label','حذف الصورة '+format(index+1));remove.onclick=()=>{
   photoGeneration++;processing=false;if($('photoDialog').dataset.photoId===photo.id)closePreview();photos=photos.filter(row=>row.id!==photo.id);URL.revokeObjectURL(photo.url);$('shareConsent').checked=false;showPhotos();invalidate('حُذفت الصورة. راجع الصور المتبقية قبل الفحص.');
  };
  caption.append(label,remove);card.append(expand,caption);list.append(card);
 });updateControls();
}
function dimensions(bytes){
 const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=bytes.length;
 if(length>=24&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)&&String.fromCharCode(...bytes.slice(12,16))==='IHDR')return {mime:'image/png',width:data.getUint32(16),height:data.getUint32(20)};
 if(length>=4&&bytes[0]===255&&bytes[1]===216){
  let offset=2;
  while(offset+3<length){
   if(bytes[offset++]!==255)continue;while(offset<length&&bytes[offset]===255)offset++;const marker=bytes[offset++];
   if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;
   if(offset+2>length)break;const size=data.getUint16(offset);if(size<2||offset+size>length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&size>=8)return {mime:'image/jpeg',width:data.getUint16(offset+5),height:data.getUint16(offset+3)};
   offset+=size;
  }
 }
 if(length>=30&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'){
  const chunk=String.fromCharCode(...bytes.slice(12,16));
  if(chunk==='VP8X'){
   if(bytes[20]&2)throw Error('اختر صورة ثابتة؛ صور WebP المتحركة غير مناسبة لهذا الفحص.');
   return {mime:'image/webp',width:1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),height:1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)};
  }
  if(chunk==='VP8L'&&bytes[20]===47)return {mime:'image/webp',width:1+((bytes[21]|bytes[22]<<8)&16383),height:1+((bytes[22]>>6|bytes[23]<<2|bytes[24]<<10)&16383)};
  if(chunk==='VP8 '&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42)return {mime:'image/webp',width:data.getUint16(26,true)&16383,height:data.getUint16(28,true)&16383};
 }
 throw Error('لم نستطع قراءة الصورة. اختر JPEG أو PNG أو WebP صالحًا؛ ملفات HEIC غير مدعومة هنا. جرّب التصوير بالكاميرا أو حفظ الصورة بصيغة JPEG.');
}
async function bitmapFor(file){
 if(typeof createImageBitmap==='function'){try{return await createImageBitmap(file);}catch{/* The image element also supports browsers with partial bitmap support. */}}
 const url=URL.createObjectURL(file),image=new Image();
 try{await withDeadline(new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('تعذر فتح الصورة. اختر صورة أخرى واضحة بصيغة JPEG أو PNG أو WebP.'));image.src=url;}));return image;}
 finally{URL.revokeObjectURL(url);}
}
async function preparePhoto(file){
 if(!file.size||file.size>MAX_SOURCE_BYTES)throw Error('حجم الصورة غير مناسب. اختر صورة أصلية لا تتجاوز ١٠ ميغابايت.');
 if(file.type&&!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('هذه الصيغة غير مدعومة. اختر JPEG أو PNG أو WebP؛ إذا كانت الصورة HEIC، احفظ نسخة JPEG أو جرّب التصوير بالكاميرا.');
 const source=dimensions(new Uint8Array(await file.arrayBuffer()));
 if(!Number.isInteger(source.width)||!Number.isInteger(source.height)||source.width<64||source.height<64)throw Error('الصورة صغيرة جدًا. اختر صورة واضحة لا يقل عرضها وارتفاعها عن ٦٤ بكسل.');
 if(source.width>16384||source.height>16384||source.width*source.height>MAX_SOURCE_PIXELS)throw Error('دقة الصورة الأصلية كبيرة جدًا للهاتف. قصّها أو اختر نسخة أقل من ٢٤ مليون بكسل ثم أعد المحاولة.');
 if(file.type&&file.type!==source.mime)throw Error('امتداد الصورة أو نوعها لا يطابق محتواها. أعد حفظها بصيغة JPEG أو PNG.');
 let bitmap;
 try{
  const opening=bitmapFor(file);try{bitmap=await withDeadline(opening);}catch(error){void opening.then(late=>late?.close?.(),()=>{});throw error;}const width=bitmap.width||bitmap.naturalWidth,height=bitmap.height||bitmap.naturalHeight;
  if(!width||!height||width*height>MAX_SOURCE_PIXELS)throw Error('تعذر تجهيز أبعاد هذه الصورة. اختر نسخة أصغر.');
  let scale=Math.min(1,MAX_SIDE/Math.max(width,height)),encoded=null;
  for(let attempt=0;attempt<8;attempt++){
   const canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
   if(canvas.width<64||canvas.height<64)throw Error('الصورة ضيقة جدًا. اختر صورة أوضح وأقرب إلى الشكل المعتاد.');
   const context=canvas.getContext('2d');if(!context)throw Error('تعذر تجهيز الصور في هذا المتصفح. جرّب متصفحًا حديثًا.');
   context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const uri=canvas.toDataURL('image/jpeg',attempt?0.67:0.85);if(!uri.startsWith('data:image/jpeg;base64,'))throw Error('تعذر تحويل الصورة إلى JPEG في هذا المتصفح.');
   const data=uri.slice(uri.indexOf(',')+1),bytes=Math.floor(data.length*3/4)-(data.endsWith('==')?2:data.endsWith('=')?1:0);
   if(bytes<=MAX_ENCODED_BYTES){encoded={data,bytes,width:canvas.width,height:canvas.height};break;}if(attempt>=1)scale*=0.8;await new Promise(resolve=>requestAnimationFrame(resolve));
  }
  if(!encoded)throw Error('الصورة كبيرة بعد التجهيز. قصّ الجزء المصاب أو اختر صورة أصغر.');
  const decoded=atob(encoded.data),buffer=new Uint8Array(decoded.length);for(let index=0;index<decoded.length;index++)buffer[index]=decoded.charCodeAt(index);
  return {...encoded,id:crypto.randomUUID(),mime_type:'image/jpeg',url:URL.createObjectURL(new Blob([buffer],{type:'image/jpeg'}))};
 }finally{bitmap?.close?.();}
}
async function addPhotos(input){
 const selected=[...input.files];input.value='';if(!selected.length)return;
 if(selected.length+photos.length>3){say('يمكنك إضافة ٣ صور كحد أقصى. احذف صورة قبل إضافة غيرها.','error');return;}
 const attempt=++photoGeneration;processing=true;$('shareConsent').checked=false;invalidate('جارٍ تجهيز نسخة الصور وإزالة بياناتها المرفقة…');processing=true;updateControls();
 const prepared=[];
 try{
  for(const file of selected){const photo=await preparePhoto(file);if(attempt!==photoGeneration){URL.revokeObjectURL(photo.url);return;}prepared.push(photo);}
  if(photos.reduce((sum,row)=>sum+row.bytes,0)+prepared.reduce((sum,row)=>sum+row.bytes,0)>MAX_TOTAL_BYTES)throw Error('مجموع الصور كبير للفحص. احذف صورة أو استخدم صورًا أصغر.');
  photos.push(...prepared);prepared.length=0;showPhotos();say('الصور جاهزة للمعاينة. أضف وصف الأعراض وراجع موافقة الإرسال.');
 }catch(error){if(attempt===photoGeneration)say(error?.message||'تعذر تجهيز الصور. أعد اختيارها.','error');}
 finally{for(const photo of prepared)URL.revokeObjectURL(photo.url);if(attempt===photoGeneration){processing=false;updateControls();}}
}
function accountMessage(text,state,needsLogin=false){accountState=state;$('accountStatus').textContent=text;$('accountStatus').closest('section').dataset.account=state;$('accountSignIn').hidden=!needsLogin;updateControls();}
function resetCooldown(){cooldownUntil=0;clearTimeout(cooldownTimer);}
function onAccount(event,incoming){
 if(event==='INITIAL_SESSION'){lastUserId=incoming?.user?.id??null;return;}
 if(event==='SIGNED_OUT'){
  accountGeneration++;session=null;lastUserId=null;$('retryAccount').disabled=false;resetCooldown();clearInputs('انتهت جلسة الحساب. سجّل الدخول مجددًا قبل إرسال الصور.');accountMessage('لا توجد جلسة دخول؛ استخدم حسابك الحالي.','anonymous',true);return;
 }
 if(!['SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event)||!incoming?.user?.id||!incoming.access_token)return;
 if(lastUserId&&incoming.user.id!==lastUserId){accountGeneration++;resetCooldown();clearInputs('تغيّر الحساب. أضف صورًا جديدة لهذا الفحص.');}
 lastUserId=incoming.user.id;session=incoming;$('retryAccount').disabled=false;accountMessage('تم الاتصال بحسابك. الصور لا تُرسل إلا عند طلب الفحص.','ready');
}
async function connection(){
 if(client)return client;
 if(!clientPromise)clientPromise=withDeadline(import('./supabase-client.mjs')).then(({createClient})=>{client=createClient(SUPABASE_URL,PUBLIC_KEY);client.auth.onAuthStateChange?.(onAccount);return client;}).catch(error=>{clientPromise=null;throw error;});
 return clientPromise;
}
async function syncAccount(){
 const attempt=++accountGeneration;session=null;invalidate();$('retryAccount').disabled=true;accountMessage('جارٍ استعادة جلسة حسابك…','loading');
 try{
  const sdk=await connection();if(attempt!==accountGeneration)return;const result=await withDeadline(sdk.auth.getSession());if(attempt!==accountGeneration)return;
  if(result.error)throw Error('session unavailable');
  if(result.data?.session?.access_token&&result.data.session.user?.id){if(lastUserId&&lastUserId!==result.data.session.user.id){resetCooldown();clearInputs('تغيّر الحساب. أضف صورًا جديدة لهذا الفحص.');}session=result.data.session;lastUserId=session.user.id;accountMessage('تم الاتصال بحسابك. الصور لا تُرسل إلا عند طلب الفحص.','ready');}
  else{if(lastUserId){resetCooldown();clearInputs('انتهت جلسة الحساب. سجّل الدخول قبل تجهيز فحص جديد.');}lastUserId=null;accountMessage('سجّل الدخول بحساب أور الحالي لطلب الفحص.','anonymous',true);}
 }catch{if(attempt===accountGeneration)accountMessage('تعذر التحقق من الجلسة. أعد الاتصال؛ لم نمسح بيانات حسابك.','error');}
 finally{if(attempt===accountGeneration)$('retryAccount').disabled=false;}
}
async function availability(){
 const attempt=++availabilityGeneration;serviceAvailable=false;$('serviceStatus').textContent='جارٍ التحقق من توفر خدمة الصور…';updateControls();
 try{
  const response=await fetch(ENDPOINT+'/status',{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(12000)}),data=await response.json();
  if(attempt!==availabilityGeneration)return;
  serviceAvailable=response.ok&&data?.available===true&&data?.free_tier_confirmed===true;
  $('serviceStatus').textContent=serviceAvailable?'الخدمة مهيأة؛ التنفيذ حسب الحصة المجانية وحدود الاستخدام.':'خدمة الصور غير متاحة الآن. يمكنك تجهيز الصور وإعادة الاتصال لاحقًا.';
 }catch{if(attempt===availabilityGeneration)$('serviceStatus').textContent='تعذر التحقق من توفر الخدمة. اضغط إعادة الاتصال للمحاولة.';}
 finally{if(attempt===availabilityGeneration)updateControls();}
}
function text(value,max=3000){if(typeof value!=='string'||value.length>max||!value.trim())throw Error('invalid output');return value.trim();}
function strings(value){if(!Array.isArray(value)||value.length>12)throw Error('invalid output');return value.map(item=>text(item,1600));}
function validResult(value){
 const source=value?.assessment;if(!source||typeof source!=='object'||Array.isArray(source)||!['usable','limited','unusable'].includes(source.image_quality)||typeof source.plant_visible!=='boolean'||!Array.isArray(source.possible_causes)||source.possible_causes.length>6)throw Error('invalid output');
 const assessment={image_quality:source.image_quality,plant_visible:source.plant_visible,summary:text(source.summary),observations:strings(source.observations),possible_causes:source.possible_causes.map(cause=>{if(!cause||!['disease','pest','abiotic','uncertain'].includes(cause.category))throw Error('invalid output');return {name:text(cause.name,250),category:cause.category,supporting_signs:strings(cause.supporting_signs),distinguishing_checks:strings(cause.distinguishing_checks)};}),missing_information:strings(source.missing_information),initial_steps:strings(source.initial_steps),expert_review:strings(source.expert_review),limitations:strings(source.limitations)};
 if((!assessment.plant_visible||assessment.image_quality==='unusable')&&assessment.possible_causes.length)throw Error('invalid output');
 const stamp=new Date(value.generated_at);if(!Number.isFinite(stamp.getTime()))throw Error('invalid output');
 return {provider:text(value.provider,100),model:text(value.model,120),generated_at:stamp.toISOString(),assessment,note:text(value.note,1600)};
}
function listSection(heading,items){
 if(!items.length)return null;const section=node('section',undefined,'result-section'),list=node('ul');section.append(node('h3',heading));for(const item of items)list.append(node('li',item));section.append(list);return section;
}
function renderResult(result,context){
 const assessment=result.assessment,box=$('resultDetails');box.replaceChildren();$('resultSummary').textContent=assessment.summary;
 const quality={usable:'صور مناسبة للفحص الأولي',limited:'الصور محدودة الوضوح',unusable:'يلزم صور أوضح'};$('qualityBadge').textContent=!assessment.plant_visible?'لم يتضح نبات قابل للفحص':quality[assessment.image_quality];$('qualityBadge').dataset.quality=assessment.image_quality;
 $('resultMeta').textContent=context.crop+' · عدد الصور: '+format(context.image_count)+' · '+new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'}).format(new Date(result.generated_at))+' بتوقيت بغداد · '+result.provider+' / '+result.model;
 const observed=listSection('ما لوحظ في الصور',assessment.observations);if(observed)box.append(observed);
 if(assessment.possible_causes.length){
  const section=node('section',undefined,'result-section causes-section'),grid=node('div',undefined,'causes-grid');section.append(node('h3','أسباب محتملة تحتاج تمييزًا ميدانيًا'));
  const categories={disease:'مرض محتمل',pest:'ضرر آفة محتمل',abiotic:'سبب غير مرضي محتمل',uncertain:'سبب غير محسوم'};
  for(const cause of assessment.possible_causes){const card=node('article',undefined,'cause-card'),heading=node('div',undefined,'cause-heading');heading.append(node('h4',cause.name),node('span',categories[cause.category],'cause-category'));card.append(heading);
   for(const [title,items] of [['علامات قد تدعمه',cause.supporting_signs],['ما يساعد على التمييز',cause.distinguishing_checks]])if(items.length){card.append(node('h5',title));const list=node('ul');for(const item of items)list.append(node('li',item));card.append(list);}grid.append(card);
  }section.append(grid);box.append(section);
 }
 for(const [heading,items] of [['معلومات أو صور إضافية مطلوبة',assessment.missing_information],['خطوات أولية للفحص والمتابعة',assessment.initial_steps],['متى تحتاج إلى مختص؟',assessment.expert_review],['حدود هذه النتيجة',assessment.limitations]]){const section=listSection(heading,items);if(section)box.append(section);}
 $('resultNote').textContent='نتيجة أولية وليست تأكيدًا للإصابة أو سلامة النبات. '+result.note;report={...result,input:context};$('resultPanel').hidden=false;
}
async function analyze(event){
 event.preventDefault();if(busy||processing||$('analyzePlant').disabled||!$('plantHealthForm').reportValidity())return;
 const attempt=++generation;busy=true;controller=new AbortController();const active=controller,snapshotPhotos=photos.map(({mime_type,data,width,height})=>({mime_type,data,width,height}));
 const context={crop:$('crop').value.trim(),symptoms:$('symptoms').value.trim(),duration:$('duration').value.trim(),region:$('region').value.trim(),recent_care:$('recentCare').value.trim(),image_count:snapshotPhotos.length};
 report=null;$('resultPanel').hidden=true;say('جارٍ التحقق من الجلسة ثم فحص الصور. قد يستغرق ذلك بعض الوقت…','busy');updateControls();let timeout;
 try{
  const result=await withDeadline(client.auth.getSession());if(attempt!==generation)return;
  if(result.error)throw Error('تعذر التحقق من جلسة حسابك. أعد الاتصال ثم حاول مجددًا.');
  if(!result.data?.session?.access_token){session=null;lastUserId=null;resetCooldown();clearInputs('انتهت جلسة الحساب. سجّل الدخول قبل تجهيز فحص جديد.');accountMessage('انتهت جلسة الدخول. سجّل الدخول بالحساب الحالي.','anonymous',true);return;}
  if(result.data.session.user?.id!==session?.user?.id){clearInputs('تغيّر الحساب أثناء تجهيز الطلب. أعد الاتصال وأضف الصور مجددًا.');void syncAccount();return;}
  session=result.data.session;timeout=setTimeout(()=>active.abort(),55000);
  const response=await fetch(ENDPOINT,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'content-type':'application/json',Authorization:'Bearer '+session.access_token},signal:active.signal,body:JSON.stringify({consent:true,crop:context.crop,symptoms:context.symptoms,duration:context.duration,region:context.region,recent_care:context.recent_care,images:snapshotPhotos})});
  const raw=await response.text();if(attempt!==generation)return;if(raw.length>200000)throw Error('وصلت نتيجة أكبر من الحجم المقبول. أعد المحاولة لاحقًا.');let data;try{data=JSON.parse(raw);}catch{throw Error('لم تصل استجابة مكتملة من الخدمة. أعد المحاولة لاحقًا.');}
  if(!response.ok){
   if(response.status===401){session=null;lastUserId=null;resetCooldown();clearInputs('انتهت جلسة الحساب. سجّل الدخول قبل تجهيز فحص جديد.');accountMessage('انتهت جلسة الدخول. سجّل الدخول بالحساب الحالي.','anonymous',true);return;}
   if(response.status===429&&Number.isFinite(data?.retry_after_seconds)&&data.retry_after_seconds>0){cooldownUntil=Date.now()+Math.min(86400,data.retry_after_seconds)*1000;clearTimeout(cooldownTimer);cooldownTimer=setTimeout(updateControls,Math.min(86400,data.retry_after_seconds)*1000+30);}
   throw Error(typeof data?.message==='string'&&data.message.length<=1200?data.message:response.status===429?'بلغت الخدمة حد الاستخدام المجاني. أعد المحاولة لاحقًا.':'تعذر إكمال الفحص الآن. أعد المحاولة لاحقًا.');
  }
  let normalized;try{normalized=validResult(data);}catch{throw Error('لم تصل نتيجة مكتملة وصالحة للعرض. لم نعرض تشخيصًا بديلًا أو نصًا ناقصًا.');}
  renderResult(normalized,context);say(normalized.assessment.image_quality==='unusable'||!normalized.assessment.plant_visible?'اكتمل الفحص؛ لم تتوفر صورة كافية لاستنتاج سبب. راجع المطلوب في النتيجة.':'اكتمل الفحص الأولي. راجع الأسباب المحتملة وخطوات التحقق أدناه.');
 }catch(error){if(attempt===generation)say(error?.name==='AbortError'?'انتهت مهلة الفحص. يمكنك المحاولة لاحقًا؛ لم نعرض نتيجة غير مكتملة.':error?.message||'تعذر الفحص الآن. أعد المحاولة.','error');}
 finally{clearTimeout(timeout);if(attempt===generation){busy=false;controller=null;updateControls();}}
}
$('plantImages').addEventListener('change',()=>void addPhotos($('plantImages')));
$('plantCamera').addEventListener('change',()=>void addPhotos($('plantCamera')));
for(const id of ['crop','symptoms','duration','region','recentCare','shareConsent'])$(id).addEventListener('input',()=>{if(id!=='shareConsent')$('shareConsent').checked=false;invalidate('تغيّرت المعلومات. راجع المدخلات واطلب الفحص عند اكتمالها.');});
$('plantHealthForm').addEventListener('submit',event=>void analyze(event));
$('clearPlantForm').onclick=()=>clearInputs();
$('cancelPlantAnalysis').onclick=()=>{photoGeneration++;processing=false;invalidate('أُلغي الطلب من هذه الصفحة. لم تُعرض نتيجة؛ إذا بدأ الإرسال فقد تكون الصور وصلت إلى المزود.');};
$('retryAccount').onclick=()=>{if(!client&&accountState==='error'){location.reload();return;}void syncAccount();void availability();};
$('closePhotoDialog').onclick=closePreview;$('photoDialog').addEventListener('close',()=>{$('expandedPlantPhoto').removeAttribute('src');delete $('photoDialog').dataset.photoId;});
$('downloadPlantReport').onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'})),link=node('a');link.href=url;link.download='ur-plant-health-'+report.generated_at.slice(0,10)+'.json';link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('printPlantReport').onclick=()=>{if(report)window.print();};
window.addEventListener('pagehide',()=>{availabilityGeneration++;accountGeneration++;clearTimeout(cooldownTimer);clearPhotos();invalidate();});
window.addEventListener('pageshow',event=>{if(event.persisted){void syncAccount();void availability();}});
void syncAccount();void availability();
