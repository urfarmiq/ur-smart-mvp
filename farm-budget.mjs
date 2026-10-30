import {calculateSeasonBudget} from './season-economics.mjs';

const $=id=>document.getElementById(id),form=$('budgetForm'),rows=$('costRows');
const MAX_ROWS=50,DONUM_M2=2500,number=new Intl.NumberFormat('ar-IQ',{maximumFractionDigits:3});
const money=new Intl.NumberFormat('ar-IQ',{maximumFractionDigits:2});
const precise=new Intl.NumberFormat('ar-IQ',{maximumSignificantDigits:6});
let sequence=0,lastUnit='donum',snapshot=null,stale=false;
const controls=['downloadBudgetCsv','downloadBudgetJson','printBudget'];
function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;}
function say(text,error=false){$('formStatus').textContent=text;$('formStatus').className='status'+(error?' error':'');}
function syncExports(){for(const id of controls)$(id).disabled=!snapshot||stale;}
function markChanged(){if(snapshot){stale=true;$('staleNotice').hidden=false;syncExports();}for(const element of form.querySelectorAll('[aria-invalid=true]')){element.removeAttribute('aria-invalid');element.setCustomValidity('');}}
function normalizeNumber(value){
 let text=String(value).trim().replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776)).replaceAll('٫','.').replaceAll('٬',',');
 if(text.includes(',')){if(!/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text))return NaN;text=text.replaceAll(',','');}
 if(!/^\d+(?:\.\d+)?$/.test(text))return NaN;
 return Number(text);
}
function invalid(input,message){input.setAttribute('aria-invalid','true');input.setCustomValidity(message);throw Object.assign(Error(message),{field:input});}
function readNumber(input,{optional=false,positive=false,max=1e9}={}){
 if(!input.value.trim()){if(optional)return undefined;invalid(input,'أدخل قيمة رقمية لهذا الحقل.');}
 const value=normalizeNumber(input.value);
 if(!Number.isFinite(value)||value<0||positive&&value<=0||value>max)invalid(input,positive?'أدخل عددًا أكبر من صفر ضمن الحد المسموح.':'أدخل عددًا من صفر إلى '+number.format(max)+'. استخدم النقطة أو ٫ للفاصلة العشرية.');
 return value;
}
function field(label,input){const box=node('div',undefined,'field');const caption=node('label',label);caption.htmlFor=input.id;box.append(caption,input);return box;}
function addCost({focus=true}={}){
 if(rows.children.length>=MAX_ROWS)return;
 const id=++sequence,row=node('fieldset',undefined,'cost-row');row.dataset.costId=String(id);const legend=node('legend');row.append(legend);
 const grid=node('div',undefined,'cost-grid');
 for(const [key,label] of [['label','اسم المصروف'],['quantity','الكمية'],['unitCostIqd','سعر الوحدة (دينار عراقي)']]){
  const input=document.createElement('input');input.id='cost-'+id+'-'+key;input.dataset.field=key;input.type='text';input.required=true;
  if(key==='label'){input.maxLength=80;input.placeholder='مثال: بذور — كغم';}else input.inputMode='decimal';
  grid.append(field(label,input));
 }
 const basis=document.createElement('select');basis.id='cost-'+id+'-basis';basis.dataset.field='basis';basis.append(new Option('للمزرعة كلها','total'),new Option('لكل دونم عراقي','per_donum'));grid.append(field('احتساب الكمية',basis));
 const remove=node('button','حذف البند','remove-cost');remove.type='button';remove.addEventListener('click',()=>{const next=row.nextElementSibling||row.previousElementSibling;row.remove();if(!rows.children.length)addCost({focus:false});refreshRows();markChanged();(next?.querySelector('input')||rows.querySelector('input'))?.focus();});grid.append(remove);row.append(grid);rows.append(row);refreshRows();markChanged();if(focus)row.querySelector('input').focus();
}
function refreshRows(){[...rows.children].forEach((row,index)=>{row.querySelector('legend').textContent='البند '+number.format(index+1);row.querySelector('.remove-cost').setAttribute('aria-label','حذف بند المصروف '+number.format(index+1));});$('addCost').disabled=rows.children.length>=MAX_ROWS;$('costCount').textContent=number.format(rows.children.length)+' / '+number.format(MAX_ROWS)+' بندًا';}
function currentArea(){const raw=normalizeNumber($('areaValue').value);return Number.isFinite(raw)&&raw>0?raw/($('areaUnit').value==='m2'?DONUM_M2:1):null;}
function showEquivalent(){const area=currentArea();$('areaEquivalent').textContent=area!==null?($('areaUnit').value==='m2'?formatted(area)+' دونم عراقي':formatted(area*DONUM_M2)+' متر مربع'):'';}
function switchUnit(){const input=$('areaValue'),value=normalizeNumber(input.value),next=$('areaUnit').value;if(Number.isFinite(value)&&value>=0&&next!==lastUnit){input.value=String(next==='m2'?value*DONUM_M2:value/DONUM_M2);}lastUnit=next;markChanged();showEquivalent();}
function collectInput(){
 for(const element of form.querySelectorAll('input,select')){element.setCustomValidity('');element.removeAttribute('aria-invalid');}
 const areaRaw=readNumber($('areaValue'),{positive:true,max:$('areaUnit').value==='m2'?2.5e9:1e6}),areaDonum=areaRaw/($('areaUnit').value==='m2'?DONUM_M2:1);
 const costs=[...rows.children].map(row=>{const get=key=>row.querySelector('[data-field="'+key+'"]'),label=get('label').value.trim();if(!label||label.length>80)invalid(get('label'),'اكتب اسمًا للمصروف لا يتجاوز ٨٠ حرفًا.');return {label,quantity:readNumber(get('quantity')),unitCostIqd:readNumber(get('unitCostIqd')),basis:get('basis').value};});
 const input={areaDonum,costs};
 for(const [id,key] of [['yieldKgPerDonum','yieldKgPerDonum'],['salePriceIqdPerKg','salePriceIqdPerKg']]){const value=readNumber($(id),{optional:true});if(value!==undefined)input[key]=value;}
 return input;
}
function formatted(value,financial=false){if(value===null||value===undefined||typeof value!=='number'||!Number.isFinite(value))return 'غير متاح';return value!==0&&Math.abs(value)<(financial?.01:.001)?precise.format(value):(financial?money:number).format(value);}
function assumption(label,value){const item=node('div');item.append(node('dt',label),node('dd',value));return item;}
function renderResult(result,input){
 const metrics={totalCost:['total_cost_iqd',true],costPerDonum:['cost_per_donum_iqd',true],expectedProduction:['expected_production_kg',false],expectedRevenue:['expected_revenue_iqd',true],expectedMargin:['expected_margin_iqd',true],breakEvenPrice:['break_even_price_iqd_per_kg',false],breakEvenYield:['break_even_yield_kg_per_donum',false]};
 for(const [id,[key,financial]] of Object.entries(metrics))$(id).textContent=formatted(result[key],financial);
 $('expectedMargin').dataset.sign=Number.isFinite(result.expected_margin_iqd)&&result.expected_margin_iqd<0?'negative':'nonnegative';
 $('assumptions').replaceChildren(assumption('مساحة الموسم',formatted(result.area_donum)+' دونم عراقي'),assumption('الإنتاج المفترض لكل دونم',input.yieldKgPerDonum===undefined?'غير متاح':formatted(input.yieldKgPerDonum)+' كغم'),assumption('سعر البيع المفترض لكل كغم',input.salePriceIqdPerKg===undefined?'غير متاح':formatted(input.salePriceIqdPerKg)+' دينار عراقي'));
 const body=$('costBreakdown').querySelector('tbody');body.replaceChildren();for(const cost of result.costs){const row=node('tr');for(const value of [cost.label,formatted(cost.quantity),formatted(cost.unit_cost_iqd),cost.basis==='per_donum'?'لكل دونم عراقي':'للمزرعة كلها',formatted(cost.total_iqd,true)])row.append(node('td',value));body.append(row);}
 $('budgetWarnings').replaceChildren();for(const text of result.warnings||[])$('budgetWarnings').append(node('li',String(text)));
 $('calculatedAt').textContent='حُسبت في '+new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'}).format(new Date(snapshot.created_at))+' — توقيت بغداد';
 $('resultSection').hidden=false;$('staleNotice').hidden=true;stale=false;syncExports();$('resultTitle').focus({preventScroll:true});$('resultSection').scrollIntoView({behavior:'auto',block:'start'});
}
function calculate(event){event.preventDefault();try{const input=collectInput(),result=calculateSeasonBudget(input);snapshot={schema_version:1,created_at:new Date().toISOString(),input,result};renderResult(result,input);say('حُسبت الميزانية من مدخلاتك. راجع الافتراضات والمصروفات، ثم نزّل نسخة إذا أردت الاحتفاظ بها.');}catch(error){if(snapshot){stale=true;$('staleNotice').hidden=false;syncExports();}say(error.message||'تعذر الحساب. راجع المدخلات ثم أعد المحاولة.',true);if(error.field){error.field.focus();error.field.reportValidity();}}}
function safeCell(value){if(value===null||value===undefined)return '""';let text=String(value);if(typeof value==='string'&&/^[\s\uFEFF]*[=+\-@]/u.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
function download(blob,filename){const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function csvRows(){const {input,result}=snapshot,rows=[['القسم','البند','الكمية','سعر الوحدة (د.ع)','طريقة الحساب','القيمة','الوحدة'],['الافتراضات','المساحة','','','',result.area_donum,'دونم عراقي'],['الافتراضات','الإنتاج المتوقع لكل دونم','','','',input.yieldKgPerDonum??null,'كغم / دونم'],['الافتراضات','سعر البيع المتوقع لكل كغم','','','',input.salePriceIqdPerKg??null,'دينار / كغم']];for(const cost of result.costs)rows.push(['التكاليف',cost.label,cost.quantity,cost.unit_cost_iqd,cost.basis==='per_donum'?'لكل دونم عراقي':'للمزرعة كلها',cost.total_iqd,'دينار عراقي']);for(const [name,key,unit] of [['إجمالي التكاليف','total_cost_iqd','دينار عراقي'],['تكلفة الدونم','cost_per_donum_iqd','دينار / دونم'],['الإنتاج المتوقع','expected_production_kg','كغم'],['الإيراد المتوقع','expected_revenue_iqd','دينار عراقي'],['الفرق المتوقع','expected_margin_iqd','دينار عراقي'],['سعر التعادل','break_even_price_iqd_per_kg','دينار / كغم'],['إنتاج التعادل','break_even_yield_kg_per_donum','كغم / دونم']])rows.push(['الملخص',name,'','','',result[key],unit]);return rows;}
function clearAll(){form.reset();rows.replaceChildren();snapshot=null;stale=false;sequence=0;lastUnit='donum';$('resultSection').hidden=true;$('staleNotice').hidden=true;$('costBreakdown').querySelector('tbody').replaceChildren();$('assumptions').replaceChildren();$('budgetWarnings').replaceChildren();for(const id of ['totalCost','costPerDonum','expectedProduction','expectedRevenue','expectedMargin','breakEvenPrice','breakEvenYield'])$(id).textContent='غير متاح';for(const input of form.querySelectorAll('input')){input.setCustomValidity('');input.removeAttribute('aria-invalid');}addCost({focus:false});showEquivalent();syncExports();say('مُسحت جميع المدخلات والنتائج من الصفحة.');$('areaValue').focus();}
form.addEventListener('submit',calculate);form.addEventListener('input',()=>{markChanged();showEquivalent();});form.addEventListener('change',event=>{if(event.target!==$('areaUnit'))markChanged();});$('areaUnit').addEventListener('change',switchUnit);$('addCost').addEventListener('click',()=>addCost());$('clearBudget').addEventListener('click',clearAll);
$('downloadBudgetJson').addEventListener('click',()=>{if(snapshot&&!stale)download(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json;charset=utf-8'}),'ur-season-budget-'+snapshot.created_at.slice(0,10)+'.json');});
$('downloadBudgetCsv').addEventListener('click',()=>{if(snapshot&&!stale)download(new Blob(['\uFEFF'+csvRows().map(row=>row.map(safeCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'ur-season-budget-'+snapshot.created_at.slice(0,10)+'.csv');});
$('printBudget').addEventListener('click',()=>{if(snapshot&&!stale)window.print();});
addCost({focus:false});$('calculateBudget').disabled=false;$('clearBudget').disabled=false;say('أدخل المساحة وبنود المصروفات، ثم اضغط «احسب ميزانية الموسم». استخدم النقطة أو ٫ للفاصلة العشرية.');
