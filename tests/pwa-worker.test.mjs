import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../sw.js',import.meta.url),'utf8');
const origin='https://app.test';
const mime=path=>path.endsWith('.css')?'text/css':path.endsWith('.mjs')?'application/javascript':path.endsWith('.png')?'image/png':path.endsWith('.svg')?'image/svg+xml':path.endsWith('.webmanifest')?'application/manifest+json':'text/html';
const content=path=>path.endsWith('/index.html')?'<main id="home">public home</main>':path.endsWith('/services.html')?'<h2 id="servicesTitle">public services</h2>':path.endsWith('/install.html')?'<main data-ur-install>install instructions</main>':path.endsWith('/offline.html')?'<main data-ur-offline>generic offline notice</main>':path.endsWith('/planting-calendar.html')?'<main data-planting-calendar>public planting references</main>':'public asset';

function response(url,body=content(new URL(url).pathname),{status=200,type='default',headers={},redirected=false}={}){
 const value=new Response(body,{status,headers:{'content-type':mime(new URL(url).pathname),...headers}});
 Object.defineProperties(value,{url:{value:url},type:{value:type},redirected:{value:redirected}});
 value.clone=()=>response(url,body,{status,type,headers:Object.fromEntries(value.headers),redirected});
 // Restore body semantics while retaining network metadata on fixture clones.
 return value;
}

function harness({release='release-one',scope=origin+'/',upstream}={}){
 const listeners={},buckets=new Map(),calls=[],deletes=[];let skipped=0,claimed=0;
 const key=v=>typeof v==='string'?v:v.url;
 const caches={
  async has(name){return buckets.has(name);},
  async open(name){if(!buckets.has(name))buckets.set(name,new Map());const data=buckets.get(name);return {async put(request,res){data.set(key(request),res.clone());},async match(request){return data.get(key(request))?.clone();}};},
  async keys(){return [...buckets.keys()];},
  async delete(name){deletes.push(name);return buckets.delete(name);}
 };
 const state={offline:false,network:upstream};
 const fetch=async(request,options)=>{const url=key(request);calls.push({url,request,options});if(state.offline)throw Error('Network unavailable');return state.network?state.network(request,options):response(url);};
 const self={registration:{scope},clients:{async claim(){claimed++;}},async skipWaiting(){skipped++;},addEventListener(name,callback){listeners[name]=callback;}};
 vm.runInNewContext(source.replace('__UR_PWA_RELEASE__',release),{self,caches,fetch,Request,Response,Headers,URL,Map,Uint8Array,TextDecoder,AbortController,setTimeout,clearTimeout});
 async function lifecycle(name,event={}){const work=[];listeners[name]({...event,waitUntil:p=>work.push(Promise.resolve(p))});await Promise.all(work);}
 function dispatch(path,{method='GET',mode='cors',headers={},cache='default',body}={}){
  const url=path.startsWith('http')?path:new URL(path,scope).href;
  const request=new Request(url,{method,headers,cache,...(body===undefined?{}:{body})});Object.defineProperty(request,'mode',{value:mode});
  let promise;listeners.fetch({request,respondWith:p=>{assert.equal(promise,undefined);promise=Promise.resolve(p);}});return promise;
 }
 return {listeners,caches,buckets,calls,deletes,state,lifecycle,dispatch,get skipped(){return skipped;},get claimed(){return claimed;}};
}

test('install validates all public files and activates without forcing an update or touching other caches',async()=>{
 const h=harness();await h.caches.open('another-app-private-cache');await h.caches.open('ur-smart-pwa-old-release');
 await h.lifecycle('install');assert.equal(h.skipped,0);assert.ok(h.buckets.has('ur-smart-pwa-release-one'));
 assert.ok(h.calls.length>=10);assert.ok(h.calls.every(c=>c.request.credentials==='omit'&&c.request.cache==='reload'));
 await h.lifecycle('activate');assert.equal(h.claimed,1);assert.ok(h.buckets.has('another-app-private-cache'));assert.ok(!h.buckets.has('ur-smart-pwa-old-release'));
 assert.deepEqual(h.deletes,['ur-smart-pwa-old-release']);
});

test('missing files, HTML SPA substitutions, private responses and unexpected redirects abort before a partial precache exists',async()=>{
 for(const bad of ['missing','spa','private','no-store','query','cross-origin','wrong-path','opaque']){
  const h=harness({upstream:request=>{
   if(request.url.endsWith('/offline.html')){
    if(bad==='missing')return response(request.url,'missing',{status:404});
    if(bad==='spa')return response(request.url,'<main id="home">wrong page</main>');
    if(bad==='private'||bad==='no-store')return response(request.url,undefined,{headers:{'cache-control':bad}});
    if(bad==='query')return response(request.url+'?token=never-cache');
    if(bad==='cross-origin')return response('https://outside.test/offline.html');
    if(bad==='wrong-path')return response(origin+'/index.html');
    if(bad==='opaque')return response(request.url,undefined,{type:'opaque'});
   }
   return response(request.url);
  }});
  await assert.rejects(h.lifecycle('install'),/Required public app file unavailable/);assert.equal(h.buckets.size,0,bad);
 }
 const h=harness({upstream:request=>request.url.endsWith('.png')?response(request.url,'HTML fallback',{headers:{'content-type':'text/html'}}):response(request.url)});
 await assert.rejects(h.lifecycle('install'));assert.equal(h.buckets.size,0);
});

