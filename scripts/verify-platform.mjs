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
 for(const file of ['index.html','auth.html','dashboard.html','supabase-client.mjs','research-lab.html','research-lab.mjs','research-statistics.mjs','research-image-viewer.mjs']){
  const response=await fetchImpl(origin+'/'+file,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('A required public page is unavailable: '+file);
 }
 const backend=await fetchImpl('https://ur-smart-satellite.alialbatekh111.workers.dev/advice/status',{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
 if(!backend.ok||backend.headers.get('access-control-allow-origin')!==origin)throw Error('The backend did not allow the new platform origin.');
 const research=await fetchImpl('https://ur-smart-satellite.alialbatekh111.workers.dev/research/status',{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});
 if(!research.ok||research.headers.get('access-control-allow-origin')!==origin)throw Error('Research backend is unavailable or did not allow the platform origin.');
 const status=await research.json();
 if(status.fee_iqd!==25000||status.manual_admin_approval_required!==true)throw Error('Research backend did not confirm the expected payment gate.');
 return {app_url:origin,release,frontend:true,backend_cors:true,research:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(await verifyPlatform()));}catch(error){console.error(error.message);process.exitCode=1;}}
