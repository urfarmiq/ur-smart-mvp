// These ranges must match the Worker's grayscale display encoding. Values are
// reconstructed from the original grayscale PNG, never from its colored overlay.
export const DISPLAY_RANGES=Object.freeze({NDVI:[-.2,.8],NDMI:[-.5,.5],SAVI:[-.2,.8],OSAVI:[-.2,.8],MSAVI2:[-.2,.8],EVI:[-.2,1],GNDVI:[-.2,.8],NDRE:[-.2,.8],MNDWI:[-.8,.8],NBR:[-1,1],MSI:[0,2],CIgreen:[0,4],NDRE2:[-.2,.8],NDRE3:[-.2,.8],CIrededge:[0,4],NIRv:[0,.5]});

function onSegment(x,y,a,b){
 const cross=(x-a[0])*(b[1]-a[1])-(y-a[1])*(b[0]-a[0]);
 return Math.abs(cross)<1e-12&&x>=Math.min(a[0],b[0])-1e-12&&x<=Math.max(a[0],b[0])+1e-12&&y>=Math.min(a[1],b[1])-1e-12&&y<=Math.max(a[1],b[1])+1e-12;
}
function ringContains(ring,x,y){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[j],b=ring[i];if(onSegment(x,y,a,b))return true;
  if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
}
export function polygonContains(geometry,lat,lng){
 const rings=geometry?.type==='Polygon'?geometry.coordinates:null;
 return !!(Array.isArray(rings)&&rings[0]?.length>=3&&ringContains(rings[0],lng,lat)&&!rings.slice(1).some(r=>ringContains(r,lng,lat)));
}
export function sampleRaster(layer,lat,lng){
 if(!Number.isFinite(lat)||!Number.isFinite(lng))return {status:'outside'};
 if(!polygonContains(layer.geometry,lat,lng))return {status:'outside'};
 const bounds=layer.bounds,range=layer.range||DISPLAY_RANGES[layer.index],{width,height,pixels}=layer;
 if(!Array.isArray(bounds)||bounds.length!==2||!range||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!pixels||pixels.length<width*height*4)return {status:'unavailable'};
 const [[south,west],[north,east]]=bounds;
 if(![south,west,north,east,...range].every(Number.isFinite)||north<=south||east<=west||range[1]<=range[0])return {status:'unavailable'};
 if(lat<south||lat>north||lng<west||lng>east)return {status:'outside'};
 const x=Math.min(width-1,Math.floor((lng-west)/(east-west)*width)),y=Math.min(height-1,Math.floor((north-lat)/(north-south)*height)),offset=(y*width+x)*4;
 if(pixels[offset+3]===0)return {status:'nodata',x,y};
 const gray=pixels[offset],span=range[1]-range[0],value=range[0]+gray/255*span;
 // Rounding and clipping in the display PNG lose precision. Endpoint pixels
 // include the half-step next to the clamp, so bound them conservatively.
 return {status:'valid',x,y,gray,value,percent:gray/255*100,step:span/255,relation:gray===0?'≤':gray===255?'≥':'≈',bound:gray===0?range[0]+span/510:gray===255?range[1]-span/510:value};
}
export function formatSample(layer,sample){
 const label=String(layer.index||'المؤشر');
 if(sample.status==='outside')return `${label}: خارج حدود الحقل`;
 if(sample.status==='nodata')return `${label}: لا توجد بيانات صالحة في هذه النقطة`;
 if(sample.status!=='valid')return `${label}: قيمة البكسل غير متاحة`;
 return `${label} ${sample.relation} ${sample.bound.toFixed(3)} · موضع على مقياس الألوان: ${sample.percent.toFixed(1)}%`;
}

export function attachPixelProbe({map,L,getLayers}){
 const control=L.control({position:'bottomright'}),container=map.getContainer();let box,lastText='',disposed=false;
 const hint='حرّك الماوس أو المس داخل الحقل لقراءة المؤشر';
 control.onAdd=()=>{box=L.DomUtil.create('div','ur-pixel-probe');box.dir='rtl';box.setAttribute('role','status');box.setAttribute('aria-live','polite');box.dataset.probeState='inactive';box.style.cssText='background:#fffffff2;color:#173b2b;border:1px solid #cbd9cf;border-radius:10px;padding:9px 12px;box-shadow:0 2px 8px #0003;max-width:min(310px,68vw);font:13px/1.6 Tahoma,Arial,sans-serif;pointer-events:none;white-space:normal;';box.textContent=hint;return box;};
 control.addTo(map);
 function write(lines){const text=lines.join('\n');if(disposed||!box||text===lastText)return;lastText=text;box.replaceChildren(...lines.map((line,i)=>{const row=document.createElement('div');row.textContent=line;if(i===0)row.className='ur-pixel-probe-value';if(i>0)row.style.fontSize='11px';return row;}));}
 function reset(){if(box){box.dataset.probeState='inactive';delete box.dataset.probeIndex;}write([hint]);}
 function show(latlng){
  if(disposed||!latlng)return;
  const layers=getLayers().filter(Boolean);
  if(!layers.length){box.dataset.probeState='inactive';delete box.dataset.probeIndex;write(['فعّل طبقة مؤشر لقراءة قيمتها']);return;}
  const samples=layers.map(layer=>({layer,sample:sampleRaster(layer,latlng.lat,latlng.lng)}));
  box.dataset.probeState=samples.some(s=>s.sample.status==='valid')?'value':samples[0].sample.status;box.dataset.probeIndex=layers.map(l=>l.index).join(',');
  const lines=samples.map(({layer,sample})=>formatSample(layer,sample));
  if(samples.some(s=>s.sample.status==='valid')){
   const first=layers[0],date=String(first.date||'').slice(0,10),resolution=Number(first.resolution_m);
   if(date||Number.isFinite(resolution))lines.push([date,resolution>0?`دقة المصدر ${resolution} م`:''].filter(Boolean).join(' · '));
   lines.push('قيمة تقريبية من بكسل العرض؛ النسبة لمقياس اللون وليست نسبة صحة النبات أو رطوبة التربة.');
  }
  write(lines);
 }
 const mapPointer=e=>show(e.latlng);
 const touch=e=>{if(e.touches?.length===1)show(map.mouseEventToLatLng(e.touches[0]));};
 const pointer=e=>{if(e.pointerType==='touch'&&e.isPrimary!==false)show(map.mouseEventToLatLng(e));};
 map.on('mousemove click',mapPointer);map.on('mouseout layeradd layerremove',reset);
 container.addEventListener('touchstart',touch,{passive:true});container.addEventListener('touchmove',touch,{passive:true});container.addEventListener('pointermove',pointer,{passive:true});
 function cleanup(){if(disposed)return;disposed=true;map.off('unload',cleanup);map.off('mousemove click',mapPointer);map.off('mouseout layeradd layerremove',reset);container.removeEventListener('touchstart',touch);container.removeEventListener('touchmove',touch);container.removeEventListener('pointermove',pointer);control.remove();}
 map.on('unload',cleanup);
 return cleanup;
}
