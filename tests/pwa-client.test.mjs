import test from 'node:test';
import assert from 'node:assert/strict';
import {createPwaClient} from '../pwa-client.mjs';

class Target {
 constructor(){this.listeners=new Map();}
 addEventListener(name,callback,options){const entries=this.listeners.get(name)||[];entries.push({callback,once:options?.once});this.listeners.set(name,entries);}
 removeEventListener(name,callback){this.listeners.set(name,(this.listeners.get(name)||[]).filter(entry=>entry.callback!==callback));}
 async emit(name,event={}){for(const entry of [...(this.listeners.get(name)||[])]){if(entry.once)this.removeEventListener(name,entry.callback);await entry.callback(event);}}
}
class Element extends Target {
 constructor(){super();this.hidden=false;this.disabled=false;this.textContent='';this.attributes=new Map();this.href='./install.html';}
 setAttribute(name,value){this.attributes.set(name,value);}
 removeAttribute(name){this.attributes.delete(name);}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const event=()=>({defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}});
function fixture({href='https://ur-smart-urfarmiq.pages.dev/install.html',ios=false,standalone=false,readyState='loading',waiting=null,registerError=null}={}){
 const link=new Element(),button=new Element(),notice=new Element(),status=new Element();notice.hidden=true;
 const doc={readyState,querySelectorAll(selector){return {'[data-pwa-install]':[link],'[data-pwa-update]':[button],'[data-pwa-update-notice]':[notice],'[data-pwa-status]':[status]}[selector]||[];}};
 const win=new Target();let reloads=0;win.location={href,reload(){reloads++;}};win.matchMedia=()=>({matches:standalone});
 for(const name of ['localStorage','sessionStorage'])Object.defineProperty(win,name,{get(){assert.fail('PWA bootstrap touched account/device storage');}});
 const registration=new Target();registration.waiting=waiting;registration.installing=null;
 const sw=new Target();sw.controller={};const calls=[];sw.register=async(...args)=>{calls.push(args);if(registerError)throw registerError;return registration;};
 const nav={serviceWorker:sw,userAgent:ios?'Mozilla/5.0 iPhone Safari':'Mozilla/5.0 Chrome',platform:ios?'iPhone':'Linux',maxTouchPoints:ios?5:0};
 const client=createPwaClient({win,doc,nav});
 return {win,doc,nav,sw,registration,link,button,notice,status,client,calls,reloads:()=>reloads};
}

test('registration waits for load, uses a fresh same-origin worker, and is idempotent',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);
 await f.win.emit('load');await tick();await f.client.register();await f.win.emit('load');
 assert.deepEqual(f.calls,[['https://ur-smart-urfarmiq.pages.dev/sw.js',{scope:'https://ur-smart-urfarmiq.pages.dev/',updateViaCache:'none'}]]);
 assert.equal(f.reloads(),0);
});

test('legacy, insecure and unrelated origins do not register a production app worker',async()=>{
 for(const href of ['http://ur-smart-urfarmiq.pages.dev/','https://urfarmiq.github.io/ur-smart-mvp/','https://unrelated.example/']){
  const f=fixture({href});await f.win.emit('load');await tick();assert.equal(f.calls.length,0,href);
 }
 const local=fixture({href:'http://localhost:8123/install.html'});await local.win.emit('load');await tick();assert.equal(local.calls.length,1);
});

test('Safari and unsupported-native-install clicks retain the real guide link',async()=>{
 const f=fixture({ios:true});const click=event();await f.link.emit('click',click);
 assert.equal(click.defaultPrevented,false);assert.equal(f.link.href,'./install.html');assert.match(f.status.textContent,/Safari/);assert.equal(f.link.hidden,false);
});

test('native installation is deferred until a gesture and acceptance is not claimed as finished installation',async()=>{
 const f=fixture();let prompts=0;const pending={...event(),prompt:async()=>{prompts++;},userChoice:Promise.resolve({outcome:'accepted'})};
 await f.win.emit('beforeinstallprompt',pending);assert.equal(pending.defaultPrevented,true);assert.equal(prompts,0);
 const click=event();await f.link.emit('click',click);assert.equal(click.defaultPrevented,true);assert.equal(prompts,1);
 assert.match(f.status.textContent,/وافق المتصفح/);assert.equal(f.link.hidden,false);
 await f.win.emit('appinstalled');assert.equal(f.link.hidden,true);assert.match(f.status.textContent,/تم تثبيت/);
});

