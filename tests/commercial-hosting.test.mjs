import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ensurePagesProject} from '../scripts/ensure-pages-project.mjs';
import {buildPublicSite} from '../scripts/build-public-site.mjs';
import {getRedirectUrl,buildPagesRedirect} from '../scripts/build-pages-redirect.mjs';
import {verifyPlatform} from '../scripts/verify-platform.mjs';

const env={CLOUDFLARE_API_TOKEN:'synthetic-secret-never-logged',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)};
const project={name:'ur-smart-urfarmiq',production_branch:'main',subdomain:'ur-smart-urfarmiq.pages.dev'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

test('free static project creation is narrowly scoped and existing projects are reused',async()=>{
 const calls=[];
 const result=await ensurePagesProject({env,fetchImpl:async(url,options)=>{calls.push({url,options});return calls.length===1?json({success:false},404):json({success:true,result:project});}});
 assert.equal(result.created,true);assert.equal(calls.length,2);
 assert.deepEqual(JSON.parse(calls[1].options.body),{name:project.name,production_branch:'main'});
 assert.ok(calls.every(call=>call.url.startsWith('https://api.cloudflare.com/client/v4/accounts/'+env.CLOUDFLARE_ACCOUNT_ID+'/pages/projects')));
 assert.equal(calls[1].options.method,'POST');
 let requests=0;
 await ensurePagesProject({env,fetchImpl:async()=>{requests++;return json({success:true,result:project});}});
 assert.equal(requests,1);
});

test('permission failures and unexpected hosts stop before publication without printing credentials',async()=>{
 let requests=0;
 await assert.rejects(ensurePagesProject({env,fetchImpl:async()=>{requests++;return json({success:false,errors:[{message:env.CLOUDFLARE_API_TOKEN}]},403);}}),error=>error.message.includes('HTTP 403')&&!error.message.includes(env.CLOUDFLARE_API_TOKEN));
 assert.equal(requests,1);
 await assert.rejects(ensurePagesProject({env,fetchImpl:async()=>json({success:true,result:{...project,subdomain:'untrusted.example'}})}),/expected/);
});

test('static upload excludes backend, functions, credentials and repository files',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'ur-public-'));
 try{
  const source=path.join(temp,'source'),out=path.join(temp,'public');await mkdir(path.join(source,'vendor'),{recursive:true});
  for(const [name,content] of Object.entries({'index.html':'<h1>fixture</h1>','auth.html':'<p>fixture</p>','app.mjs':'export const x=1;','.env':'SECRET','wrangler.jsonc':'{}','satellite-staging-test.html':'diagnostic','README.md':'private notes'}))await writeFile(path.join(source,name),content);
  await mkdir(path.join(source,'functions'));await writeFile(path.join(source,'functions','api.js'),'sensitive backend');
  await writeFile(path.join(source,'vendor','sdk.js'),'/* pinned sdk */');
  await buildPublicSite({sourceDir:source,outDir:out,release:'b'.repeat(40)});
  const files=await readdir(out);assert.ok(files.includes('index.html'));assert.ok(files.includes('vendor'));
  for(const forbidden of ['.env','functions','wrangler.jsonc','README.md','satellite-staging-test.html'])assert.ok(!files.includes(forbidden));
  assert.equal((await readFile(path.join(out,'release.txt'),'utf8')).trim(),'b'.repeat(40));
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('PWA build publishes only explicit icons and compiles a release-bound worker',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'ur-pwa-build-'));
 try{
  const source=path.join(temp,'source'),out=path.join(temp,'public'),release='d'.repeat(40);
  await mkdir(path.join(source,'vendor'),{recursive:true});await mkdir(path.join(source,'icons'));
  const fixtures={'index.html':'<h1>fixture</h1>','manifest.webmanifest':'{"name":"fixture"}','sw.js':"const release='__UR_PWA_RELEASE__';",'pwa-client.mjs':'export const fixture=true;','pwa.css':'body{}','install.html':'<main data-ur-install></main>','offline.html':'<main data-ur-offline></main>'};
  for(const [name,content] of Object.entries(fixtures))await writeFile(path.join(source,name),content);
  const icons=['app-icon.svg','icon-192.png','icon-512.png','maskable-512.png','apple-touch-icon.png'];
  for(const icon of icons)await copyFile(new URL('../icons/'+icon,import.meta.url),path.join(source,'icons',icon));
  await writeFile(path.join(source,'icons','private-image.png'),'private-upload');await writeFile(path.join(source,'icons','secret.key'),'private-key');
  await buildPublicSite({sourceDir:source,outDir:out,release});
  assert.deepEqual((await readdir(path.join(out,'icons'))).sort(),icons.sort());
  assert.equal(await readFile(path.join(out,'sw.js'),'utf8'),"const release='"+release+"';");
  assert.deepEqual(await readFile(path.join(out,'icons','icon-192.png')),await readFile(new URL('../icons/icon-192.png',import.meta.url)));
  const headers=await readFile(path.join(out,'_headers'),'utf8');
  assert.match(headers,/\/sw\.js\n  Cache-Control: no-cache, max-age=0, must-revalidate\n  Service-Worker-Allowed: \//);
  assert.match(headers,/Content-Type: application\/manifest\+json/);assert.match(headers,/\/auth\.html\n  Cache-Control: no-store/);
  await rm(path.join(source,'icons','maskable-512.png'));
  await assert.rejects(buildPublicSite({sourceDir:source,outDir:out,release}),/explicit application icons/);
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('Google verification is static, contains no ad script, and invalid activation cannot publish',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'ur-ad-config-'));
 try{
  const source=path.join(temp,'source'),out=path.join(temp,'public');await mkdir(path.join(source,'vendor'),{recursive:true});
  await writeFile(path.join(source,'index.html'),'<html><head><title>Fixture</title></head><body>Original content</body></html>');
  const google={mode:'verification',publisher_id:'ca-pub-1234567890123456',ad_slot:'',site_approved:false,cmp_ready:false};
  await writeFile(path.join(source,'monetization-config.json'),JSON.stringify({google}));
  await buildPublicSite({sourceDir:source,outDir:out});
  const html=await readFile(path.join(out,'index.html'),'utf8');
  assert.match(html,/name="google-adsense-account" content="ca-pub-1234567890123456"/);assert.doesNotMatch(html,/adsbygoogle\.js|<script/);
  assert.equal(await readFile(path.join(out,'ads.txt'),'utf8'),'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  await writeFile(path.join(source,'monetization-config.json'),JSON.stringify({google:{...google,mode:'active',ad_slot:'1234567890'}}));
  await assert.rejects(buildPublicSite({sourceDir:source,outDir:out}),/approval/);
  await writeFile(path.join(source,'monetization-config.json'),JSON.stringify({google:{...google,mode:'disabled',publisher_id:''}}));
  await buildPublicSite({sourceDir:source,outDir:out});
  assert.doesNotMatch(await readFile(path.join(out,'index.html'),'utf8'),/google-adsense-account/);
  assert.deepEqual((await readFile(path.join(out,'ads.txt'),'utf8')).split('\n').filter(line=>line.trim()&&!line.startsWith('#')),[]);
  await writeFile(path.join(source,'monetization-config.json'),JSON.stringify({google,private_key:'never-publish'}));
  await assert.rejects(buildPublicSite({sourceDir:source,outDir:out}),/public monetization/);
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('old links preserve app routes and existing callbacks on the fixed new hostname',async()=>{
 const target=getRedirectUrl({pathname:'/ur-smart-mvp/field-map.html',search:'?field=abc',hash:'#view'});
 assert.equal(target,'https://ur-smart-urfarmiq.pages.dev/field-map.html?field=abc#view');
 for(const pathname of ['//evil.example/','/ur-smart-mvp//evil.example/','/ur-smart-mvp/%2F%2Fevil.example'])assert.equal(new URL(getRedirectUrl({pathname,search:'?redirect=https://evil.example',hash:'#existing-callback'})).origin,'https://ur-smart-urfarmiq.pages.dev');
 const temp=await mkdtemp(path.join(os.tmpdir(),'ur-redirect-'));
 try{await buildPagesRedirect({outDir:temp});const html=await readFile(path.join(temp,'index.html'),'utf8');assert.match(html,/downloadBackup/);assert.match(html,/migrationNotice/);assert.doesNotMatch(html,/supabase-js|signOut\(/);}finally{await rm(temp,{recursive:true,force:true});}
});

test('release verification requires the new researcher files and actual payment-gated backend',async()=>{
 const origin='https://ur-smart-urfarmiq.pages.dev',release='c'.repeat(40),calls=[];
 const fetchImpl=async url=>{calls.push(String(url));if(String(url).endsWith('/release.txt'))return new Response(release);if(String(url).endsWith('/monetization-config.json'))return new Response(JSON.stringify({google:{mode:'disabled',publisher_id:'',ad_slot:'',site_approved:false,cmp_ready:false}}),{headers:{'content-type':'application/json'}});if(String(url).endsWith('/ads.txt'))return new Response('# No configured publisher\n',{headers:{'content-type':'text/plain'}});if(String(url).includes('/rpc/list_public_advertisements'))return new Response('[]',{headers:{'content-type':'application/json'}});if(String(url).includes('/advertising_orders?'))return new Response('{}',{status:401});if(String(url).endsWith('/manifest.webmanifest'))return new Response(JSON.stringify({name:'UR Smart',short_name:'أور',lang:'ar-IQ',dir:'rtl',display:'standalone',id:'./',scope:'./',start_url:'./',icons:[{src:'./icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'./icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'./icons/maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]}),{headers:{'content-type':'application/manifest+json'}});if(String(url).endsWith('/sw.js'))return new Response("const BUILD_RELEASE='"+release+"';",{headers:{'content-type':'application/javascript','cache-control':'no-cache','service-worker-allowed':'/'}});if(String(url).includes('/icons/')&&String(url).endsWith('.png'))return new Response(await readFile(new URL('../icons/'+String(url).split('/').at(-1),import.meta.url)),{headers:{'content-type':'image/png'}});if(String(url).includes('workers.dev'))return new Response(JSON.stringify({fee_iqd:25000,manual_admin_approval_required:true,available:true,free_tier_confirmed:true,quote_required:true,customer_acceptance_required:true,scheduled_automatically:false,paid_service:true,field_specific:true,automatic_renewal:false}),{headers:{'content-type':'application/json','access-control-allow-origin':origin}});return new Response('fixture');};
 assert.equal((await verifyPlatform({release,fetchImpl,wait:async()=>{}})).research,true);
 assert.ok(calls.some(url=>url.endsWith('/plant-health.html')));assert.ok(calls.some(url=>url.endsWith('/plant-health/status')));assert.ok(calls.some(url=>url.endsWith('/research-lab.html')));assert.ok(calls.some(url=>url.endsWith('/research/status')));
 assert.ok(calls.some(url=>url.endsWith('/products.html')));assert.ok(calls.some(url=>url.endsWith('/admin-products.mjs')));assert.ok(calls.some(url=>url.endsWith('/satellite-access.html')));assert.ok(calls.some(url=>url.endsWith('/satellite/status')));assert.ok(calls.some(url=>url.endsWith('/field-services.html')));assert.ok(calls.some(url=>url.endsWith('/field-service/status')));
 for(const bad of ['missing_page','wrong_gate','plant_unavailable','field_gate','satellite_gate','pwa_manifest','pwa_worker','pwa_icon','advertising_config','advertising_reader']){
  await assert.rejects(verifyPlatform({release,wait:async()=>{},fetchImpl:async(url,options)=>{
   if(bad==='advertising_config'&&String(url).endsWith('/monetization-config.json'))return new Response('{\"google\":{\"mode\":\"active\"}}',{headers:{'content-type':'application/json'}});
   if(bad==='advertising_reader'&&String(url).includes('/rpc/list_public_advertisements'))return new Response('[{\"contact_phone\":\"must-not-be-public\"}]',{headers:{'content-type':'application/json'}});
   if(bad==='pwa_manifest'&&String(url).endsWith('/manifest.webmanifest'))return new Response('{}',{headers:{'content-type':'application/manifest+json'}});
   if(bad==='pwa_worker'&&String(url).endsWith('/sw.js'))return new Response('const release=\"__UR_PWA_RELEASE__\";',{headers:{'content-type':'application/javascript','cache-control':'no-cache','service-worker-allowed':'/'}});
   if(bad==='pwa_icon'&&String(url).endsWith('/icons/icon-192.png'))return new Response('invalid',{headers:{'content-type':'image/png'}});
   if(bad==='missing_page'&&String(url).endsWith('/research-lab.html'))return new Response('',{status:404});
   if(bad==='wrong_gate'&&String(url).endsWith('/research/status'))return new Response(JSON.stringify({fee_iqd:1,manual_admin_approval_required:false}),{headers:{'content-type':'application/json','access-control-allow-origin':origin}});
   if(bad==='plant_unavailable'&&String(url).endsWith('/plant-health/status'))return new Response(JSON.stringify({available:false,free_tier_confirmed:true}),{headers:{'content-type':'application/json','access-control-allow-origin':origin}});
   if(bad==='satellite_gate'&&String(url).endsWith('/satellite/status'))return new Response(JSON.stringify({paid_service:false,manual_admin_approval_required:false}),{headers:{'content-type':'application/json','access-control-allow-origin':origin}});
   if(bad==='field_gate'&&String(url).endsWith('/field-service/status'))return new Response(JSON.stringify({available:true,manual_admin_approval_required:false}),{headers:{'content-type':'application/json','access-control-allow-origin':origin}});
   return fetchImpl(url,options);
  }}),/required public page|payment gate|free-tier|PWA|Monetization/);
 }
});
