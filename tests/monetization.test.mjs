import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateMonetizationConfig,getAdsenseSeller,validateAdTarget,normalizePublicAds,isGoogleBrowserSurface,boundedAdJSON} from '../monetization-core.mjs';
import {createSponsorAds,fetchPublicAdvertisements} from '../sponsor-ads.mjs';
import {createGoogleAds} from '../google-ads.mjs';

const NOW=Date.UTC(2026,10,5,18);
const row=(overrides={})=>({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',company_name:'شركة اختبار زراعي',ad_title:'معدات حقلية تجريبية',ad_body:'نص عرض تجريبي، بلا شراء أو إعلان حقيقي.',target_url:'https://example.com/agriculture',placement:'home',starts_at:new Date(NOW-1000).toISOString(),ends_at:new Date(NOW+86400000).toISOString(),...overrides});
const config=(overrides={})=>({google:{mode:'active',publisher_id:'ca-pub-1234567890123456',ad_slot:'1234567890',site_approved:true,cmp_ready:true,...overrides}});
const response=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

class Target{
 constructor(){this.listeners=new Map();}
 addEventListener(name,callback){const list=this.listeners.get(name)||[];list.push(callback);this.listeners.set(name,list);}
 removeEventListener(name,callback){this.listeners.set(name,(this.listeners.get(name)||[]).filter(item=>item!==callback));}
 async emit(name,event={}){for(const callback of [...(this.listeners.get(name)||[])])await callback(event);}
}
class Element extends Target{
 constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.hidden=false;this._text='';this.parent=null;}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join(' ');}
 set innerHTML(_){assert.fail('Advertising interpreted untrusted content as HTML');}
 setAttribute(name,value){this.attributes[name]=String(value);}
 append(...nodes){for(const child of nodes){child.parent=this;this.children.push(child);}}
 replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
}
const all=element=>[element,...element.children.flatMap(all)];
function fixture({standalone=false,href='https://ur-smart-urfarmiq.pages.dev/',online=true,sponsor=true,google=false}={}){
 const win=new Target(),doc=new Target(),nav={onLine:online,standalone};
 win.location={href};win.matchMedia=query=>({matches:query==='(display-mode: browser)'?!standalone:query==='(display-mode: standalone)'?standalone:false});
 for(const key of ['localStorage','sessionStorage'])Object.defineProperty(win,key,{get(){assert.fail('Advertisements touched account or device storage');}});
 Object.defineProperty(doc,'cookie',{get(){assert.fail('Advertisement loader accessed cookies');},set(){assert.fail('Advertisement loader wrote cookies');}});
 doc.head=new Element('head');doc.visibilityState='visible';doc.createElement=tag=>new Element(tag);
 const sponsors=new Element();sponsors.dataset.sponsorPlacement='home';const googleBox=new Element('section');
 doc.querySelectorAll=selector=>selector==='[data-sponsor-placement]'&&sponsor?[sponsors]:[];
 doc.querySelector=selector=>selector==='[data-google-ads]'&&google?googleBox:null;
 doc.getElementById=id=>[...all(doc.head),...all(sponsors),...all(googleBox)].find(node=>node.id===id)||null;
 return {win,doc,nav,sponsors,googleBox};
}

test('public configuration is disabled without a publisher and rejects secrets or premature activation',async()=>{
 const actual=JSON.parse(await readFile(new URL('../monetization-config.json',import.meta.url),'utf8'));
 assert.equal(validateMonetizationConfig(actual).google.mode,'disabled');assert.equal(getAdsenseSeller(actual),null);
 assert.equal(getAdsenseSeller(config({mode:'verification',ad_slot:'',site_approved:false,cmp_ready:false})),'pub-1234567890123456');
 for(const value of [config({publisher_id:'ca-pub-123'}),config({ad_slot:'abc'}),config({site_approved:false}),config({cmp_ready:false}),config({mode:'verification',publisher_id:''}),{...actual,secret_key:'must-not-be-public'},{google:{...actual.google,service_role:'never'}}])assert.throws(()=>validateMonetizationConfig(value));
 for(const slot of ['1','12345678901234567890'])assert.equal(validateMonetizationConfig(config({ad_slot:slot})).google.ad_slot,slot);
 assert.throws(()=>validateMonetizationConfig(config({ad_slot:'1'.repeat(21)})));
});

test('destination URLs allow public HTTPS domains without credentials, executable schemes or local addresses',()=>{
 assert.equal(validateAdTarget('https://example.com/path?product=seed'),'https://example.com/path?product=seed');
 assert.equal(validateAdTarget('https://xn--mgbh0fb.com/'),'https://xn--mgbh0fb.com/');
 for(const value of ['javascript:alert(1)','data:text/html,x','http://example.com','https://user:password@example.com/','https://localhost/','https://127.0.0.1/','https://[::1]/','https://company.local/','https://company.internal/','https://company.test/','https://company.invalid/','https://example.com:8443/','https://example.com/a b','https://example.com/\n','https://example.com\\@evil.com/','https://example..com/','https://'+'a'.repeat(64)+'.com/'])assert.equal(validateAdTarget(value),null,value);
});

