import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {accountCacheKey,readAccountCache,writeAccountCache} from '../account-cache.mjs';

function memory(initial=[]){
 const values=new Map(initial),reads=[],writes=[];
 return {values,reads,writes,getItem(key){reads.push(key);return values.get(key)??null;},setItem(key,value){writes.push(key);values.set(key,value);}};
}

test('account cache reads only its owner key and never migrates or changes legacy device records',()=>{
 for(const namespace of ['ur-smart-field-map-v1','ur-smart-satellite-history-v1']){
  const legacy='{"private":"unassigned legacy data"}',storage=memory([[namespace,legacy]]);
  const value={name:'حقل الحساب الأول',geometry:{type:'Polygon'}};
  writeAccountCache(storage,namespace,'test-user',value);
  assert.deepEqual(readAccountCache(storage,namespace,'test-user'),value);
  assert.equal(readAccountCache(storage,namespace,'other-user'),null);
  assert.equal(storage.values.get(namespace),legacy);assert.ok(!storage.reads.includes(namespace));assert.ok(!storage.writes.includes(namespace));
 }
});

test('encoded identities and namespaces cannot overlap another account cache key',()=>{
 const keys=['a:b','a%3Ab','a/b','a?b','مزارع'].map(id=>accountCacheKey('ur-smart-field-map-v1',id));
 assert.equal(new Set(keys).size,keys.length);
 assert.notEqual(accountCacheKey('a:account:b','c'),accountCacheKey('a','b:account:c'));
 const storage=memory();for(const id of ['',null,undefined,{},'   ',' user','user\n', 'x'.repeat(257)])assert.throws(()=>readAccountCache(storage,'map',id));
 assert.equal(storage.reads.length,0);
});

test('mismatched owner and malformed JSON stay untouched and cannot become visible data',()=>{
 const key=accountCacheKey('map','other-user'),badOwner=JSON.stringify({version:1,owner_id:'test-user',value:{private:'account one'}});
 const storage=memory([[key,badOwner]]);
 assert.throws(()=>readAccountCache(storage,'map','other-user'),/تعذر قراءة/);assert.equal(storage.values.get(key),badOwner);
 storage.values.set(key,'{broken');assert.throws(()=>readAccountCache(storage,'map','other-user'));assert.equal(storage.values.get(key),'{broken');
 assert.equal(storage.writes.length,0);
 assert.throws(()=>writeAccountCache({setItem(){throw Error('storage full');}},'map','test-user',{name:'retained'}),/storage full/);
});

const mapHtml=await readFile(new URL('../field-map.html',import.meta.url),'utf8');
const satelliteHtml=await readFile(new URL('../satellite-analysis.html',import.meta.url),'utf8');

test('map save and restore require the authenticated account and do not read legacy global data',()=>{
 const nodes=new Map(),storage=memory([['ur-smart-field-map-v1','{"name":"other legacy map"}']]);
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',querySelectorAll:()=>[]});return nodes.get(id);};
 const context=vm.createContext({$:node,localStorage:storage,writeAccountCache,readAccountCache,cloudUser:null,points:[]});
 const handlers=mapHtml.slice(mapHtml.indexOf("$('save').onclick="),mapHtml.indexOf("$('export').onclick="));
 vm.runInContext(handlers,context);node('save').onclick();node('load').onclick();
 assert.match(node('status').textContent,/سجّل الدخول/);assert.equal(storage.reads.length,0);assert.equal(storage.writes.length,0);
 context.cloudUser={id:'test-user'};node('load').onclick();assert.match(node('status').textContent,/لا توجد حدود محلية/);
 assert.deepEqual(storage.reads,[accountCacheKey('ur-smart-field-map-v1','test-user')]);
 assert.equal(storage.values.get('ur-smart-field-map-v1'),'{"name":"other legacy map"}');
});

function privateViewHarness(kind){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'previous-private-value',textContent:'previous-private-text',disabled:false,children:[],replaceChildren(...children){this.children=children;this.textContent='';}});return nodes.get(id);};
 let renders=0,mapDisposals=0,cropClears=0,viewResets=0,handler;
 const auth={onAuthStateChange(callback){handler=callback;},getUser(){throw Error('auth callbacks must not issue Supabase calls');}};
 const context=vm.createContext({$:node,Option:function(label,value){return {label,value};},map:{setView(center,zoom){assert.equal(center.join(','),'32.75,45.3');assert.equal(zoom,12);viewResets++;}},render:()=>renders++,setCropValue:value=>{assert.equal(value,'');cropClears++;},indicatorError:message=>{node('indicatorStatus').textContent=message;},disposeIndicatorMaps:()=>mapDisposals++,cloudClient:{auth},client:{auth}});
 const variables=kind==='map'?"let cloudAuthGeneration=0,cloudUser={id:'account-a'},cloudFields=[{name:'private'}],points=[1,2,3],observedAuthUserId='account-a';":"let authRefreshGeneration=0,analysisRequestGeneration=0,user={id:'account-a'},observedAuthUserId='account-a';";
 vm.runInContext(variables,context);
 const html=kind==='map'?mapHtml:satelliteHtml;
 const start=html.indexOf(kind==='map'?'function clearPrivateMap(':'function clearPrivateAnalysis(');
 const end=html.indexOf(kind==='map'?'async function refreshCloud(':'try{\n const {createClient}',start);
 vm.runInContext(html.slice(start,end),context);
 const callbackStart=html.indexOf(kind==='map'?'cloudClient?.auth.onAuthStateChange?.(':'client.auth.onAuthStateChange?.(');
 const callbackEnd=html.indexOf('});',callbackStart)+3;
 vm.runInContext(html.slice(callbackStart,callbackEnd),context);
 return {context,node,callback:(event,session)=>handler(event,session),counts:()=>({renders,mapDisposals,cropClears,viewResets})};
}

test('map auth callback synchronously clears the former account drawing and private labels',()=>{
 const p=privateViewHarness('map');p.callback('SIGNED_IN',{user:{id:'account-b'}});
 assert.equal(vm.runInContext('cloudUser',p.context),null);assert.equal(vm.runInContext('points.length',p.context),0);
 assert.equal(vm.runInContext('cloudFields.length',p.context),0);assert.equal(vm.runInContext('cloudAuthGeneration',p.context),1);
 for(const id of ['fieldName','notes'])assert.equal(p.node(id).value,'');
 assert.equal(p.counts().renders,1);assert.equal(p.counts().cropClears,1);
 assert.equal(p.counts().viewResets,1);
 p.callback('TOKEN_REFRESHED',{user:{id:'account-b'}});assert.equal(p.counts().renders,1);
 p.callback('SIGNED_OUT',null);assert.equal(p.counts().renders,2);
});

test('satellite auth callback clears protected results and invalidates in-flight analysis',()=>{
 const p=privateViewHarness('satellite');p.callback('SIGNED_OUT',null);
 assert.equal(vm.runInContext('user',p.context),null);assert.equal(vm.runInContext('analysisRequestGeneration',p.context),1);
 assert.equal(vm.runInContext('authRefreshGeneration',p.context),1);assert.equal(p.counts().mapDisposals,1);
 assert.match(p.node('autoResult').textContent,/انتهت الجلسة/);assert.equal(p.node('autoAnalyze').disabled,true);assert.equal(p.node('connectionResult').textContent,'');
});
