import {boundedAdJSON,isGoogleBrowserSurface,validateMonetizationConfig,GOOGLE_ADS_SCRIPT} from './monetization-core.mjs';

// Verification never loads advertisements. Active serving still requires
// approval and consent; this first-party choice does not replace Google's CMP.
export function createGoogleAds({win=globalThis.window,doc=globalThis.document,nav=globalThis.navigator,fetchImpl=globalThis.fetch}={}){
 if(!win||!doc||!nav)return null;
 const container=doc.querySelector('[data-google-ads]');if(!container)return null;
 let disposed=false,chosen=false,offlineStopped=false,script=null,allow=null,decline=null;
 const controller=new AbortController();
 container.hidden=true;container.replaceChildren();
 const offline=()=>{offlineStopped=true;container.replaceChildren();container.hidden=true;};
 win.addEventListener('offline',offline);
 const el=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
 const ready=(async()=>{
  if(!isGoogleBrowserSurface(win,nav)||nav.onLine===false)return;
  let timer;try{
   const response=await Promise.race([fetchImpl(new URL('./monetization-config.json',win.location.href).href,{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Advertising settings timeout.'));},8000);})]);
   if(!response.ok){if(response.body)void response.body.cancel().catch(()=>{});throw Error();}const config=validateMonetizationConfig(await boundedAdJSON(response,4096,8000));
   if(disposed||offlineStopped||nav.onLine===false||config.google.mode!=='active'||!isGoogleBrowserSurface(win,nav))return;
   const g=config.google;
   const heading=el('h2','إعلانات Google'),description=el('p','يمكنك السماح بعرض إعلانات Google في هذه الصفحة. قد تستخدم ملفات تعريف الارتباط وبيانات تقنية وفق إعدادات الخصوصية.'),actions=el('div',undefined,'ur-google-ad-actions'),status=el('p',undefined,'ur-google-ad-status'),privacy=el('a','الخصوصية وخيارات الإعلانات');privacy.href='./privacy.html#advertising';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
   allow=el('button','السماح بعرض إعلانات Google','ur-google-ad-allow');allow.type='button';decline=el('button','المتابعة دون إعلانات Google','ur-google-ad-decline');decline.type='button';actions.append(allow,decline);container.append(heading,description,actions,privacy,status);container.hidden=false;
   const reject=()=>{if(chosen)return;chosen=true;container.replaceChildren();container.hidden=true;};
   const accept=()=>{
    if(disposed||chosen||offlineStopped||nav.onLine===false||!isGoogleBrowserSurface(win,nav))return;
    chosen=true;allow.disabled=true;decline.disabled=true;
    if(doc.getElementById('ur-google-adsense-script')){status.textContent='تعذر تجهيز مساحة الإعلان الآن.';return;}
    const unit=el('ins',undefined,'adsbygoogle ur-google-ad-unit');unit.setAttribute('data-ad-client',g.publisher_id);unit.setAttribute('data-ad-slot',g.ad_slot);unit.setAttribute('data-ad-format','auto');unit.setAttribute('data-full-width-responsive','true');
    actions.remove();container.append(unit);status.textContent='جارٍ تحميل مساحة الإعلان…';
    script=el('script');script.id='ur-google-adsense-script';script.async=true;script.crossOrigin='anonymous';script.referrerPolicy='no-referrer';script.src=GOOGLE_ADS_SCRIPT+'?client='+encodeURIComponent(g.publisher_id);
    script.onload=()=>{if(disposed||offlineStopped||nav.onLine===false)return;try{win.adsbygoogle=win.adsbygoogle||[];win.adsbygoogle.push({});status.textContent='';}catch{status.textContent='لم تتوفر مساحة إعلان الآن.';unit.remove();}};
    script.onerror=()=>{if(!disposed){status.textContent='لم يتوفر إعلان الآن. يمكنك متابعة استخدام المنصة.';unit.remove();}};
    doc.head.append(script);
   };
   allow.addEventListener('click',accept);decline.addEventListener('click',reject);
  }catch{container.replaceChildren();container.hidden=true;}
  finally{clearTimeout(timer);}
 })();
 return {ready,dispose(){disposed=true;controller.abort();win.removeEventListener('offline',offline);if(script){script.onload=null;script.onerror=null;}container.replaceChildren();container.hidden=true;}};
}

if(typeof window!=='undefined'&&typeof document!=='undefined')createGoogleAds();