test('only current bounded public campaign fields are accepted and no private order projection is rendered',()=>{
 assert.equal(normalizePublicAds([row()],'home',NOW).length,1);
 for(const bad of [row({ends_at:new Date(NOW).toISOString()}),row({starts_at:new Date(NOW+1000).toISOString()}),row({placement:'services'}),row({owner_id:'private-owner'}),row({quote_iqd:50000}),row({target_url:'javascript:alert(1)'}),row({ad_body:'x'.repeat(801)}),row({ends_at:new Date(NOW+400*86400000).toISOString()})])assert.deepEqual(normalizePublicAds([bad],'home',NOW),[]);
 assert.deepEqual(normalizePublicAds([row(),row(),row(),row()],'home',NOW),[]);
 assert.deepEqual(normalizePublicAds({data:[row()]},'home',NOW),[]);
});

test('public ad lookup sends only placement with anonymous no-store and no-referrer settings',async()=>{
 const calls=[];const result=await fetchPublicAdvertisements('home',{now:()=>NOW,fetchImpl:async(url,options)=>{calls.push({url,options});return response([row()]);}});
 assert.equal(result.length,1);assert.equal(calls.length,1);assert.match(calls[0].url,/\/rest\/v1\/rpc\/list_public_advertisements$/);
 const opts=calls[0].options;assert.deepEqual(JSON.parse(opts.body),{p_placement:'home'});assert.equal(opts.credentials,'omit');assert.equal(opts.cache,'no-store');assert.equal(opts.referrerPolicy,'no-referrer');assert.equal(opts.headers.Authorization,undefined);assert.equal(opts.headers.authorization,undefined);
 await assert.rejects(fetchPublicAdvertisements('private-report',{fetchImpl:()=>assert.fail('Unknown placement reached network')}));
 const controller=new AbortController();controller.abort();await assert.rejects(fetchPublicAdvertisements('home',{signal:controller.signal,fetchImpl:()=>assert.fail('Cancelled lookup reached network')}));
 await assert.rejects(fetchPublicAdvertisements('home',{fetchImpl:async()=>response({error:'private-server-information'},403)}));
});

test('bounded lookups reject oversized or malformed provider bodies',async()=>{
 await assert.rejects(boundedAdJSON(response([row()],200,{'content-length':'20000'})),/large/);
 await assert.rejects(boundedAdJSON(new Response('x'.repeat(17000))),/large/);
 await assert.rejects(boundedAdJSON(new Response('{broken')));
 const stalled=new Response(new ReadableStream({pull(){return new Promise(()=>{});}}));
 await assert.rejects(boundedAdJSON(stalled,16384,15),/timeout/);
});

test('direct advertisements remain text, are labelled sponsored, expire without a tracking event and clear offline',async()=>{
 const f=fixture();let clock=NOW,calls=0;
 const dangerous=row({company_name:'<img src=x onerror=bad()>',ad_title:'<script>bad()</script>',ad_body:'<b>plain creative</b>',ends_at:new Date(NOW+40).toISOString()});
 const client=createSponsorAds({...f,now:()=>clock,fetchImpl:async()=>{calls++;return response([dangerous]);}});
 try{
  await client.ready;assert.equal(f.sponsors.hidden,false);assert.match(f.sponsors.textContent,/إعلان مدفوع/);assert.match(f.sponsors.textContent,/<script>bad/);
  assert.equal(all(f.sponsors).some(node=>['IMG','SCRIPT','IFRAME'].includes(node.tagName)),false);
  const link=all(f.sponsors).find(node=>node.tagName==='A');assert.equal(link.rel,'sponsored noopener noreferrer');assert.equal(link.referrerPolicy,'no-referrer');assert.equal(link.target,'_blank');
  clock=NOW+100;await new Promise(resolve=>setTimeout(resolve,65));assert.equal(f.sponsors.hidden,true);assert.equal(calls,1,'Expiry must not simulate an impression or click');
  clock=NOW;await client.refresh();assert.equal(f.sponsors.hidden,false);f.nav.onLine=false;await f.win.emit('offline');assert.equal(f.sponsors.hidden,true);assert.equal(f.sponsors.children.length,0);
 }finally{client.dispose();}
});

test('late public lookups cannot restore advertisements after offline or disposal',async()=>{
 const f=fixture();let resolve;
 const client=createSponsorAds({...f,now:()=>NOW,fetchImpl:()=>new Promise(done=>{resolve=done;})});
 f.nav.onLine=false;await f.win.emit('offline');resolve(response([row()]));await client.ready;assert.equal(f.sponsors.hidden,true);
 client.dispose();assert.equal(f.sponsors.children.length,0);
});