test('dismissed one-shot prompts are not replayed and fall back to instructions',async()=>{
 const f=fixture();let prompts=0;await f.win.emit('beforeinstallprompt',{...event(),prompt:async()=>{prompts++;},userChoice:Promise.resolve({outcome:'dismissed'})});
 await f.link.emit('click',event());const next=event();await f.link.emit('click',next);
 assert.equal(prompts,1);assert.equal(next.defaultPrevented,false);assert.match(f.status.textContent,/لاحقًا/);assert.equal(f.link.hidden,false);
});

test('a second click cannot navigate away or open another prompt while the first prompt is open',async()=>{
 const f=fixture();let release,prompts=0;const choice=new Promise(resolve=>{release=resolve;});
 await f.win.emit('beforeinstallprompt',{...event(),prompt:async()=>{prompts++;},userChoice:choice});
 const first=f.link.emit('click',event());await tick();const second=event();await f.link.emit('click',second);
 assert.equal(second.defaultPrevented,true);assert.equal(prompts,1);release({outcome:'dismissed'});await first;
});

test('first activation and waiting updates never reload forms until the user requests the update',async()=>{
 const messages=[],worker={state:'installed',postMessage(message){messages.push(message);}};
 const f=fixture({waiting:worker});await f.sw.emit('controllerchange');assert.equal(f.reloads(),0);
 await f.win.emit('load');await tick();assert.equal(f.notice.hidden,false);assert.deepEqual(messages,[]);assert.equal(f.reloads(),0);
 await f.button.emit('click',event());assert.deepEqual(messages,[{type:'SKIP_WAITING'}]);assert.equal(f.reloads(),0);assert.equal(f.button.disabled,true);
 f.registration.waiting=null;worker.state='activated';await f.sw.emit('controllerchange');assert.equal(f.reloads(),1);assert.equal(f.notice.hidden,true);
 await f.sw.emit('controllerchange');assert.equal(f.reloads(),1);
});

test('activation from another tab clears stale update controls without a reload or a stuck later click',async()=>{
 const worker={state:'installed',postMessage(){assert.fail('An already activated worker received another skip-waiting request');}};
 const f=fixture({waiting:worker});await f.win.emit('load');await tick();assert.equal(f.notice.hidden,false);
 worker.state='activated';f.registration.waiting=null;await f.sw.emit('controllerchange');
 assert.equal(f.notice.hidden,true);assert.equal(f.button.disabled,false);assert.equal(f.reloads(),0);
 await f.button.emit('click',event());assert.equal(f.button.disabled,false);assert.equal(f.reloads(),0);
});

test('standalone mode reports its actual state without requesting another installation',async()=>{
 const f=fixture({standalone:true});assert.equal(f.link.hidden,true);assert.match(f.status.textContent,/كتطبيق مستقل/);assert.equal(f.reloads(),0);
});

test('failed registration and worker messaging leave the site usable and allow a retry',async()=>{
 const offline=fixture({registerError:Error('offline')});await offline.win.emit('load');await tick();assert.match(offline.status.textContent,/تعذر تجهيز/);assert.equal(offline.reloads(),0);assert.equal(offline.link.hidden,false);
 let attempts=0;const worker={state:'installed',postMessage(){if(++attempts===1)throw Error('gone');}};
 const f=fixture({waiting:worker});await f.win.emit('load');await tick();await f.button.emit('click',event());assert.equal(f.button.disabled,false);assert.equal(f.reloads(),0);
 await f.button.emit('click',event());await f.sw.emit('controllerchange');assert.equal(attempts,2);assert.equal(f.reloads(),1);
});

test('disposed listeners cannot install or reload an abandoned page',async()=>{
 const f=fixture();f.client.dispose();await f.win.emit('load');await f.win.emit('appinstalled');await f.sw.emit('controllerchange');
 assert.equal(f.calls.length,0);assert.equal(f.reloads(),0);assert.equal(f.link.hidden,false);
});