test('same-origin canonical document aliases are accepted without broadening redirects',async()=>{
 const h=harness({upstream:request=>{
  const original=new URL(request.url).pathname;
  const target=original==='/index.html'?origin+'/':original.endsWith('.html')?request.url.slice(0,-5):request.url;
  return response(target,content(original),{headers:{'content-type':mime(original)},redirected:target!==request.url});
 }});
 await h.lifecycle('install');h.state.offline=true;
 for(const path of ['/','/services','/services.html','/offline','/auth']) {
  const restored=await h.dispatch(path,{mode:'navigate'});
  assert.equal(restored.redirected,false,path);assert.equal(restored.url,'',path);
  const body=await restored.text();assert.match(body,path==='/'?/public home/:path.startsWith('/services')?/public services/:/generic offline/);
 }
});

test('offline public launch works while protected documents always show a generic fallback and are never stored',async()=>{
 const h=harness();await h.lifecycle('install');h.state.network=request=>response(request.url,'<main>Private account information</main>');
 const live=await h.dispatch('/dashboard.html',{mode:'navigate'});assert.match(await live.text(),/Private account/);
 assert.ok(!h.buckets.get('ur-smart-pwa-release-one').has(origin+'/dashboard.html'));
 h.state.offline=true;
 assert.match(await (await h.dispatch('/',{mode:'navigate'})).text(),/public home/);
 for(const path of ['/dashboard.html','/admin','/auth.html','/field-analysis','/research-lab.html','/products']){
  const res=await h.dispatch(path,{mode:'navigate'});const body=await res.text();assert.match(body,/generic offline/);assert.doesNotMatch(body,/Private account/);
 }
 const protectedNoStore=await h.dispatch('/auth',{mode:'navigate',cache:'no-store'});
 assert.match(await protectedNoStore.text(),/generic offline/);
 const keys=[...h.buckets.get('ur-smart-pwa-release-one').keys()];assert.ok(keys.every(path=>!['dashboard','admin','auth','research-lab','products'].some(p=>path.includes(p))));
});

test('account APIs, mutations, bearer headers, callback queries and unknown assets are never intercepted',async()=>{
 const h=harness();
 const cases=[
  ['https://ynsmhtsktbubxfhsekjq.supabase.co/rest/v1/product_inquiries',{}],
  ['https://ur-smart-satellite.alialbatekh111.workers.dev/',{method:'POST',body:'{}'}],
  ['/field-service',{method:'POST',body:'{}'}],
  ['/index.html',{headers:{Authorization:'Bearer private-session'}}],
  ['/index.html?code=private-callback-token',{mode:'navigate'}],
  ['/auth.html?access_token=private-token',{mode:'navigate'}],
  ['/index.html',{cache:'no-store'}],
  ['/saved-report.json',{}],['/photos/private.png',{}],['/vendor/supabase.js',{}]
 ];
 for(const [path,options]of cases)assert.equal(h.dispatch(path,options),undefined,path);
 assert.equal(h.calls.length,0);assert.equal(h.buckets.size,0);
});

test('HTTP authorization and missing-resource failures remain actual responses even with a cached public copy',async()=>{
 const h=harness();await h.lifecycle('install');
 for(const status of [401,403,404,500]){
  h.state.network=request=>response(request.url,'server response '+status,{status});
  for(const [path,mode]of [['/services','navigate'],['/dashboard','navigate'],['/pwa.css','cors']]){
   const r=await h.dispatch(path,{mode});assert.equal(r.status,status);assert.equal(await r.text(),'server response '+status);
  }
 }
});

test('runtime updates cache only approved public responses and missing-cache assets fail without receiving HTML',async()=>{
 const h=harness();await h.lifecycle('install');
 h.state.network=request=>response(request.url,'<h2 id="servicesTitle">new public version</h2>');
 await h.dispatch('/services',{mode:'navigate'});
 h.state.network=request=>response(request.url,'<h2 id="servicesTitle">private response</h2>',{headers:{'cache-control':'private, max-age=60'}});
 await h.dispatch('/services.html',{mode:'navigate'});h.state.offline=true;
 assert.match(await (await h.dispatch('/services',{mode:'navigate'})).text(),/new public version/);
 const empty=harness();empty.state.offline=true;await assert.rejects(empty.dispatch('/pwa.css'));
 const fallback=await empty.dispatch('/admin',{mode:'navigate'});assert.equal(fallback.status,503);assert.match(fallback.headers.get('cache-control'),/no-store/);assert.doesNotMatch(await fallback.text(),/private response/);
});

test('worker update is explicitly requested from an in-scope window and never reloads clients',async()=>{
 const h=harness();const base={origin,source:{type:'window',url:origin+'/install.html'}};
 for(const bad of [{data:{type:'OTHER'}},{data:{type:'SKIP_WAITING',extra:true}},{data:{type:'SKIP_WAITING'},source:{type:'window',url:'https://other.test/'}},{data:{type:'SKIP_WAITING'},source:{type:'serviceworker',url:origin+'/sw.js'}},{data:{type:'SKIP_WAITING'},source:null}]){
  await h.lifecycle('message',{...base,...bad});
 }
 assert.equal(h.skipped,0);await h.lifecycle('message',{...base,data:{type:'SKIP_WAITING'}});assert.equal(h.skipped,1);
 assert.equal(h.claimed,0);
});

test('path scoping confines the cache to this app when mounted under a directory',async()=>{
 const h=harness({scope:origin+'/agriculture/'});await h.lifecycle('install');
 assert.equal(h.dispatch('/services',{mode:'navigate'}),undefined);
 assert.ok(h.calls.every(c=>new URL(c.url).pathname.startsWith('/agriculture/')));
 h.state.offline=true;assert.match(await (await h.dispatch('services',{mode:'navigate'})).text(),/public services/);
});
