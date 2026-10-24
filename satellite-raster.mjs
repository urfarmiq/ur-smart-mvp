// Image loading and presentation only; all pixel measurements come from Sentinel-2.
export function pickSceneDate(series,requested,fallback){
 const days=(Array.isArray(series)?series:[]).map(s=>String(s.date||'').slice(0,10)).filter(Boolean);
 const preferred=String(fallback||'').slice(0,10);
 if(days.includes(requested))return requested;
 if(days.includes(preferred))return preferred;
 return days[0]||preferred;
}
export function loadRasterImage(source, ImageClass=globalThis.Image, timeoutMs=20000){
 if(typeof source!=='string'||!source.startsWith('data:image/png;base64,'))return Promise.reject(Error('استجابة الصورة غير صالحة'));
 return new Promise((resolve,reject)=>{
  const img=new ImageClass();let timer;
  const finish=(error)=>{clearTimeout(timer);img.onload=null;img.onerror=null;error?reject(error):resolve(img);};
  img.onload=()=>finish(img.naturalWidth>0&&img.naturalHeight>0?null:Error('صورة المؤشر فارغة'));
  img.onerror=()=>finish(Error('تعذر فك صورة المؤشر'));
  timer=setTimeout(()=>finish(Error('انتهت مهلة تجهيز صورة المؤشر؛ أعد المحاولة')),timeoutMs);
  // Cached data URLs may finish immediately: install handlers before setting src.
  img.src=source;
 });
}
export function colorizeRaster(pixels,index){
 const low=index==='MSI'?[17,163,90]:[216,63,50],middle=[241,214,74],high=index==='NDMI'?[23,108,241]:index==='MSI'?[216,63,50]:[17,163,90];
 for(let i=0;i<pixels.length;i+=4){
  if(pixels[i+3]===0)continue;
  const t=pixels[i]/255,from=t<=.5?low:middle,to=t<=.5?middle:high,part=t<=.5?t*2:(t-.5)*2;
  for(let c=0;c<3;c++)pixels[i+c]=Math.round(from[c]+(to[c]-from[c])*part);
 }
 return pixels;
}
export async function collectRasters(keys,request){
 const images=new Map(),errors=new Map();
 // Limit parallel upstream requests; one unavailable index must not hide others.
 for(let i=0;i<keys.length;i+=2){const batch=keys.slice(i,i+2),results=await Promise.allSettled(batch.map(request));results.forEach((r,j)=>{r.status==='fulfilled'?images.set(batch[j],r.value):errors.set(batch[j],r.reason?.message||String(r.reason));});}
 return {images,errors};
}
