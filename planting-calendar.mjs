import {MONTHS,PROVINCES,getIraqMonth,getPlantingMatches,groupByCrop,getYearAvailability,provinceLookup,formatMonth,validateCalendarData} from './planting-calendar-core.mjs';
import {REVIEWED_AT,SOURCES,PLANTING_WINDOWS} from './planting-calendar-data.mjs';

const $=id=>document.getElementById(id);
const CATEGORIES={field:'محاصيل حقلية',vegetable:'خضروات',herb:'أعشاب'};
const SEASONS={winter:'شتوي',spring:'ربيعي',summer:'صيفي',autumn:'خريفي'};
const METHODS={open:'زراعة مكشوفة',protected:'زراعة محمية',nursery:'مشتل',unspecified:'نوع التغطية غير محدد في المرجع'};
const OPERATIONS={sow:'بذر',transplant:'نقل شتلات',nursery_sow:'بذر في المشتل',plant:'زراعة حسب المرجع'};
const ZONES={north:'شمال العراق',center:'وسط العراق',south:'جنوب العراق'};
const MARKS={field:'🌾',vegetable:'🌱',herb:'🌿'};
const sources=new Map(SOURCES.map(source=>[source.id,source]));
const fields=['month','province','category','method','season','cropSearch'];
let ready=false;
const number=value=>new Intl.NumberFormat('ar-IQ').format(value);
function node(tag,text,className){const value=document.createElement(tag);if(text!==undefined)value.textContent=String(text);if(className)value.className=className;return value;}
function filters(){return {month:Number($('month').value),province:$('province').value,category:$('category').value,method:$('method').value,season:$('season').value,query:$('cropSearch').value.trim()};}
function sourceLink(source){const link=node('a',source.title);link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';return link;}
function applicability(window,province){
 if(window.applicability==='general_reference')return province==='all'?'موعد مرجعي عام؛ المنطقة غير محددة':'موعد مرجعي عام، غير مخصص لهذه المحافظة';
 if(window.applicability==='national')return 'تقويم عام للعراق';
 if(window.provinceCodes?.length)return 'مرجع لمواقع محددة: '+window.provinceCodes.map(code=>provinceLookup(code)?.name||code).join('، ');
 return 'مرجع لمنطقة: '+window.zones.map(zone=>ZONES[zone]||zone).join('، ');
}
function renderWindow(window,province){
 const section=node('section',undefined,'cal-window');section.dataset.windowId=window.id;
 const badges=node('div',undefined,'cal-badges');badges.append(node('span',OPERATIONS[window.operation],'cal-badge'),node('span',METHODS[window.method],'cal-badge cal-badge-method'),node('span',SEASONS[window.season],'cal-badge'));
 const scope=node('span',applicability(window,province),'cal-badge'+(window.applicability==='general_reference'?' cal-badge-reference':''));scope.dataset.applicability=window.applicability;badges.append(scope);section.append(badges);
 const period=node('h4');period.append(node('span','نافذة الموعد في المرجع'),document.createTextNode(window.periodLabel));section.append(period);
 if(window.notes?.length){const notes=node('ul');for(const note of window.notes)notes.append(node('li',note));section.append(notes);}
 const detail=node('details',undefined,'cal-window-sources');detail.append(node('summary','مصدر هذه النافذة'));
 for(const id of window.sourceIds){const source=sources.get(id);if(source)detail.append(sourceLink(source));}section.append(detail);return section;
}
function renderCrops(groups,province){
 const result=$('cropResults');result.replaceChildren();
 for(const group of groups){const card=node('article',undefined,'cal-crop-card');card.dataset.cropId=group.cropId;
  const head=node('header',undefined,'cal-crop-header'),label=node('div');label.append(node('div',CATEGORIES[group.category],'cal-crop-category'),node('h3',group.cropName,'cal-crop-name'));const mark=node('span',MARKS[group.category]||'🌱','cal-crop-mark');mark.setAttribute('aria-hidden','true');head.append(label,mark);card.append(head);
  for(const window of group.windows)card.append(renderWindow(window,province));result.append(card);
 }
 $('emptyResults').hidden=groups.length!==0;
}
function renderYear(current){
 const box=$('yearMonths');box.replaceChildren();
 for(const entry of getYearAvailability(PLANTING_WINDOWS,current)){
  const button=node('button',entry.label,'cal-year-button');button.type='button';button.dataset.month=String(entry.month);button.setAttribute('aria-pressed',String(entry.month===current.month));button.setAttribute('aria-label',entry.label+'، '+number(entry.count)+' محاصيل لها نوافذ');button.append(node('span',number(entry.count)+' محاصيل'));
  button.addEventListener('click',()=>{$('month').value=String(entry.month);render();});box.append(button);
 }
}
function render(){
 if(!ready)return;try{
  const current=filters(),matches=getPlantingMatches(PLANTING_WINDOWS,current),groups=groupByCrop(matches),province=provinceLookup(current.province);
  $('heroMonth').textContent=formatMonth(current.month);$('heroProvince').textContent=province.name;
  $('resultsTitle').textContent='نوافذ '+formatMonth(current.month)+(current.province==='all'?' في المراجع':' · '+province.name);
  $('resultStatus').textContent=number(groups.length)+' محاصيل · '+number(matches.length)+' نوافذ زراعة';
  $('provinceNote').textContent=current.province==='all'?'اختر محافظة لتصفية المواعيد ذات المنطقة المحددة. تبقى المواعيد غير المحددة جغرافيًا موسومة كمرجع عام.':province.name+' ضمن المنطقة المرجعية '+(ZONES[province.zone]||'العراقية')+'؛ قد يختلف المناخ والارتفاع داخل المحافظة. المواعيد العامة ليست تأكيدًا محليًا.';
  $('resultScope').textContent='هذه نوافذ تتقاطع مع الشهر المختار، وقد تنتهي في منتصفه أو تبدأ في آخره. اقرأ الفترة والعملية والمصدر لكل خيار؛ ليست قائمة ملاءمة مؤكدة للزراعة اليوم.';
  renderCrops(groups,current.province);renderYear(current);$('loadStatus').textContent='';$('loadStatus').classList.remove('cal-error');
 }catch{ $('loadStatus').textContent='تعذر عرض هذا الاختيار. أعد المرشّحات ثم حاول مجددًا.';$('loadStatus').classList.add('cal-error');$('resultStatus').textContent='تعذر عرض الاختيار';$('resultScope').textContent='أعد المرشّحات لعرض النوافذ المرجعية من جديد.';$('cropResults').replaceChildren();$('yearMonths').replaceChildren();$('emptyResults').hidden=true; }
}
function reset(){
 $('calendarFilters').reset();$('month').value=String(getIraqMonth());$('province').value='all';$('category').value='all';$('method').value='all';$('season').value='all';$('cropSearch').value='';render();
}
function renderSources(){
 const box=$('sourceList');box.replaceChildren();for(const source of SOURCES){const section=node('article',undefined,'cal-source');section.dataset.sourceId=source.id;section.append(node('h3',source.publisher||source.title),sourceLink(source));if(source.locator)section.append(node('p','موضع الاستدلال: '+source.locator));if(source.published)section.append(node('p','تاريخ المرجع: '+source.published));if(source.scopeNote)section.append(node('p',source.scopeNote));box.append(section);}
 const reviewed=new Date(REVIEWED_AT+'T12:00:00Z');$('reviewedAt').textContent='مراجعة تجميع المواعيد: '+new Intl.DateTimeFormat('ar-IQ',{dateStyle:'long',timeZone:'Asia/Baghdad'}).format(reviewed)+'؛ هذا تاريخ مراجعة الخدمة، وليس تاريخًا جديدًا لكل مرجع.';
}
try{
 validateCalendarData(PLANTING_WINDOWS,SOURCES);
 for(const month of MONTHS)$('month').add(new Option(month.label,String(month.value)));
 for(const province of PROVINCES)$('province').add(new Option(province.name,province.code));
 renderSources();ready=true;$('filterFields').disabled=false;$('resetFilters').disabled=false;reset();
 for(const id of fields)$(id).addEventListener(id==='cropSearch'?'input':'change',render);
 $('calendarFilters').addEventListener('submit',event=>event.preventDefault());$('resetFilters').addEventListener('click',reset);
 $('clearSearch').addEventListener('click',()=>{$('cropSearch').value='';$('category').value='all';$('method').value='all';$('season').value='all';render();});
}catch{ready=false;$('filterFields').disabled=true;$('loadStatus').textContent='تعذر تجهيز المواعيد المرجعية الآن. أعد فتح الصفحة، ويمكنك مراجعة الأدلة الزراعية أو الإرشاد المحلي في هذه الأثناء.';$('loadStatus').classList.add('cal-error');}
