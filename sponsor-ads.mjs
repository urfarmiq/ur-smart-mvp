import {boundedAdJSON,normalizePublicAds} from './monetization-core.mjs';

const RPC='https://ynsmhtsktbubxfhsekjq.supabase.co/rest/v1/rpc/list_public_advertisements';
const KEY='sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc';
export async function fetchPublicAdvertisements(placement,{fetchImpl=globalThis.fetch,signal,now=Date.now}={}){
 if(!['home','services'].includes(placement))throw Error('Unknown advertising placement.');
 const controller=new AbortController(),abort=()=>controller.abort();let timer;
 if(signal?.aborted)throw Error('Advertising lookup cancelled.');else signal?.addEventListener('abort',abort,{once:true});
 const deadline=Date.now()+8000;
 try{
  const response=await Promise.race([fetchImpl(RPC,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,body:JSON.stringify({p_placement:placement})}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Advertising lookup timeout.'));},8000);})]);
  if(!response.ok){if(response.body)void response.body.cancel().catch(()=>{});throw Error('Advertising lookup unavailable.');}
  return normalizePublicAds(await boundedAdJSON(response,16384,Math.max(1,deadline-Date.now())),placement,now());
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export function createSponsorAds({win=globalThis.window,doc=globalThis.document,nav=globalThis.navigator,fetchImpl=globalThis.fetch,now=Date.now}={}){
 if(!win||!doc||!nav)return null;
 const containers=[...doc.querySelectorAll('[data-sponsor-placement]')].filter(node=>['home','services'].includes(node.dataset.sponsorPlacement));
 if(!containers.length)return null;
 let generation=0,controller=null,expiryTimer=null,refreshTimer=null,disposed=false;
 const records=new Map();
 const clear=()=>{for(const container of containers){container.replaceChildren();container.hidden=true;}records.clear();clearTimeout(expiryTimer);};
 const element=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
 function scheduleExpiry(){
  clearTimeout(expiryTimer);const ends=[...records.values()].flat().map(row=>Date.parse(row.ends_at));if(!ends.length)return;
  expiryTimer=setTimeout(()=>{render();},Math.min(2147483647,Math.max(1,Math.min(...ends)-now()+5)));
 }
 function render(){
  for(const container of containers){
   const rows=normalizePublicAds(records.get(container)||[],container.dataset.sponsorPlacement,now());records.set(container,rows);container.replaceChildren();container.hidden=!rows.length;
   for(const row of rows){
    const card=element('article',undefined,'ur-sponsored-card'),badge=element('span','إعلان مدفوع','ur-sponsored-label');
    card.append(badge,element('p',row.company_name,'ur-sponsored-company'),element('h3',row.ad_title),element('p',row.ad_body,'ur-sponsored-copy'));
    const link=element('a','زيارة موقع المعلن ↗','ur-sponsored-link');link.href=row.target_url;link.target='_blank';link.rel='sponsored noopener noreferrer';link.referrerPolicy='no-referrer';card.append(link);container.append(card);
   }
  }
  scheduleExpiry();
 }
 async function refresh(){
  const token=++generation;controller?.abort();clearTimeout(refreshTimer);
  if(disposed||nav.onLine===false){clear();return;}
  if(doc.visibilityState==='hidden')return;
  controller=new AbortController();
  await Promise.allSettled(containers.map(async container=>{
   try{const rows=await fetchPublicAdvertisements(container.dataset.sponsorPlacement,{fetchImpl,signal:controller.signal,now});if(disposed||token!==generation||nav.onLine===false)return;records.set(container,rows);}
   catch{if(!disposed&&token===generation)records.set(container,[]);}
  }));
  if(disposed||token!==generation)return;
  render();refreshTimer=setTimeout(()=>void refresh(),120000);
 }
 const offline=()=>{generation++;controller?.abort();clearTimeout(refreshTimer);clear();};
 const online=()=>void refresh();
 const visibility=()=>{if(doc.visibilityState!=='hidden')void refresh();else{generation++;controller?.abort();clearTimeout(refreshTimer);}};
 win.addEventListener('offline',offline);win.addEventListener('online',online);doc.addEventListener('visibilitychange',visibility);
 clear();const ready=refresh();
 return {ready,refresh,dispose(){disposed=true;generation++;controller?.abort();clearTimeout(refreshTimer);clear();win.removeEventListener('offline',offline);win.removeEventListener('online',online);doc.removeEventListener('visibilitychange',visibility);}};
}

if(typeof window!=='undefined'&&typeof document!=='undefined')createSponsorAds();
