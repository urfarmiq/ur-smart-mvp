import {loadRasterImage,colorizeRaster} from './satellite-raster.mjs';
import {DISPLAY_RANGES,formatSample} from './satellite-pixel-probe.mjs';

// Measurements always use the original grayscale bytes, before palette colors.
export function sampleImagePixel(pixels,width,height,x,y,index='NDVI'){
 const range=DISPLAY_RANGES[index];
 if(!range||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!pixels||pixels.length<width*height*4)return {status:'unavailable'};
 if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=width||y>=height)return {status:'outside'};
 x=Math.floor(x);y=Math.floor(y);const offset=(y*width+x)*4;
 const alpha=pixels[offset+3],gray=pixels[offset];
 if(!Number.isInteger(alpha)||alpha<0||alpha>255||!Number.isInteger(gray)||gray<0||gray>255)return {status:'unavailable'};
 if(alpha===0)return {status:'nodata',x,y};
 const span=range[1]-range[0],value=range[0]+gray/255*span;
 return {status:'valid',x,y,gray,value,percent:gray/255*100,step:span/255,relation:gray===0?'≤':gray===255?'≥':'≈',bound:gray===0?range[0]+span/510:gray===255?range[1]-span/510:value};
}
export function nativeImageDetails(data,width,height){
 const native=Number(data.native_resolution_m??data.resolution_m),x=Number(data.resolution_x_m),y=Number(data.resolution_y_m);
 const parts=[`ملف الصورة الأصلي: ${width} × ${height} بكسل`];
 if(Number.isFinite(native)&&native>0)parts.push(`دقة المصدر ${native} متر/بكسل`);
 if(Number.isFinite(x)&&Number.isFinite(y)&&x>0&&y>0&&native>0&&Math.max(x,y)>native*1.05)parts.push(`شبكة العرض نحو ${x} × ${y} متر/بكسل`);
 parts.push('التكبير للعرض فقط؛ لا يضيف تفاصيل أو قياسات جديدة.');
 return parts.join(' · ');
}

