import {createClient} from './supabase-client.mjs';
import {validateTerrainPolygon,sampleTerrainProfile} from './terrain-core.mjs';

const $=id=>document.getElementById(id);
const SUPABASE_URL='https://ynsmhtsktbubxfhsekjq.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc';
const TERRAIN_API='https://ur-smart-satellite.alialbatekh111.workers.dev/terrain';
const client=createClient(SUPABASE_URL,PUBLISHABLE_KEY);
const fmt=(value,unit='',digits=1)=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('ar-IQ',{maximumFractionDigits:digits}).format(value)+(unit?' '+unit:''):'غير متاح';
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;};
const toLL=point=>[point[1],point[0]];
const layers={};
let map=null,base=null,satellite=null,user=null,fields=[],farms=[],selectedField=null,polygon=null,boundaryLayer=null,pointLayer=null,profileLayer=null,points=[],profilePoints=[],mode=null,dirty=false,busy=false,analysis=null,currentReport=null,generation=0,controller=null,bootGeneration=0,authId=null;
const timeout=(promise,ms=20000)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('انتهت مهلة الاتصال. أعد المحاولة.')),ms);})]).finally(()=>clearTimeout(timer));};
const setStatus=(text,kind='')=>{$('terrainStatus').textContent=text;$('terrainStatus').className='terrain-status'+(kind?' '+kind:'');};
function timeLabel(value){const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'}).format(d):'تاريخ غير متاح';}
function invalidate(){generation++;controller?.abort();controller=null;}
function clearProfile(){profilePoints=[];if(profileLayer)map?.removeLayer(profileLayer);profileLayer=null;$('profileFigure').hidden=true;$('profileTableDetails').hidden=true;$('terrainProfileChart').replaceChildren();$('terrainProfileTable').replaceChildren();$('terrainProfileStatus').textContent='حلّل الحقل أولًا، ثم ارسم خطًا داخل حدوده لعرض تغير الارتفاع على امتداده.';$('finishTerrainProfile').disabled=true;}
function clearResult(){analysis=null;currentReport=null;$('terrainReport').hidden=true;clearProfile();for(const name of Object.keys(layers)){map?.removeLayer(layers[name]);delete layers[name];}$('terrainLegend').replaceChildren();$('terrainLegend').hidden=true;$('terrainPixel').textContent='بعد التحليل: حرّك المؤشر أو المس الحقل لقراءة الارتفاع والانحدار.';syncControls();}
function syncControls(){
 if(map?.doubleClickZoom)map.doubleClickZoom[mode?'disable':'enable']();
 const hasBoundary=!!polygon,hasUser=!!user,ready=hasBoundary&&hasUser&&!!selectedField&&!dirty&&!busy;
 $('analyzeTerrain').disabled=!ready;$('saveTerrainField').disabled=!hasBoundary||!hasUser||busy||(!dirty&&!!selectedField);
 $('terrainField').disabled=!hasUser||busy;$('newTerrainField').disabled=busy;$('terrainFieldName').disabled=busy;$('terrainFieldCrop').disabled=busy;
 $('analysisProgress').hidden=!busy;$('analysisProgress').setAttribute('aria-busy',String(busy));$('analyzeTerrain').textContent=busy?'جارٍ تحليل التضاريس…':'تحليل تضاريس الحقل';
 $('refreshTerrainHistory').disabled=!hasUser||!selectedField||busy;
 for(const name of ['Elevation','Slope','Flow','Low','Drains'])$('layer'+name).disabled=!analysis||busy;
 $('drawTerrainProfile').disabled=!analysis||busy||mode==='boundary';$('finishTerrainProfile').disabled=!analysis||mode!=='profile'||profilePoints.length<2||busy;
 for(const id of ['drawTerrainBoundary','undoTerrainPoint','terrainLocate'])$(id).disabled=busy;
 $('finishTerrainDrawing').disabled=busy||mode!=='boundary'||points.length<3;
 $('drawTerrainBoundary').classList.toggle('active',mode==='boundary');$('drawTerrainProfile').classList.toggle('active',mode==='profile');
}
function updateArea(){try{const info=validateTerrainPolygon(polygon);$('terrainArea').textContent=fmt(info.area_dunam,'دونم',3);}catch{$('terrainArea').textContent='—';}}
function drawBoundary(){
 if(boundaryLayer)map.removeLayer(boundaryLayer);boundaryLayer=null;pointLayer?.clearLayers();
 if(mode==='boundary'){
  if(points.length>1)boundaryLayer=(points.length>2?L.polygon(points.map(toLL),{color:'#156e49',weight:3,fillOpacity:.08}):L.polyline(points.map(toLL),{color:'#156e49',weight:3})).addTo(map);
  points.forEach((point,i)=>{const marker=L.marker(toLL(point),{draggable:true,icon:L.divIcon({className:'drawing-marker',iconSize:[12,12],iconAnchor:[6,6]}),title:'اسحب نقطة الحد لتعديلها'}).addTo(pointLayer);marker.on('dragend',()=>{const p=marker.getLatLng();points[i]=[p.lng,p.lat];rebuildDraft();});});
 }else if(polygon)boundaryLayer=L.geoJSON(polygon,{style:{color:'#174f38',weight:3,fillOpacity:0}}).addTo(map);
}
function rebuildDraft(){
 polygon=points.length>=3?{type:'Polygon',coordinates:[[...points,points[0]]]}:null;dirty=true;drawBoundary();updateArea();$('boundaryState').textContent='حدود مرسومة لم تُحفظ بعد.';$('mapHelp').textContent='أضف زوايا الحقل، واسحب النقاط لتعديلها. اضغط «إنهاء الرسم» عند اكتمال الحدود.';syncControls();
}
function fitField(){if(boundaryLayer?.getBounds()?.isValid())map.fitBounds(boundaryLayer.getBounds(),{padding:[35,35],maxZoom:18});}
function startBoundary(){
 invalidate();clearResult();mode='boundary';points=polygon?.coordinates?.[0]?.slice(0,-1).map(p=>[...p])||[];
 if(polygon?.coordinates?.length>1){mode=null;setStatus('هذا الحقل يحتوي مناطق مستثناة من الحدود. للحفاظ عليها، عدّلها من أداة الخرائط أو ارسم حقلًا جديدًا مستقلًا.','error');syncControls();return;}
 dirty=true;drawBoundary();$('boundaryState').textContent='أي تعديل يحتاج حفظ الحدود قبل التحليل.';$('mapHelp').textContent='المس أو انقر زوايا الحقل، ثم اضغط «إنهاء الرسم». يمكن سحب النقاط لتصحيحها.';setStatus('وضع رسم الحدود مفعّل. أضف ثلاث نقاط على الأقل ثم أنهِ الرسم.');syncControls();
}
function finishBoundary(){try{const info=validateTerrainPolygon(polygon);polygon=info.polygon;mode=null;pointLayer.clearLayers();drawBoundary();updateArea();$('mapHelp').textContent='اكتملت الحدود. احفظها في حسابك لتفعيل زر التحليل.';setStatus('الحدود صالحة. احفظ الحقل وحدوده في حسابك قبل التحليل.');syncControls();}catch(e){setStatus('تعذر اعتماد الحدود: '+(e.message||'راجع نقاط الرسم.'),'error');}}
function newField(){invalidate();mode=null;selectedField=null;polygon=null;points=[];dirty=false;clearResult();$('terrainField').value='';$('newFieldDetails').hidden=false;$('terrainFieldName').value='';$('terrainFieldCrop').value='';$('terrainHistory').textContent='احفظ الحقل الجديد أولًا لربط التقارير به.';drawBoundary();updateArea();startBoundary();}
async function terrainPost(body,signal){
 const sessionResult=await timeout(client.auth.getSession());const session=sessionResult.data?.session;
 if(sessionResult.error||!session||session.user.id!==user?.id)throw Error('انتهت جلسة الحساب. سجّل الدخول مرة أخرى.');
 const response=await fetch(TERRAIN_API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},body:JSON.stringify(body),signal});
 let data;try{data=await response.json();}catch{throw Error('استجابة غير مكتملة من خدمة التضاريس. أعد المحاولة.');}
 if(!response.ok){if(response.status===429)throw Error(data.message||'طلبات متقاربة أو حد حفظ التقارير. انتظر ٣٠ ثانية، وإذا بلغ السجل حده نزّل التقارير المطلوبة ثم احذف تقريرًا بنفسك.');throw Error(data.message||data.error||'تعذر إكمال تحليل التضاريس الآن.');}
 return data;
}
async function selectField(id){
 invalidate();const token=generation;mode=null;polygon=null;points=[];dirty=false;selectedField=fields.find(f=>f.id===id)||null;clearResult();drawBoundary();updateArea();$('newFieldDetails').hidden=!!selectedField;$('boundaryState').textContent='جارٍ تحميل حدود الحقل…';$('terrainHistory').textContent='جارٍ تحميل التقارير…';
 if(!selectedField){$('boundaryState').textContent='اختر حقلًا أو ارسم حقلًا جديدًا.';$('terrainHistory').textContent='اختر حقلًا محفوظًا لعرض تقاريره.';syncControls();return;}
 setStatus('جارٍ فتح حدود '+selectedField.name+' من حسابك…');syncControls();
 try{
  const {data,error}=await timeout(client.from('field_boundaries').select('geometry').eq('field_id',id).maybeSingle());if(token!==generation)return;if(error)throw Error('تعذر قراءة حدود الحقل. تحقق من اتصالك وأعد الاختيار.');
  if(!data){$('boundaryState').textContent='لا توجد حدود محفوظة لهذا الحقل. ارسم حدوده ثم احفظها.';setStatus('الحقل موجود في حسابك، ويحتاج حدودًا على الخريطة قبل التحليل.');return;}
  const value=typeof data.geometry==='string'?JSON.parse(data.geometry):data.geometry;polygon=validateTerrainPolygon(value).polygon;drawBoundary();updateArea();fitField();$('boundaryState').textContent='الحدود محفوظة في حسابك وجاهزة للتحليل.';setStatus('تم فتح الحقل. اضغط «تحليل تضاريس الحقل» لجلب البيانات الحقيقية.');
 }catch(e){if(token===generation){polygon=null;setStatus(e.message||'تعذر فتح الحدود.','error');$('boundaryState').textContent='لم تُحمّل حدود صالحة.';}}
 finally{if(token===generation){syncControls();void loadHistory();}}
}
async function saveField(){
 if(!user||!polygon||busy)return;let info;try{info=validateTerrainPolygon(polygon);}catch(e){setStatus('الحدود غير صالحة: '+e.message,'error');return;}
 const name=$('terrainFieldName').value.trim();if(!selectedField&&!name){setStatus('اكتب اسم الحقل الجديد قبل حفظه.','error');$('terrainFieldName').focus();return;}
 const token=generation,ownerId=user.id;busy=true;syncControls();$('analysisProgress').hidden=true;setStatus('جارٍ حفظ الحقل وحدوده في حسابك…');
 try{
  let field=selectedField;
  if(!field){
   let farm=farms[0];if(!farm){const r=await timeout(client.from('farms').insert({name:'مزرعتي',owner_id:ownerId}).select('id,name').single());if(token!==generation||user?.id!==ownerId)return;if(r.error)throw Error('تعذر إنشاء المزرعة في حسابك.');farm=r.data;farms=[farm];}
   if(token!==generation||user?.id!==ownerId)return;
   const {data,error}=await timeout(client.from('fields').insert({name,crop:$('terrainFieldCrop').value.trim()||null,area_donum:info.area_dunam,farm_id:farm.id}).select('id,name,crop,farm_id').single());if(token!==generation||user?.id!==ownerId)return;if(error)throw Error('تعذر حفظ الحقل الجديد. أعد المحاولة.');field=data;fields.push(field);selectedField=field;renderFieldOptions();$('terrainField').value=field.id;
  }
  if(token!==generation||user?.id!==ownerId)return;
  const ring=info.polygon.coordinates[0];let perimeter=0;for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i],lat=(a[1]+b[1])/2*Math.PI/180;perimeter+=Math.hypot((b[0]-a[0])*111195*Math.cos(lat),(b[1]-a[1])*111195);}
  const result=await timeout(client.from('field_boundaries').upsert({field_id:field.id,owner_id:ownerId,geometry:info.polygon,area_m2:info.area_m2,perimeter_m:perimeter,updated_at:new Date().toISOString()},{onConflict:'field_id'}));
  if(result.error)throw Error('حُفظ الحقل، لكن تعذر حفظ حدوده. اضغط حفظ الحدود مجددًا؛ لم يبدأ أي تحليل.');
  if(token!==generation||user?.id!==ownerId)return;
  polygon=info.polygon;dirty=false;mode=null;pointLayer.clearLayers();drawBoundary();$('newFieldDetails').hidden=true;$('boundaryState').textContent='تم حفظ الحقل وحدوده في حسابك.';setStatus('تم الحفظ. يمكنك الآن تحليل التضاريس ببيانات حقيقية.','success');void loadHistory();
 }catch(e){if(token===generation)setStatus(e.message||'تعذر حفظ الحقل وحدوده.','error');}
 finally{if(token===generation){busy=false;syncControls();}}
}
function colorAt(t,stops){const u=Math.max(0,Math.min(1,t))*(stops.length-1),i=Math.min(stops.length-2,Math.floor(u)),p=u-i;return stops[i].map((value,k)=>Math.round(value+(stops[i+1][k]-value)*p));}
const ELEVATION_COLORS=[[55,113,90],[145,174,110],[231,200,139],[163,107,68],[103,70,61]],SLOPE_COLORS=[[245,234,182],[241,184,88],[211,112,51],[133,57,38]];
function rasterOverlay(values,kind){
 const raster=analysis.raster,canvas=document.createElement('canvas');canvas.width=raster.width;canvas.height=raster.height;const ctx=canvas.getContext('2d'),image=ctx.createImageData(raster.width,raster.height);
 const valid=values.filter(v=>typeof v==='number'&&Number.isFinite(v)),min=kind==='elevation'?Math.min(...valid):0,max=kind==='elevation'?Math.max(...valid):Math.max(1,...valid),span=max-min||1;
 for(let i=0;i<values.length;i++){const value=values[i];if(!raster.field_mask[i]||value===null||value===undefined||kind==='low'&&!value)continue;let c;if(kind==='low')c=[45,139,195];else if(typeof value==='number'&&Number.isFinite(value))c=colorAt((value-min)/span,kind==='elevation'?ELEVATION_COLORS:SLOPE_COLORS);else continue;image.data.set([...c,kind==='low'?190:220],i*4);}
 ctx.putImageData(image,0,0);const [w,s,e,n]=raster.bounds;return L.imageOverlay(canvas.toDataURL(),[[s,w],[n,e]],{opacity:kind==='low'?.75:.85,interactive:false,className:'terrain-raster'});
}
function arrowLayer(){
 const group=L.layerGroup();for(const arrow of analysis.flow_arrows||[]){const a=arrow.from,b=arrow.to;if(!a?.every(Number.isFinite)||!b?.every(Number.isFinite))continue;const cos=Math.cos(a[1]*Math.PI/180),dx=(b[0]-a[0])*cos,dy=b[1]-a[1],head=.28;
  const p=[b[0]-(dx*.85-dy*.5)*head/cos,b[1]-(dy*.85+dx*.5)*head],q=[b[0]-(dx*.85+dy*.5)*head/cos,b[1]-(dy*.85-dx*.5)*head];L.polyline([toLL(a),toLL(b)],{color:'#255f9a',weight:1.8,opacity:.85,interactive:false}).addTo(group);L.polyline([toLL(p),toLL(b),toLL(q)],{color:'#255f9a',weight:1.8,opacity:.9,interactive:false}).addTo(group);
 }return group;
}
function buildLayers(){
 layers.elevation=rasterOverlay(analysis.raster.elevations,'elevation');layers.slope=rasterOverlay(analysis.raster.slope_degrees,'slope');layers.low=rasterOverlay(analysis.raster.low_mask,'low');layers.flow=arrowLayer();layers.drains=L.layerGroup();
 for(const path of analysis.drainage_paths||[]){if(!Array.isArray(path.coordinates)||path.coordinates.length<2)continue;const line=L.polyline(path.coordinates.map(toLL),{color:'#bd721e',weight:3,dashArray:'8 5'});line.bindPopup(el('p',path.note_ar||'مسار تصريف أولي؛ يلزم رفع مساحي والتحقق من المخرج.'));line.addTo(layers.drains);}
 for(const name of ['Slope','Flow','Low','Drains'])$('layer'+name).checked=false;$('layerElevation').checked=true;updateLayers();
}
function legendRow(label,gradient,detail){const row=el('div',undefined,'legend-row');row.append(el('strong',label));if(gradient){const ramp=el('span',undefined,'legend-ramp');ramp.style.background=gradient;row.append(ramp);}row.append(el('span',detail,'legend-detail'));return row;}
function updateLayers(){
 if(!map)return;if($('layerSatellite').checked){map.removeLayer(base);if(!map.hasLayer(satellite))satellite.addTo(map);}else{map.removeLayer(satellite);if(!map.hasLayer(base))base.addTo(map);}
 const box=$('terrainLegend');box.replaceChildren();if(!analysis){box.hidden=true;return;}
 for(const [name,id] of [['elevation','Elevation'],['slope','Slope'],['flow','Flow'],['low','Low'],['drains','Drains']]){if($('layer'+id).checked)layers[name]?.addTo(map);else if(layers[name])map.removeLayer(layers[name]);}
 if($('layerElevation').checked)box.append(legendRow('الارتفاع (م)','linear-gradient(to right,#37715a,#91ae6e,#e7c88b,#a36b44,#67463d)',fmt(analysis.summary.min_elevation_m,'م')+' ← '+fmt(analysis.summary.max_elevation_m,'م')));
 if($('layerSlope').checked)box.append(legendRow('الانحدار (°)','linear-gradient(to right,#f5eab6,#f1b858,#d37033,#853926)','٠° ← '+fmt(analysis.summary.max_slope_degrees,'°',2)+' · أقصى نسبة '+fmt(analysis.summary.max_slope_percent,'%',2)));
 if($('layerFlow').checked)box.append(legendRow('اتجاه الجريان','linear-gradient(#255f9a,#255f9a)','السهم يشير إلى الجار الأقل ارتفاعًا؛ المساحات المستوية قد تبقى دون اتجاه.'));
 if($('layerLow').checked)box.append(legendRow('تجمع محتمل','linear-gradient(#2d8bc3,#2d8bc3)',fmt(analysis.low_areas?.area_dunam,'دونم',3)+' · كشف طبوغرافي تقديري، لا إثبات غمر.'));
 if($('layerDrains').checked)box.append(legendRow('مبازل أولية','linear-gradient(#bd721e,#bd721e)','مسار متقطع مقترح؛ المخرج والسعة والعمق غير معتمدة هندسيًا.'));
 box.hidden=!box.childElementCount;boundaryLayer?.bringToFront?.();profileLayer?.bringToFront?.();
}
function metric(label,value,detail=''){const box=el('div',undefined,'terrain-metric');box.append(el('span',label),el('strong',value));if(detail)box.append(el('small',detail));return box;}
function safeSourceLink(url){try{const target=new URL(url);return target.protocol==='https:'?target.href:null;}catch{return null;}}
function showReport(record){
 const result=record.analysis;if(!result||result.status!=='completed'||!result.raster||!result.summary||!Array.isArray(result.raster.elevations))throw Error('التقرير المحفوظ غير مكتمل أو غير متوافق. لم تُعرض نتيجة بديلة.');
 if(!record.report_id||record.field_id!==selectedField?.id)throw Error('هذا التقرير لا يخص الحقل المختار.');
 clearResult();analysis=result;currentReport=record;polygon=validateTerrainPolygon(result.polygon).polygon;drawBoundary();updateArea();buildLayers();syncControls();fitField();const s=analysis.summary;
 $('terrainReportTitle').textContent='تقرير تضاريس '+(selectedField?.name||'الحقل');$('terrainReportMeta').textContent=timeLabel(record.created_at)+' بتوقيت بغداد · محفوظ في حسابك';
 $('terrainMetrics').replaceChildren(metric('مساحة الحقل',fmt(analysis.area_dunam,'دونم',3),'الدونم العراقي = ٢٥٠٠ م²'),metric('أقل ارتفاع',fmt(s.min_elevation_m,'م')),metric('أعلى ارتفاع',fmt(s.max_elevation_m,'م')),metric('متوسط الانحدار',fmt(s.mean_slope_degrees,'°',2),fmt(s.mean_slope_percent,'%',2)),metric('أقصى انحدار',fmt(s.max_slope_degrees,'°',2),fmt(s.max_slope_percent,'%',2)),metric('تغطية البيانات',fmt(s.coverage_percent,'%',1),fmt(s.valid_cells,'خلية',0)));
 const low=analysis.low_areas;$('terrainLowSummary').textContent=low?('مساحة منخفضات محتملة: '+fmt(low.area_dunam,'دونم',3)+' ('+fmt(low.fraction_percent,'%',1)+'). '+(low.cells?'أقصى عمق منخفض في النموذج '+fmt(low.max_depth_m,'م')+'، ولا يمثل عمق مياه متوقعًا.':'لم يرصد النموذج منخفضات تحقق معيار الكشف؛ هذا لا ينفي احتمال تجمع المياه على الواقع.')):'لم تتوفر معلومات كافية عن المنخفضات.';
 $('terrainRecommendations').replaceChildren(...(analysis.recommendations||[]).map(x=>el('li',x)));$('terrainWarnings').replaceChildren(...(analysis.warnings||[]).map(x=>el('li',x)));
 const source=analysis.source||{},res=source.native_resolution_m??source.resolution_m??source.nativeResolutionM;
 const spacing=source.sample_spacing_m,spacingText=spacing&&Number.isFinite(spacing.x)&&Number.isFinite(spacing.y)?' · تباعد خلايا التحليل الفعلي '+fmt(spacing.x,'م')+' × '+fmt(spacing.y,'م'):(Number.isFinite(source.resolution_m)?' · دقة شبكة التحليل '+fmt(source.resolution_m,'م'):'');
 $('terrainSourceMeta').textContent=(source.name||'Copernicus DEM GLO-30')+' · '+(res?('دقة مصدرية اسمية تقارب '+fmt(res,'م')):'')+spacingText+(source.decimation_factor>1?' · خُفّضت كثافة العينات بمعامل '+fmt(source.decimation_factor,'',0)+' لتناسب حدود المعالجة':'')+' · نموذج سطح DSM، وليس LiDAR. الارتفاعات بالأمتار وفق مرجع المصدر الرأسي'+(source.vertical_datum||source.verticalDatum?' ('+(source.vertical_datum||source.verticalDatum)+')':'')+'. التكبير لا يضيف تفاصيل جديدة إلى البيانات.';
 const sourceBox=$('terrainSourceLink');sourceBox.replaceChildren();const url=safeSourceLink(source.license_url||source.licenseUrl||source.url);if(url){const link=el('a','مصدر البيانات والترخيص');link.href=url;link.target='_blank';link.rel='noopener noreferrer';sourceBox.append(link);}if(source.attribution)sourceBox.append(el('span',' · '+source.attribution));
 $('terrainReport').hidden=false;$('boundaryState').textContent='تُعرض حدود الحقل وقت إنشاء هذا التقرير المحفوظ. التحليل الجديد يستخدم آخر حدود محفوظة في حسابك.';$('terrainProfileStatus').textContent='اضغط «رسم خط داخل الحقل»، حدّد نقطتين أو أكثر على الخريطة ثم «عرض المقطع».';
}
async function analyze(){
 if(busy||!user||!selectedField||!polygon||dirty)return;const fieldId=selectedField.id,token=generation;controller=new AbortController();const abort=controller,deadline=setTimeout(()=>abort.abort(),120000);busy=true;mode=null;clearResult();syncControls();setStatus('جارٍ جلب الارتفاعات وحساب الانحدار والجريان وحفظ التقرير. لا تغلق الصفحة حتى تنتهي العملية.');
 try{const result=await terrainPost({action:'analyze',field_id:fieldId},abort.signal);if(token!==generation||selectedField?.id!==fieldId)return;showReport(result);setStatus('اكتمل التحليل من بيانات ارتفاع فعلية، وحُفظ التقرير في حسابك. يمكنك الآن تبديل طبقات الخريطة.','success');void loadHistory();}
 catch(e){if(token===generation){clearResult();setStatus(e.name==='AbortError'?'انتهت مهلة الطلب. لم نعرض نتيجة غير مكتملة. راجع سجل التقارير قبل إعادة التحليل، فقد يكون الحفظ اكتمل على الخادم.':(e.message||'تعذر إكمال التحليل. لم تُعرض ارتفاعات أو نتائج بديلة.'),'error');}}
 finally{clearTimeout(deadline);if(token===generation){busy=false;controller=null;syncControls();}}
}
function downloadReport(record=currentReport){if(!record)return;const blob=new Blob([JSON.stringify(record,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='ur-terrain-'+record.field_id+'-'+String(record.created_at).slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function openReport(id){const token=generation,fieldId=selectedField?.id;if(!fieldId||busy)return;busy=true;syncControls();$('analysisProgress').hidden=true;setStatus('جارٍ فتح تقرير التضاريس المحفوظ…');try{const result=await terrainPost({action:'get',report_id:id},AbortSignal.timeout(30000));if(token!==generation||fieldId!==selectedField?.id)return;showReport(result);setStatus('تم فتح التقرير المحفوظ. يعرض بيانات وقت التحليل، وليس قياسات حية جديدة.','success');}catch(e){if(token===generation)setStatus(e.message||'تعذر فتح التقرير.','error');}finally{if(token===generation){busy=false;syncControls();}}}
async function deleteReport(id){
 if(!user||busy||!confirm('حذف هذا التقرير المحفوظ نهائيًا؟ يمكنك تنزيل نسخة JSON من زر التنزيل أولًا. لن تُحذف حدود الحقل.'))return;
 const token=generation;busy=true;syncControls();$('analysisProgress').hidden=true;
 try{const {error}=await timeout(client.from('terrain_reports').delete().eq('id',id).eq('user_id',user.id).select('id').single());if(error)throw Error('تعذر حذف التقرير من حسابك.');if(token!==generation)return;if(currentReport?.report_id===id)clearResult();setStatus('تم حذف التقرير المحدد. بقي الحقل وحدوده كما هما.','success');void loadHistory();}catch(e){if(token===generation)setStatus(e.message,'error');}finally{if(token===generation){busy=false;syncControls();}}
}
async function exportHistoryReport(id){const token=generation;try{const result=await terrainPost({action:'get',report_id:id},AbortSignal.timeout(30000));if(token===generation)downloadReport(result);}catch(e){if(token===generation)setStatus(e.message,'error');}}
async function loadHistory(){
 const fieldId=selectedField?.id,token=generation;if(!fieldId||!user)return;$('terrainHistory').textContent='جارٍ تحميل التقارير المحفوظة…';
 try{const result=await terrainPost({action:'list',field_id:fieldId},AbortSignal.timeout(30000));if(token!==generation||fieldId!==selectedField?.id)return;const box=$('terrainHistory');box.replaceChildren();if(!result.reports?.length){box.textContent='لا توجد تقارير تضاريس محفوظة لهذا الحقل بعد.';return;}
  for(const report of result.reports){const item=el('article',undefined,'history-item'),info=el('div'),buttons=el('div');info.append(el('strong',timeLabel(report.created_at)),el('span',report.source_id||'نموذج ارتفاع رقمي'));const open=el('button','عرض'),download=el('button','JSON'),remove=el('button','حذف');open.type=download.type=remove.type='button';open.addEventListener('click',()=>openReport(report.report_id));download.addEventListener('click',()=>exportHistoryReport(report.report_id));remove.addEventListener('click',()=>deleteReport(report.report_id));buttons.append(open,download,remove);item.append(info,buttons);box.append(item);}
 }catch(e){if(token===generation)$('terrainHistory').textContent='تعذر تحميل السجل: '+(e.message||'راجع اتصالك.');}
}
function drawProfile(){
 if(!analysis)return;mode='profile';profilePoints=[];clearProfile();profileLayer=L.polyline([],{color:'#d08c30',weight:3,dashArray:'6 4'}).addTo(map);$('terrainProfileStatus').textContent='المس نقطتين أو أكثر داخل الحقل على الخريطة. يجب أن يبقى الخط كله داخل الحدود. ثم اضغط «عرض المقطع».';$('mapHelp').textContent='رسم المقطع مفعّل: أضف نقاط الخط داخل الحقل، ثم اضغط «عرض المقطع».';syncControls();$('terrainMap').scrollIntoView({behavior:'smooth',block:'center'});
}
function finishProfile(){
 if(!analysis||profilePoints.length<2)return;
 try{const result=sampleTerrainProfile({polygon:analysis.polygon,raster:{...analysis.raster,source:analysis.source},line:profilePoints,samples:100});renderProfile(result);mode=null;syncControls();$('mapHelp').textContent='حرّك المؤشر أو المس الحقل لقراءة الارتفاع والانحدار.';$('terrainProfilePanel').scrollIntoView({behavior:'smooth',block:'start'});}
 catch(e){$('terrainProfileStatus').textContent='تعذر إنشاء المقطع: '+(e.message||'يجب أن يكون الخط كله داخل الحقل وفي منطقة ذات بيانات صالحة.');$('profileFigure').hidden=true;$('profileTableDetails').hidden=true;}
}
function renderProfile(profile){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 900 290');svg.setAttribute('role','img');svg.setAttribute('aria-label','مخطط ارتفاع الأرض مقابل المسافة على الخط المحدد');svg.setAttribute('direction','ltr');
 const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;svg.append(n);return n;};
 const left=75,right=870,top=30,bottom=235,span=Math.max(.5,profile.max_elevation_m-profile.min_elevation_m),low=profile.min_elevation_m-span*.1,high=profile.max_elevation_m+span*.1,x=d=>left+d/Math.max(1,profile.length_m)*(right-left),y=v=>bottom-(v-low)/(high-low)*(bottom-top);
 for(let i=0;i<5;i++){const yy=top+(bottom-top)*i/4,v=high-(high-low)*i/4;add('line',{x1:left,x2:right,y1:yy,y2:yy,stroke:'#dde6db','stroke-width':1});add('text',{x:left-12,y:yy+4,'text-anchor':'end',fill:'#607465','font-size':13},fmt(v));}
 for(let i=0;i<5;i++){const d=profile.length_m*i/4;add('text',{x:x(d),y:bottom+25,'text-anchor':'middle',fill:'#607465','font-size':13},fmt(d));}
 add('text',{x:450,y:282,'text-anchor':'middle',fill:'#4c6555','font-size':14},'المسافة من البداية (م)');add('text',{x:22,y:140,transform:'rotate(-90 22 140)','text-anchor':'middle',fill:'#4c6555','font-size':14},'الارتفاع (م)');
 let d='',gap=true;for(const sample of profile.samples){if(typeof sample.elevation_m!=='number'||!Number.isFinite(sample.elevation_m)){gap=true;continue;}d+=(gap?'M':'L')+x(sample.distance_m).toFixed(2)+' '+y(sample.elevation_m).toFixed(2)+' ';gap=false;}
 add('path',{d,fill:'none',stroke:'#22754e','stroke-width':3,'stroke-linejoin':'round'});$('terrainProfileChart').replaceChildren(svg);$('terrainProfileCaption').textContent='طول الخط '+fmt(profile.length_m,'م')+' · أدنى ارتفاع '+fmt(profile.min_elevation_m,'م')+' · أعلى ارتفاع '+fmt(profile.max_elevation_m,'م')+'. القراءات من نفس DEM؛ كثرة نقاط الرسم لا تزيد دقة المصدر.';$('terrainProfileTable').replaceChildren(...profile.samples.map(sample=>{const row=el('tr');row.append(el('td',fmt(sample.distance_m)),el('td',fmt(sample.elevation_m)));return row;}));$('profileFigure').hidden=false;$('profileTableDetails').hidden=false;$('terrainProfileStatus').textContent='اكتمل المقطع من بيانات التقرير الحالي. المحور الرأسي مكبّر لعرض فروق الارتفاع ولا يمثل مقياس رسم هندسيًا.';
}
function pixelAt(latlng){
 if(!analysis)return;const r=analysis.raster,[w,s,e,n]=r.bounds,c=Math.floor((latlng.lng-w)/(e-w)*r.width),row=Math.floor((n-latlng.lat)/(n-s)*r.height),i=row*r.width+c;
 if(c<0||row<0||c>=r.width||row>=r.height||!r.field_mask[i]||r.elevations[i]===null){$('terrainPixel').textContent='لا توجد قراءة صالحة عند هذه النقطة داخل الحقل.';return;}
 $('terrainPixel').textContent='الارتفاع '+fmt(r.elevations[i],'م')+' · الانحدار '+fmt(r.slope_degrees[i],'°',2)+' ('+fmt(r.slope_percent[i],'%',2)+')'+(r.low_mask[i]?' · منطقة منخفضة محتملة':'')+' · قراءة خلية DEM وليست قياسًا مساحيًا.';
}
function renderFieldOptions(){const select=$('terrainField'),value=selectedField?.id||'';select.replaceChildren(new Option(fields.length?'اختر حقلًا محفوظًا':'لا توجد حقول محفوظة بعد',''));for(const field of fields)select.add(new Option(field.name,field.id));select.value=value;}
function clearAccount(){
 invalidate();busy=false;user=null;fields=[];farms=[];selectedField=null;polygon=null;points=[];mode=null;dirty=false;clearResult();drawBoundary();updateArea();renderFieldOptions();$('newFieldDetails').hidden=true;$('terrainFieldName').value='';$('terrainFieldCrop').value='';$('terrainHistory').textContent='سجّل الدخول لعرض تقارير حسابك.';$('boundaryState').textContent='لا توجد حدود محددة.';$('accountStatus').textContent='سجّل الدخول لحفظ الحقول والتحليل والتقارير.';$('loginLink').hidden=false;document.querySelector('.account-bar').classList.remove('connected');syncControls();
}
async function connect(){
 const boot=++bootGeneration;clearAccount();const token=generation;$('accountStatus').textContent='جارٍ الاتصال بحسابك…';
 try{const {data,error}=await timeout(client.auth.getSession());if(boot!==bootGeneration||token!==generation)return;if(error)throw Error('تعذر التحقق من جلسة الحساب.');if(!data?.session){authId=null;clearAccount();setStatus('يمكنك الاطلاع على الخدمة ورسم الحدود. سجّل الدخول لحفظ الحقل وتشغيل التحليل.');return;}user=data.session.user;authId=user.id;$('loginLink').hidden=true;$('accountStatus').textContent='متصل بحسابك'+(user.email?' · '+user.email:'');document.querySelector('.account-bar').classList.add('connected');
  const [fieldResult,farmResult]=await Promise.all([timeout(client.from('fields').select('id,name,crop,farm_id,farms!inner(owner_id)').eq('farms.owner_id',user.id).order('name')),timeout(client.from('farms').select('id,name').eq('owner_id',user.id).order('created_at'))]);if(boot!==bootGeneration||token!==generation)return;if(fieldResult.error||farmResult.error)throw Error('تعذر تحميل الحقول من حسابك. اضغط تحديث الاتصال.');fields=fieldResult.data||[];farms=farmResult.data||[];renderFieldOptions();syncControls();const initial=new URLSearchParams(location.search).get('field');if(initial&&fields.some(f=>f.id===initial)){selectedField=null;$('terrainField').value=initial;await selectField(initial);}else setStatus(fields.length?'اختر حقلًا محفوظًا، أو ارسم حقلًا جديدًا.':'حسابك متصل. ابدأ برسم حقل جديد واحفظ حدوده.');
 }catch(e){if(boot===bootGeneration){$('accountStatus').textContent='تعذر إكمال الاتصال بالحساب. أعد المحاولة.';setStatus(e.message||'تعذر الاتصال.','error');syncControls();}}
}
function initMap(){
 if(!globalThis.L)throw Error('تعذر تحميل مكتبة الخريطة. تحقق من الاتصال وأعد فتح الصفحة.');
 map=L.map('terrainMap',{tap:false}).setView([32.75,45.3],11);base=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'});satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Imagery © Esri and contributors'}).addTo(map);pointLayer=L.layerGroup().addTo(map);L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
 map.on('click',event=>{if(busy)return;if(mode==='boundary'){points.push([event.latlng.lng,event.latlng.lat]);rebuildDraft();}else if(mode==='profile'){profilePoints.push([event.latlng.lng,event.latlng.lat]);profileLayer.setLatLngs(profilePoints.map(toLL));$('terrainProfileStatus').textContent='نقاط المقطع: '+fmt(profilePoints.length,'',0)+' · اضغط «عرض المقطع» عند اكتمال الخط.';syncControls();}else pixelAt(event.latlng);});map.on('mousemove',event=>{if(!mode)pixelAt(event.latlng);});
}
try{
 initMap();$('terrainField').addEventListener('change',()=>selectField($('terrainField').value));$('newTerrainField').addEventListener('click',newField);$('drawTerrainBoundary').addEventListener('click',startBoundary);$('finishTerrainDrawing').addEventListener('click',finishBoundary);$('fitTerrainField').addEventListener('click',fitField);$('saveTerrainField').addEventListener('click',saveField);$('analyzeTerrain').addEventListener('click',analyze);$('retryConnection').addEventListener('click',connect);$('refreshTerrainHistory').addEventListener('click',loadHistory);$('drawTerrainProfile').addEventListener('click',drawProfile);$('finishTerrainProfile').addEventListener('click',finishProfile);$('printTerrain').addEventListener('click',()=>window.print());$('downloadTerrain').addEventListener('click',()=>downloadReport());
 $('undoTerrainPoint').addEventListener('click',()=>{if(mode==='boundary'){points.pop();rebuildDraft();}else if(mode==='profile'){profilePoints.pop();profileLayer.setLatLngs(profilePoints.map(toLL));syncControls();}});
 $('terrainLocate').addEventListener('click',()=>{if(!navigator.geolocation){setStatus('تحديد الموقع غير متاح في هذا المتصفح. حدد الحقل على الخريطة.','error');return;}navigator.geolocation.getCurrentPosition(position=>{map.setView([position.coords.latitude,position.coords.longitude],16);setStatus('تم تقريب الخريطة إلى موقع الجهاز. حدد حدود الحقل بدقة.');},()=>setStatus('تعذر تحديد موقع الجهاز. يمكنك تحريك الخريطة يدويًا إلى الحقل.','error'),{timeout:15000,maximumAge:60000});});
 for(const name of ['Satellite','Elevation','Slope','Flow','Low','Drains'])$('layer'+name).addEventListener('change',updateLayers);
 client.auth.onAuthStateChange?.((event,session)=>{const next=session?.user?.id||null;if(event==='SIGNED_OUT'||authId&&next!==authId){bootGeneration++;authId=next;clearAccount();setStatus('انتهت الجلسة أو تغيّر الحساب؛ أُخفيت بيانات الحساب السابق.');if(next)setTimeout(()=>void connect(),0);}else if(event==='SIGNED_IN'&&next&&!authId){authId=next;setTimeout(()=>void connect(),0);}});
 void connect();
}catch(e){setStatus(e.message||'تعذر تشغيل خريطة التضاريس. أعد فتح الصفحة.','error');$('accountStatus').textContent='الخريطة غير جاهزة الآن.';}