test('Google is limited to browser-mode production home pages without callback or query context',()=>{
 const f=fixture();assert.equal(isGoogleBrowserSurface(f.win,f.nav),true);
 for(const options of [{standalone:true},{href:'https://ur-smart-urfarmiq.pages.dev/dashboard.html'},{href:'https://ur-smart-urfarmiq.pages.dev/?code=private-token'},{href:'https://ur-smart-urfarmiq.pages.dev/#access_token=private'},{href:'https://evil.example/'},{href:'http://localhost/'}]){const x=fixture(options);assert.equal(isGoogleBrowserSurface(x.win,x.nav),false);}
});

test('disabled and verification modes never create Google network scripts or an empty ad placeholder',async()=>{
 for(const mode of ['disabled','verification']){
  const f=fixture({google:true});let calls=0;const client=createGoogleAds({...f,fetchImpl:async(url,options)=>{calls++;assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');return response(config({mode}));}});
  try{await client.ready;assert.equal(calls,1);assert.equal(f.googleBox.hidden,true);assert.equal(f.doc.head.children.length,0);assert.equal(f.win.adsbygoogle,undefined);}finally{client.dispose();}
 }
 const f=fixture({google:true,standalone:true});const client=createGoogleAds({...f,fetchImpl:()=>assert.fail('Standalone PWA tried Google configuration/network')});await client.ready;client.dispose();
});

test('Google requests follow an explicit one-time choice and do not claim an automatic CMP certification',async()=>{
 const f=fixture({google:true});const client=createGoogleAds({...f,fetchImpl:async()=>response(config())});
 try{
  await client.ready;assert.equal(f.googleBox.hidden,false);assert.equal(f.doc.head.children.length,0);
  const buttons=all(f.googleBox).filter(node=>node.tagName==='BUTTON');assert.equal(buttons.length,2);assert.match(f.googleBox.textContent,/Google/);assert.match(f.googleBox.textContent,/ملفات تعريف الارتباط/);
  await buttons[0].emit('click');await buttons[0].emit('click');assert.equal(f.doc.head.children.length,1);
  const script=f.doc.head.children[0];assert.match(script.src,/^https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-/);assert.equal(script.crossOrigin,'anonymous');assert.equal(f.win.adsbygoogle,undefined,'Loading a script must not fabricate an ad impression');
  script.onload();assert.equal(f.win.adsbygoogle.length,1);assert.deepEqual(f.win.adsbygoogle[0],{});
  const unit=all(f.googleBox).find(node=>node.tagName==='INS');assert.equal(unit.attributes['data-ad-client'],'ca-pub-1234567890123456');assert.equal(unit.attributes['data-ad-slot'],'1234567890');assert.equal(all(f.googleBox).some(node=>node.tagName==='IFRAME'),false,'Do not wrap AdSense in a custom iframe');
 }finally{client.dispose();}
});

test('declining, invalid settings, account unapproval or disposed consent never load Google',async()=>{
 const f=fixture({google:true});const client=createGoogleAds({...f,fetchImpl:async()=>response(config())});await client.ready;
 const buttons=all(f.googleBox).filter(node=>node.tagName==='BUTTON');await buttons[1].emit('click');await buttons[0].emit('click');assert.equal(f.doc.head.children.length,0);assert.equal(f.googleBox.hidden,true);client.dispose();
 for(const bad of [config({site_approved:false}),config({cmp_ready:false}),{google:{...config().google,secret:'never'}}]){const x=fixture({google:true});const c=createGoogleAds({...x,fetchImpl:async()=>response(bad)});await c.ready;assert.equal(x.googleBox.hidden,true);assert.equal(x.doc.head.children.length,0);c.dispose();}
 const x=fixture({google:true});const c=createGoogleAds({...x,fetchImpl:async()=>response(config())});await c.ready;const button=all(x.googleBox).find(node=>node.tagName==='BUTTON');c.dispose();await button.emit('click');assert.equal(x.doc.head.children.length,0);
 await tick();
});

test('offline transition removes Google space and does not queue a late ad load',async()=>{
 const f=fixture({google:true});const client=createGoogleAds({...f,fetchImpl:async()=>response(config())});
 try{
  await client.ready;const allow=all(f.googleBox).find(node=>node.tagName==='BUTTON');await allow.emit('click');const script=f.doc.head.children[0];assert.equal(f.win.adsbygoogle,undefined);
  f.nav.onLine=false;await f.win.emit('offline');script.onload();assert.equal(f.googleBox.hidden,true);assert.equal(f.win.adsbygoogle,undefined);
  f.nav.onLine=true;await allow.emit('click');assert.equal(f.doc.head.children.length,1);assert.equal(f.win.adsbygoogle,undefined);
 }finally{client.dispose();}
});