export function createResearchImageViewer(figure){
 const find=id=>figure.querySelector('#'+id),image=find('mapImage'),viewport=find('mapViewport'),caption=find('mapCaption'),probe=find('mapPixelValue'),details=find('mapNativeDetails');
 const zoomIn=find('mapZoomIn'),zoomOut=find('mapZoomOut'),fitButton=find('mapFit'),expandButton=find('mapExpand'),closeButton=find('mapCloseExpanded'),zoomLabel=find('mapZoomLevel');
 const hint='حرّك الماوس أو المس الصورة لقراءة قيمة البكسل.';
 let serial=0,pixels=null,width=0,height=0,source=null,zoom=1,panX=0,panY=0,fitWidth=0,fitHeight=0,expanded=false,returnFocus=null,bodyWasLocked=false,pinch=null;
 const pointers=new Map(),inertStates=new Map();
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 function resetProbe(){probe.textContent=hint;probe.dataset.probeState='inactive';delete probe.dataset.value;}
 function draw(){
  const maxX=Math.max(0,(fitWidth*zoom-viewport.clientWidth)/2+12),maxY=Math.max(0,(fitHeight*zoom-viewport.clientHeight)/2+12);
  panX=clamp(panX,-maxX,maxX);panY=clamp(panY,-maxY,maxY);
  image.style.width=fitWidth+'px';image.style.height=fitHeight+'px';image.style.transform=`translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${zoom})`;
  zoomLabel.textContent=Math.round(zoom*100)+'٪';zoomIn.disabled=!pixels||zoom>=8;zoomOut.disabled=!pixels||zoom<=1;fitButton.disabled=!pixels;expandButton.disabled=!pixels;
  viewport.dataset.zoom=String(zoom);
 }
 function layout(){
  if(!pixels||!viewport.clientWidth||!viewport.clientHeight)return;
  const scale=Math.min(Math.max(1,viewport.clientWidth-24)/width,Math.max(1,viewport.clientHeight-24)/height);
  fitWidth=width*scale;fitHeight=height*scale;draw();
 }
 function fit(){zoom=1;panX=0;panY=0;pinch=null;layout();resetProbe();}
 function zoomTo(value,clientX,clientY){
  if(!pixels)return;const next=clamp(value,1,8),rect=viewport.getBoundingClientRect(),x=Number.isFinite(clientX)?clientX-rect.left-rect.width/2:0,y=Number.isFinite(clientY)?clientY-rect.top-rect.height/2:0;
  panX=x-(x-panX)*next/zoom;panY=y-(y-panY)*next/zoom;zoom=next;draw();
 }
 function inspect(clientX,clientY){
  if(!pixels)return;const rect=image.getBoundingClientRect();
  const sample=sampleImagePixel(pixels,width,height,(clientX-rect.left)/rect.width*width,(clientY-rect.top)/rect.height*height);
  probe.textContent=formatSample({index:'NDVI'},sample);probe.dataset.probeState=sample.status==='valid'?'value':sample.status==='nodata'?'nodata':'inactive';
  if(sample.status==='valid')probe.dataset.value=String(sample.value);else delete probe.dataset.value;
 }
 function lockSiblings(){
  for(let current=figure;current?.parentElement;current=current.parentElement){
   for(const sibling of current.parentElement.children)if(sibling!==current&&!inertStates.has(sibling)){inertStates.set(sibling,sibling.inert);sibling.inert=true;}
  }
 }
 function closeExpanded(restoreFocus=true){
  if(!expanded)return;expanded=false;figure.dataset.expanded='false';figure.removeAttribute('role');figure.removeAttribute('aria-modal');closeButton.hidden=true;expandButton.textContent='عرض أكبر';expandButton.setAttribute('aria-expanded','false');
  if(!bodyWasLocked)document.body.classList.remove('research-viewer-open');for(const [element,wasInert] of inertStates)element.inert=wasInert;inertStates.clear();
  const previous=returnFocus;returnFocus=null;fit();if(restoreFocus&&previous?.isConnected)previous.focus({preventScroll:true});
 }
 function expand(){
  if(!pixels)return;if(expanded){closeExpanded();return;}
  returnFocus=document.activeElement;expanded=true;figure.dataset.expanded='true';figure.setAttribute('role','dialog');figure.setAttribute('aria-modal','true');figure.setAttribute('aria-label','عرض مكبّر لصورة NDVI');closeButton.hidden=false;expandButton.textContent='تصغير العرض';expandButton.setAttribute('aria-expanded','true');bodyWasLocked=document.body.classList.contains('research-viewer-open');document.body.classList.add('research-viewer-open');lockSiblings();fit();closeButton.focus({preventScroll:true});
 }
 function clear(){
  serial++;closeExpanded(false);for(const id of pointers.keys())try{viewport.releasePointerCapture(id);}catch{}
  pointers.clear();pinch=null;pixels=null;width=0;height=0;source=null;zoom=1;panX=0;panY=0;fitWidth=0;fitHeight=0;image.removeAttribute('src');image.removeAttribute('width');image.removeAttribute('height');delete image.dataset.nativeWidth;delete image.dataset.nativeHeight;image.style.removeProperty('width');image.style.removeProperty('height');image.style.removeProperty('transform');caption.textContent='';details.textContent='';figure.hidden=true;resetProbe();draw();
 }
 async function show(data,{isCurrent=()=>true}={}){
  clear();const version=serial;
  if(data.index!==undefined&&data.index!=='NDVI')throw Error('الصورة لا تطابق مؤشر NDVI المطلوب.');
  if(data.encoding!==undefined&&data.encoding!=='uint8-grayscale-clamped')throw Error('ترميز صورة المؤشر غير مدعوم.');
  if(data.display_range!==undefined&&(!Array.isArray(data.display_range)||data.display_range.length!==2||data.display_range.some((value,i)=>value!==DISPLAY_RANGES.NDVI[i])))throw Error('مقياس الصورة لا يطابق مقياس عرض NDVI.');
  const decoded=await loadRasterImage(data.image);
  if(version!==serial||!isCurrent())return null;
  const w=decoded.naturalWidth,h=decoded.naturalHeight;
  if(w>2048||h>2048||w*h>4*1024*1024)throw Error('أبعاد صورة المؤشر أكبر من الحد المدعوم.');
  if((data.width!==undefined&&data.width!==w)||(data.height!==undefined&&data.height!==h))throw Error('أبعاد الصورة لا تطابق بيانات المشهد.');
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('تعذر تجهيز عارض صورة المؤشر.');
  context.imageSmoothingEnabled=false;context.drawImage(decoded,0,0);const raw=context.getImageData(0,0,w,h);
  let validPixels=0;for(let i=0;i<raw.data.length;i+=4)if(raw.data[i+3]>0){validPixels++;if(raw.data[i]!==raw.data[i+1]||raw.data[i]!==raw.data[i+2])throw Error('الصورة لا تحتوي ترميز NDVI الرمادي المتوقع.');}
  if(!validPixels)throw Error('لم تحتوِ الصورة على بكسلات صالحة؛ أعد المحاولة عند توفر مشهد أوضح.');
  const original=new Uint8ClampedArray(raw.data);colorizeRaster(raw.data,'NDVI');context.putImageData(raw,0,0);const colored=canvas.toDataURL('image/png');
  if(version!==serial||!isCurrent())return null;
  await loadRasterImage(colored);if(version!==serial||!isCurrent())return null;
  width=w;height=h;pixels=original;source=colored;image.src=colored;image.width=w;image.height=h;image.dataset.nativeWidth=String(w);image.dataset.nativeHeight=String(h);caption.textContent=[typeof data.source==='string'?data.source:'Sentinel-2 L2A',typeof data.date==='string'?data.date.slice(0,10):'','ألوان NDVI من البكسلات الفعلية'].filter(Boolean).join(' · ');details.textContent=nativeImageDetails(data,w,h);figure.hidden=false;fit();return source;
 }
 zoomIn.addEventListener('click',()=>zoomTo(zoom*1.5));zoomOut.addEventListener('click',()=>zoomTo(zoom/1.5));fitButton.addEventListener('click',fit);expandButton.addEventListener('click',expand);closeButton.addEventListener('click',()=>closeExpanded());
 viewport.addEventListener('keydown',event=>{
  if(!pixels)return;let handled=true;
  if(['+','='].includes(event.key))zoomTo(zoom*1.5);else if(event.key==='-')zoomTo(zoom/1.5);else if(['0','Home'].includes(event.key))fit();else if(event.key==='ArrowLeft'){panX-=35;draw();}else if(event.key==='ArrowRight'){panX+=35;draw();}else if(event.key==='ArrowUp'){panY-=35;draw();}else if(event.key==='ArrowDown'){panY+=35;draw();}else handled=false;
  if(handled)event.preventDefault();
 });
 figure.addEventListener('keydown',event=>{
  if(!expanded)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeExpanded();return;}
  if(event.key==='Tab'){const focusable=[...figure.querySelectorAll('button:not(:disabled),[tabindex="0"]')].filter(element=>!element.hidden&&element.getClientRects().length),first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
 });
 function pinchSnapshot(){const points=[...pointers.values()],rect=viewport.getBoundingClientRect();if(points.length!==2){pinch=null;return;}const x=(points[0].x+points[1].x)/2-rect.left-rect.width/2,y=(points[0].y+points[1].y)/2-rect.top-rect.height/2;pinch={distance:Math.max(1,Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)),zoom,anchorX:(x-panX)/zoom,anchorY:(y-panY)/zoom};}
 viewport.addEventListener('pointerdown',event=>{if(!pixels||event.button>0)return;viewport.focus({preventScroll:true});pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});try{viewport.setPointerCapture(event.pointerId);}catch{}pinchSnapshot();inspect(event.clientX,event.clientY);});
 viewport.addEventListener('pointermove',event=>{
  if(!pixels)return;const previous=pointers.get(event.pointerId);
  if(previous){pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pointers.size===2&&pinch){const points=[...pointers.values()],rect=viewport.getBoundingClientRect(),next=clamp(pinch.zoom*Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)/pinch.distance,1,8);panX=(points[0].x+points[1].x)/2-rect.left-rect.width/2-pinch.anchorX*next;panY=(points[0].y+points[1].y)/2-rect.top-rect.height/2-pinch.anchorY*next;zoom=next;draw();}else if(pointers.size===1){panX+=event.clientX-previous.x;panY+=event.clientY-previous.y;draw();}}
  inspect(event.clientX,event.clientY);
 });
 function endPointer(event){pointers.delete(event.pointerId);try{viewport.releasePointerCapture(event.pointerId);}catch{}pinchSnapshot();}
 viewport.addEventListener('pointerup',endPointer);viewport.addEventListener('pointercancel',endPointer);viewport.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch'&&!pointers.size)resetProbe();});
 viewport.addEventListener('wheel',event=>{if(pixels&&(expanded||event.ctrlKey||event.metaKey)){event.preventDefault();zoomTo(zoom*(event.deltaY<0?1.2:1/1.2),event.clientX,event.clientY);}},{passive:false});
 viewport.addEventListener('dblclick',event=>{event.preventDefault();zoomTo(zoom>1?1:2,event.clientX,event.clientY);});
 if(typeof ResizeObserver==='function')new ResizeObserver(layout).observe(viewport);else window.addEventListener('resize',layout);
 clear();return {show,clear,getSource:()=>source};
}
