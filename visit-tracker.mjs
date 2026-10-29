// Aggregate page views only. Never attach account, URL query, or visitor identifiers.
const HOSTS=new Map([['https://urfarmiq.github.io','/ur-smart-mvp/'],['https://ur-smart-urfarmiq.pages.dev','/']]);
const ENDPOINT='https://ynsmhtsktbubxfhsekjq.supabase.co/rest/v1/rpc/record_site_visit';
const PUBLIC_KEY='sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc';
const PAGES=new Map([
 ['','home'],['index.html','home'],['dashboard.html','dashboard'],
 ['field-map.html','field-map'],['field-analysis.html','field-analysis'],
 ['satellite-analysis.html','satellite-analysis'],['operations.html','operations'],
 ['weather.html','weather']
]);

export function pageForVisit(address,privacy={}){
 if(String(privacy.doNotTrack)==='1'||privacy.globalPrivacyControl===true)return null;
 try{
  const url=new URL(address);
  const base=HOSTS.get(url.origin);
  if(!base||!url.pathname.startsWith(base)||url.username||url.password)return null;
  return PAGES.get(url.pathname.slice(base.length))||null;
 }catch{return null;}
}

export function buildVisitRequest(address,privacy={}){
 const page=pageForVisit(address,privacy);
 if(!page)return null;
 return {
  url:ENDPOINT,
  options:{
   method:'POST',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',
   cache:'no-store',keepalive:true,
   headers:{'Content-Type':'application/json',apikey:PUBLIC_KEY},
   body:JSON.stringify({p_page:page})
  }
 };
}

async function recordPageView(){
 const counted=Symbol.for('ur-smart.aggregate-page-view');
 if(window[counted])return;
 const request=buildVisitRequest(window.location.href,navigator);
 if(!request)return;
 window[counted]=true;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
 try{await fetch(request.url,{...request.options,signal:controller.signal});}
 catch{/* Analytics must never block or change the platform's functions. */}
 finally{clearTimeout(timeout);}
}

if(typeof window!=='undefined'&&typeof document!=='undefined'){
 if(document.visibilityState==='hidden'){
  const onVisible=()=>{
   if(document.visibilityState!=='visible')return;
   document.removeEventListener('visibilitychange',onVisible);
   void recordPageView();
  };
  document.addEventListener('visibilitychange',onVisible);
 }else void recordPageView();
}
