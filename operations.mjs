import {validateEntry,validateBackup,localKey} from './operations-core.mjs';
const $=id=>document.getElementById(id),say=t=>$('status').textContent=t;
let client,user,fields=[],entries=[],generation=0,storageOK=false;
const selected=()=>fields.find(f=>f.id===$('field').value);
const key=()=>localKey(user?.id,selected()?.id);
const dateText=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ar-IQ'):'تاريخ غير متاح';};
function render(){
 const box=$('operations');box.replaceChildren();const query=$('filter').value.trim();
 const rows=entries.filter(e=>(e.type+' '+e.notes+' '+e.date).includes(query)).sort((a,b)=>b.date.localeCompare(a.date));
 if(!rows.length)box.textContent='لا توجد عمليات تطابق العرض الحالي.';
 rows.forEach(e=>{const div=document.createElement('article');div.className='entry';const h=document.createElement('strong'),p=document.createElement('p');h.textContent=e.date+' — '+e.type;p.textContent=e.notes;div.append(h,p);box.append(div);});
 $('summary').textContent=selected()?`${selected().name} | ${selected().area_donum??'—'} دونم عراقي | ${entries.length} عملية محلية`:'';
}
function save(next){if(!storageOK)throw Error('تعذر فتح التخزين المحلي؛ صدّر البيانات أو تحقق من إعدادات المتصفح');localStorage.setItem(key(),JSON.stringify({version:1,field_id:selected().id,operations:next}));entries=next;render();}
function loadLocal(){
 entries=[];storageOK=false;
 try{const raw=localStorage.getItem(key());entries=raw?validateBackup(JSON.parse(raw),selected().id):[];storageOK=true;}
 catch(e){say('تعذر قراءة السجل المحلي: '+e.message+' — لم تُحذف البيانات القديمة.');}
 $('save').disabled=!storageOK;$('export').disabled=!storageOK;$('restore').disabled=!storageOK;render();
}
async function loadCloud(){
 const f=selected(),token=++generation;if(!f)return;
 $('readings').textContent='جارٍ تحميل القراءات…';$('irrigation').textContent='جارٍ تحميل سجل الري…';
 const results=await Promise.allSettled([
 client.from('sensor_readings').select('soil_moisture,air_temperature,irrigation_state,is_simulated,recorded_at').eq('field_id',f.id).order('recorded_at',{ascending:false}).limit(20),
 client.from('field_irrigation_logs').select('irrigated_at,water_depth_mm,duration_minutes,method,notes').eq('field_id',f.id).eq('owner_id',user.id).order('irrigated_at',{ascending:false}).limit(20)
 ]);
 if(token!==generation||selected()?.id!==f.id)return;
 results.forEach((r,i)=>{const box=$(i?'irrigation':'readings');box.replaceChildren();if(r.status==='rejected'||r.value.error){box.textContent='تعذر التحميل: '+(r.reason?.message||r.value?.error?.message||'خطأ اتصال');return;}const rows=r.value.data||[];if(!rows.length){box.textContent=i?'لا توجد ريات مسجلة لهذا الحقل.':'لا توجد قراءات مستشعرات محفوظة لهذا الحقل.';return;}
 rows.forEach(row=>{const p=document.createElement('p');p.className='entry';p.textContent=i?`${dateText(row.irrigated_at)} — ${row.method} | عمق: ${row.water_depth_mm??'غير مسجل'} ملم | مدة: ${row.duration_minutes??'غير مسجلة'} دقيقة${row.notes?' — '+row.notes:''}`:`${row.is_simulated?'قراءة افتراضية':'قراءة جهاز مسجلة'} — ${dateText(row.recorded_at)} | رطوبة التربة: ${row.soil_moisture??'—'}% | حرارة الهواء: ${row.air_temperature??'—'} °م | الري: ${{on:'يعمل',off:'متوقف',unknown:'غير معروف'}[row.irrigation_state]||'غير معروف'}`;box.append(p);});});
}
$('field').onchange=()=>{generation++;const enabled=!!selected();['refresh','simulate'].forEach(id=>$(id).disabled=!enabled);$('simulation').textContent='لم تبدأ المحاكاة.';if(!enabled){entries=[];storageOK=false;['save','export','restore'].forEach(id=>$(id).disabled=true);$('readings').textContent=$('irrigation').textContent='اختر حقلًا.';render();return;}say('تم اختيار الحقل. العمليات محلية والقراءات المحفوظة تُقرأ من السحابة.');loadLocal();loadCloud().catch(e=>say(e.message));};
$('operationForm').onsubmit=e=>{e.preventDefault();try{if(!selected())throw Error('اختر حقلًا');if(entries.length>=5000)throw Error('بلغ السجل الحد الأقصى (5000 عملية)');const item=validateEntry({date:$('date').value,type:$('type').value,notes:$('notes').value});save([...entries,item]);$('notes').value='';say('حُفظت العملية محليًا على هذا المتصفح.');}catch(err){say('لم يتم الحفظ: '+err.message);}};
$('filter').oninput=render;
$('refresh').onclick=()=>loadCloud().catch(e=>say(e.message));
$('print').onclick=()=>window.print();
$('simulate').onclick=()=>{if(!selected())return;$('simulation').textContent=`محاكاة تعليمية — ${dateText(new Date())}: رطوبة ${(15+Math.random()*25).toFixed(1)}%، حرارة ${(20+Math.random()*15).toFixed(1)} °م. لم تُحفظ في Supabase ولا تتحكم في جهاز.`;};
$('export').onclick=()=>{try{const f=selected();if(!f)throw Error('اختر حقلًا');const blob=new Blob([JSON.stringify({version:1,field_id:f.id,operations:entries},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`ur-smart-operations-${f.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){say(e.message);}};
$('restore').onchange=async()=>{const f=selected();try{const file=$('restore').files[0];if(!file||!f)return;if(file.size>2000000)throw Error('حجم النسخة أكبر من 2MB');const next=validateBackup(JSON.parse(await file.text()),f.id);if(selected()?.id!==f.id)throw Error('تغير الحقل؛ أعد اختيار الملف');if(!confirm('ستستبدل النسخة السجل المحلي للحقل. صدّر السجل الحالي أولًا إن كنت تحتاجه. متابعة؟'))return;save(next);say('تمت استعادة السجل محليًا.');}catch(e){say('تعذرت الاستعادة: '+e.message);}finally{$('restore').value='';}};
const now=new Date();$('date').value=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);
try{
 const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');
 client=createClient('https://ynsmhtsktbubxfhsekjq.supabase.co','sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc');
 const auth=await client.auth.getUser();if(auth.error||!auth.data.user)throw Error('سجّل الدخول من لوحة المزارع أولًا.');user=auth.data.user;
 const result=await client.from('fields').select('id,name,area_donum,farms!inner(owner_id)').eq('farms.owner_id',user.id).order('name');if(result.error)throw result.error;fields=result.data||[];fields.forEach(f=>$('field').add(new Option(f.name,f.id)));$('field').disabled=false;say(fields.length?'اختر حقلًا لعرض سجله.':'لا توجد حقول. أضف أول حقل من لوحة المزارع.');
 client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')location.replace('./auth.html');});
}catch(e){say('تعذر تحميل الحساب أو الحقول: '+e.message);}
