const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const ROOT_KEYS=['google'];
const GOOGLE_KEYS=['mode','publisher_id','ad_slot','site_approved','cmp_ready'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GOOGLE_ADS_ORIGIN='https://ur-smart-urfarmiq.pages.dev';
export const GOOGLE_ADS_SCRIPT='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

// Public identifiers only. Rejecting unknown fields also prevents accidental
// publication of private credentials in this explicitly public configuration.
export function validateMonetizationConfig(value){
 if(!plain(value)||Object.keys(value).some(key=>!ROOT_KEYS.includes(key))||!plain(value.google)||Object.keys(value.google).some(key=>!GOOGLE_KEYS.includes(key)))throw Error('Invalid public monetization configuration.');
 const g=value.google;
 if(!['disabled','verification','active'].includes(g.mode)||typeof g.publisher_id!=='string'||typeof g.ad_slot!=='string'||typeof g.site_approved!=='boolean'||typeof g.cmp_ready!=='boolean')throw Error('Invalid Google advertising settings.');
 const publisher_id=g.publisher_id.trim(),ad_slot=g.ad_slot.trim();
 if(publisher_id&&!/^ca-pub-\d{16}$/.test(publisher_id)||ad_slot&&!/^\d{1,20}$/.test(ad_slot))throw Error('Invalid public Google publisher or ad-unit identifier.');
 if(g.mode!=='disabled'&&!publisher_id)throw Error('Google verification requires a real publisher identifier.');
 if(g.mode==='active'&&(!ad_slot||!g.site_approved||!g.cmp_ready))throw Error('Google advertisements require an ad unit, site approval and completed consent setup.');
 return {google:{mode:g.mode,publisher_id,ad_slot,site_approved:g.site_approved,cmp_ready:g.cmp_ready}};
}

export function getAdsenseSeller(config){
 const {google}=validateMonetizationConfig(config);
 return google.mode==='disabled'?null:google.publisher_id.replace(/^ca-/,'');
}

export function validateAdTarget(value){
 if(typeof value!=='string'||value.length>1000||!/^https:\/\//i.test(value)||/[\u0000-\u0020\u007f-\u009f\\]/.test(value))return null;
 try{
  const url=new URL(value);
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||host.length>253||host.split('.').some(label=>label.length>63)||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host)||/(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(host))return null;
  return url.href;
 }catch{return null;}
}

const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const DATE=/^\d{4}-\d{2}-\d{2}T/;
export function normalizePublicAds(value,placement,now=Date.now()){
 if(!['home','services'].includes(placement)||!Array.isArray(value)||value.length>3)return [];
 const allowed=['id','company_name','ad_title','ad_body','target_url','placement','starts_at','ends_at'];
 return value.flatMap(row=>{
  if(!plain(row)||Object.keys(row).some(key=>!allowed.includes(key))||!UUID.test(row.id||'')||row.placement!==placement||!text(row.company_name,120)||!text(row.ad_title,120)||!text(row.ad_body,800)||typeof row.starts_at!=='string'||typeof row.ends_at!=='string'||!DATE.test(row.starts_at)||!DATE.test(row.ends_at))return [];
  const target=validateAdTarget(row.target_url),start=Date.parse(row.starts_at),end=Date.parse(row.ends_at);
  if(!target||!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<=now||end<=start||end-start>366*86400000)return [];
  return [{id:row.id,company_name:row.company_name.trim(),ad_title:row.ad_title.trim(),ad_body:row.ad_body.trim(),target_url:target,placement,starts_at:row.starts_at,ends_at:row.ends_at}];
 });
}

export function isGoogleBrowserSurface(win,nav){
 try{
  const location=new URL(win.location.href);
  return location.origin===GOOGLE_ADS_ORIGIN&&['/','/index.html'].includes(location.pathname)&&!location.search&&!location.hash&&nav.standalone!==true&&win.matchMedia?.('(display-mode: browser)').matches===true&&!win.matchMedia?.('(display-mode: standalone)').matches&&!win.matchMedia?.('(display-mode: minimal-ui)').matches&&!win.matchMedia?.('(display-mode: fullscreen)').matches;
 }catch{return false;}
}

export async function boundedAdJSON(response,maxBytes=16384,timeout=8000){
 const declared=response.headers?.get('content-length');
 if(declared!==null&&declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw Error('Advertising response is too large.');
 if(!response.body?.getReader)throw Error('Advertising response has no body.');
 const reader=response.body.getReader(),chunks=[];let size=0,timer;
 const consume=(async()=>{
  try{
   for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw Error('Advertising response is too large.');chunks.push(value);}
   const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }finally{try{reader.releaseLock();}catch{}}
 })();
 try{return await Promise.race([consume,new Promise((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(Error('Advertising response timeout.'));},timeout);})]);}
 catch(error){void reader.cancel().catch(()=>{});throw error;}
 finally{clearTimeout(timer);}
}
