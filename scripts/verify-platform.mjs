import {pathToFileURL} from 'node:url';
export async function verifyPlatform({release=process.env.GITHUB_SHA,fetchImpl=globalThis.fetch,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(!/^[a-f0-9]{40}$/i.test(release||''))throw Error('A deployment commit is required.');
 const origin='https://ur-smart-urfarmiq.pages.dev';
 let published=false;
 for(let attempt=0;attempt<8;attempt++){
  try{const response=await fetchImpl(origin+'/release.txt',{cache:'no-store',signal:AbortSignal.timeout(15000)});published=response.ok&&(await response.text()).trim()===release;}catch{}
  if(published)break;
  await wait(4000);
 }
 if(!published)throw Error('The new Pages hostname has not served the expected deployment. The GitHub redirect must stay unpublished.');
 for(const file of ['index.html','auth.html','dashboard.html','supabase-client.mjs','research-lab.html','research-lab.mjs','research-statistics.mjs','research-image-viewer.mjs','services.html','farm-budget.html','farm-budget.mjs','season-economics.mjs','weather.html','weather.mjs','weather-core.mjs','dashboard-weather.mjs','plant-health.html','plant-health.css','plant-health.mjs','field-services.html','field-services.css','field-services.mjs','admin-field-services.mjs','satellite-access.html','satellite-access.css','satellite-access.mjs','admin-satellite-access.mjs','satellite-payment.mjs','products.html','products.css','products.mjs','catalog.mjs','admin-products.mjs','install.html','offline.html','pwa-client.mjs','pwa.css','icons/app-icon.svg']){
  const response=await fetchImpl(origin+'/'+file,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('A required public page is unavailable: '+file);
 }
 const manifestResponse=await fetchImpl(origin+'/manifest.webmanifest',{signal:AbortSignal.timeout(15000)});
 if(!manifestResponse.ok||!/^application\/(?:manifest\+json|json)(?:;|$)/i.test(manifestResponse.headers.get('content-type')||''))throw Error('PWA manifest is unavailable or has an invalid content type.');
 const manifest=await manifestResponse.json();
 if(manifest.display!=='standalone'||manifest.dir!=='rtl'||!String(manifest.lang||'').startsWith('ar')||!manifest.name||!manifest.short_name||new URL(manifest.id||'missing',origin+'/manifest.webmanifest').href!==origin+'/'||new URL(manifest.start_url||'missing',origin+'/manifest.webmanifest').href!==origin+'/'||new URL(manifest.scope||'missing',origin+'/manifest.webmanifest').href!==origin+'/')throw Error('PWA manifest did not confirm the Arabic standalone application and its scope.');
 const iconSizes=[['icons/icon-192.png',192,'any'],['icons/icon-512.png',512,'any'],['icons/maskable-512.png',512,'maskable'],['icons/apple-touch-icon.png',180,null]];
 for(const [file,size,purpose] of iconSizes){
  if(purpose&&!(manifest.icons||[]).some(icon=>new URL(icon.src,origin+'/manifest.webmanifest').href===origin+'/'+file&&icon.sizes===size+'x'+size&&icon.type==='image/png'&&(icon.purpose||'any').split(/\s+/).includes(purpose)))throw Error('PWA manifest is missing a required application icon.');
  const response=await fetchImpl(origin+'/'+file,{signal:AbortSignal.timeout(15000)});
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(!response.ok||!/^image\/png(?:;|$)/i.test(response.headers.get('content-type')||'')||bytes.length<24||![137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)||new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(16)!==size||new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(20)!==size)throw Error('PWA icon is unavailable or has incorrect dimensions: '+file);
 }
 const workerResponse=await fetchImpl(origin+'/sw.js',{cache:'no-store',signal:AbortSignal.timeout(15000)}),workerSource=await workerResponse.text();
 if(!workerResponse.ok||!/(?:java|ecma)script/i.test(workerResponse.headers.get('content-type')||'')||!/(?:no-cache|no-store)/i.test(workerResponse.headers.get('cache-control')||'')||workerResponse.headers.get('service-worker-allowed')!=='/'||!workerSource.includes(release)||workerSource.includes('__UR_PWA_RELEASE__'))throw Error('PWA worker is not the expected fresh, release-bound deployment.');
 const backend=await fetchImpl('https://ur-smart-satellite.alialbatekh111.workers.dev/advice/status',{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
 if(!backend.ok||backend.headers.get('access-control-allow-origin')!==origin)throw Error('The backend did not allow the new platform origin.');
 const research=await fetchImpl('https://ur-smart-satellite.alialbatekh111.workers.dev/research/status',{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
 if(!research.ok||research.headers.get('access-control-allow-origin')!==origin)throw Error('Research backend is unavailable or did not allow the platform origin.');
 const status=await research.json();
 if(status.fee_iqd!==25000||status.manual_admin_approval_required!==true)throw Error('Research backend did not confirm the expected payment gate.');
 const plant=await fetchImpl('https://ur-smart-satellite.alialbatekh111.workers.dev/plant-health/status',{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
 if(!plant.ok||plant.headers.get('access-control-allow-origin')!==origin)throw Error('Plant health backend is unavailable or did not allow the platform origin.');
 const plantStatus=await plant.json();
 if(plantStatus.available!==true||plantStatus.free_tier_confirmed!==true)throw Error('Plant health service did not confirm its existing free-tier configuration.');
 const paid=await fetchImpl('https://ur-smart-satellite.alialbatekh111.workers.dev/field-service/status',{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
 if(!paid.ok||paid.headers.get('access-control-allow-origin')!==origin)throw Error('Paid field service is unavailable or did not allow the platform origin.');
 const paidStatus=await paid.json();
 if(paidStatus.available!==true||paidStatus.manual_admin_approval_required!==true||paidStatus.quote_required!==true||paidStatus.customer_acceptance_required!==true||paidStatus.scheduled_automatically!==false)throw Error('Paid field service did not confirm the quote and payment gate.');
 const satellite=await fetchImpl('https://ur-smart-satellite.alialbatekh111.workers.dev/satellite/status',{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
 if(!satellite.ok||satellite.headers.get('access-control-allow-origin')!==origin)throw Error('Satellite access service is unavailable or did not allow the platform origin.');
 const satelliteStatus=await satellite.json();
 if(satelliteStatus.available!==true||satelliteStatus.paid_service!==true||satelliteStatus.manual_admin_approval_required!==true||satelliteStatus.quote_required!==true||satelliteStatus.customer_acceptance_required!==true||satelliteStatus.field_specific!==true||satelliteStatus.automatic_renewal!==false)throw Error('Satellite service did not confirm the field-specific quote and payment gate.');
 return {app_url:origin,release,frontend:true,pwa:true,backend_cors:true,research:true,plant_health:true,paid_field_services:true,paid_satellite:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(await verifyPlatform()));}catch(error){console.error(error.message);process.exitCode=1;}}
