import test from 'node:test';
import assert from 'node:assert/strict';
import {accountCacheKey,readAccountCache} from '../account-cache.mjs';
import {
 MAX_BACKUP_BYTES,MAX_BACKUP_ENTRIES,isAllowedLocalDataKey,
 createLocalDataBackup,parseLocalDataBackup,restoreLocalDataBackup
} from '../local-data.mjs';

const createdAt='2026-10-29T00:00:00.000Z';
const operationKey=(field='field-a',user='user-a')=>`ur-smart-operations-v1:${user}:${field}`;
const backup=entries=>({format:'ur-smart-local-backup',version:1,created_at:createdAt,entries});
const entry=(key,value='[]')=>({key,value});
function memory(initial=[],failWrite=()=>false){
 const values=new Map(initial),reads=[],writes=[],removals=[];
 return {
  values,reads,writes,removals,
  get length(){return values.size;},
  key(index){return [...values.keys()][index]??null;},
  getItem(key){reads.push(key);return values.get(key)??null;},
  setItem(key,value){writes.push(key);if(failWrite(key)){const error=Error('Storage full');error.name='QuotaExceededError';throw error;}values.set(key,value);},
  removeItem(key){removals.push(key);values.delete(key);}
 };
}

test('the migration allowlist matches only the application records and exact account namespaces',()=>{
 const allowed=[
  'ur-smart-fields',operationKey(),
  accountCacheKey('ur-smart-field-map-v1','مزارع/أ'),
  accountCacheKey('ur-smart-satellite-history-v1','user:a')
 ];
 for(const key of allowed)assert.equal(isAllowedLocalDataKey(key),true,key);
 const forbidden=[
  'sb-project-auth-token','supabase.auth.token','auth','session','password','jwt',
  'unrelated-store','ur-smart-fields-extra','ur-smart-field-map-v1',
  'ur-smart-satellite-history-v1','ur-smart-operations-v1',
  'ur-smart-operations-v1:user','ur-smart-operations-v1:user:field:extra',
  'ur-smart-operations-v1::field','ur-smart-operations-v1:user:',
  operationKey('field','x'.repeat(257)),operationKey('field','bad\nuser'),
  'ur-smart-field-map-v1:account:',
  'ur-smart-field-map-v1:account:%61',
  'ur-smart-field-map-v1:account:%GG',
  'ur-smart-field-map-v1:account:%20user',
  'ur-smart-field-map-v1:account:user%0A',
  'ur-smart-field-map-v2:account:user',
  'ur-smart-satellite-history-v1:account:user:extra',
  null,undefined,{},3
 ];
 for(const key of forbidden)assert.equal(isAllowedLocalDataKey(key),false,String(key));
});

test('export never reads credentials or unrelated values and leaves the old origin unchanged',()=>{
 const app=[
  ['ur-smart-fields',' [ { "name" : "حقل قديم" } ] '],
  [operationKey(),' { "version":1, "field_id":"field-a", "operations":[] } '],
  [accountCacheKey('ur-smart-field-map-v1','user-a'),'{"version":1,"owner_id":"user-a","value":{"name":"حقل أ"}}'],
  [accountCacheKey('ur-smart-satellite-history-v1','user-a'),'{"version":1,"owner_id":"user-a","value":[]}']
 ];
 const credentials=[['sb-project-auth-token','secret token'],['password','do not read'],['another-app','private']];
 const storage=memory([...credentials,...app]),before=[...storage.values];
 const getItem=storage.getItem.bind(storage);
 storage.getItem=key=>{assert.ok(isAllowedLocalDataKey(key),'A forbidden storage value was read');return getItem(key);};
 const result=createLocalDataBackup(storage,{createdAt});
 assert.equal(result.format,'ur-smart-local-backup');assert.equal(result.version,1);assert.equal(result.created_at,createdAt);
 assert.deepEqual(new Map(result.entries.map(({key,value})=>[key,value])),new Map(app));
 assert.deepEqual(new Set(storage.reads),new Set(app.map(([key])=>key)));
 assert.deepEqual([...storage.values],before);assert.deepEqual(storage.writes,[]);assert.deepEqual(storage.removals,[]);
 assert.equal(JSON.stringify(result).includes('secret token'),false);
});

test('valid app JSON values keep their exact strings through backup, parsing and restore',()=>{
 const entries=[entry('ur-smart-fields',' \n [ { "name": "حقل", "area": 2 } ] \n '),entry(operationKey(),'null')];
 const parsed=parseLocalDataBackup(JSON.stringify(backup(entries)));
 assert.deepEqual(parsed.entries,entries);
 const destination=memory();const report=restoreLocalDataBackup(destination,parsed);
 assert.equal(report.restored,2);assert.equal(report.skipped,0);assert.equal(report.failed,0);assert.equal(report.total,2);assert.equal(report.stopped,false);
 for(const item of entries)assert.equal(destination.values.get(item.key),item.value);
 assert.deepEqual(destination.removals,[]);
});

test('legacy corrupt and empty raw values survive export and restore without deletion or repair',()=>{
 const records=[
  ['ur-smart-fields',' {broken legacy data '],
  [operationKey('empty'),''],
  [accountCacheKey('ur-smart-satellite-history-v1','user-a'),'undefined']
 ];
 const source=memory(records),before=[...source.values];
 const exported=createLocalDataBackup(source,{createdAt});
 const parsed=parseLocalDataBackup(JSON.stringify(exported));
 assert.deepEqual(parsed.entries,records.map(([key,value])=>({key,value})));
 const destination=memory(),report=restoreLocalDataBackup(destination,parsed);
 assert.equal(report.restored,3);assert.equal(report.failed,0);assert.equal(report.skipped,0);
 assert.deepEqual([...destination.values],records);
 assert.deepEqual([...source.values],before);assert.deepEqual(source.writes,[]);assert.deepEqual(source.removals,[]);
 assert.deepEqual(destination.removals,[]);
});

test('a forged credential entry rejects the whole import before any storage writes',()=>{
 const original='[{"name":"existing"}]',storage=memory([['ur-smart-fields',original]]),before=[...storage.values];
 for(const forbidden of ['sb-project-auth-token','auth','session','password','other-app']){
  const forged=backup([entry(operationKey()),entry(forbidden,'{"token":"secret"}')]);
  assert.throws(()=>parseLocalDataBackup(JSON.stringify(forged)));
  assert.throws(()=>restoreLocalDataBackup(storage,forged));
  assert.deepEqual(storage.writes,[]);assert.deepEqual([...storage.values],before);
 }
});

test('conflicts are counted and skipped without overwriting or removing existing records',()=>{
 const stored='[{"name":"existing destination field"}]',storage=memory([['ur-smart-fields',stored]]);
 const report=restoreLocalDataBackup(storage,backup([entry('ur-smart-fields','[{"name":"imported"}]'),entry(operationKey())]));
 assert.equal(report.restored,1);assert.equal(report.skipped,1);assert.equal(report.failed,0);assert.equal(report.total,2);assert.equal(report.stopped,false);
 assert.equal(storage.values.get('ur-smart-fields'),stored);assert.deepEqual(storage.writes,[operationKey()]);assert.deepEqual(storage.removals,[]);
});

test('a quota failure reports the successful subset and preserves conflicts and untouched entries',()=>{
 const conflict=operationKey('existing'),fail=operationKey('full'),unattempted=operationKey('later');
 const storage=memory([[conflict,'{"existing":true}']],key=>key===fail);
 const report=restoreLocalDataBackup(storage,backup([entry('ur-smart-fields'),entry(conflict),entry(fail),entry(unattempted)]));
 assert.equal(report.restored,1);assert.equal(report.skipped,1);assert.equal(report.failed,2);assert.equal(report.total,4);assert.equal(report.stopped,true);
 assert.equal(storage.values.get('ur-smart-fields'),'[]');assert.equal(storage.values.get(conflict),'{"existing":true}');
 assert.equal(storage.values.has(fail),false);assert.equal(storage.values.has(unattempted),false);
 assert.deepEqual(storage.writes,['ur-smart-fields',fail]);assert.deepEqual(storage.removals,[]);
});

test('invalid backup format, duplicate keys and nonstring raw values cannot partially restore',()=>{
 const valid=entry(operationKey());
 const invalid=[
  {...backup([valid]),format:'another-format'},
  {...backup([valid]),version:2},
  {...backup([valid]),entries:{}},
  backup([valid,valid]),
  backup([valid,{key:'ur-smart-fields',value:{data:[]}}]),
  backup([valid,null])
 ];
 for(const value of invalid){
  const storage=memory();
  assert.throws(()=>parseLocalDataBackup(JSON.stringify(value)));
  assert.throws(()=>restoreLocalDataBackup(storage,value));
  assert.deepEqual(storage.writes,[]);assert.equal(storage.values.size,0);
 }
 for(const text of ['', '{broken', 'null', '[]'])assert.throws(()=>parseLocalDataBackup(text));
});

test('entry and file bounds apply to export, parsed input and direct restore',()=>{
 assert.equal(MAX_BACKUP_BYTES,4*1024*1024);assert.equal(MAX_BACKUP_ENTRIES,500);
 const tooMany=Array.from({length:MAX_BACKUP_ENTRIES+1},(_,index)=>entry(operationKey(`field-${index}`)));
 assert.throws(()=>parseLocalDataBackup(JSON.stringify(backup(tooMany))));
 const destination=memory();assert.throws(()=>restoreLocalDataBackup(destination,backup(tooMany)));assert.deepEqual(destination.writes,[]);
 assert.throws(()=>createLocalDataBackup(memory(tooMany.map(({key,value})=>[key,value])),{createdAt}));
 const largeValue=JSON.stringify('x'.repeat(MAX_BACKUP_BYTES));
 const largeBackup=backup([entry('ur-smart-fields',largeValue)]);
 assert.throws(()=>parseLocalDataBackup(JSON.stringify(largeBackup)));
 assert.throws(()=>restoreLocalDataBackup(destination,largeBackup));assert.deepEqual(destination.writes,[]);
 assert.throws(()=>createLocalDataBackup(memory([['ur-smart-fields',largeValue]]),{createdAt}));
});

test('the 4 MiB limit counts UTF-8 bytes rather than JavaScript string characters',()=>{
 const value=JSON.stringify('ح'.repeat(Math.floor(MAX_BACKUP_BYTES*.55)));
 const text=JSON.stringify(backup([entry('ur-smart-fields',value)]));
 assert.ok(text.length<MAX_BACKUP_BYTES);assert.ok(Buffer.byteLength(text,'utf8')>MAX_BACKUP_BYTES);
 assert.throws(()=>parseLocalDataBackup(text));
 const destination=memory();assert.throws(()=>restoreLocalDataBackup(destination,backup([entry('ur-smart-fields',value)])));assert.deepEqual(destination.writes,[]);
 assert.throws(()=>createLocalDataBackup(memory([['ur-smart-fields',value]]),{createdAt}));
});

test('restored account envelopes retain owner checks and remain hidden from another account',()=>{
 const namespace='ur-smart-field-map-v1',owner='first-user',key=accountCacheKey(namespace,owner);
 const raw=' {"version":1,"owner_id":"first-user","value":{"name":"حقل خاص"}} ';
 const destination=memory();restoreLocalDataBackup(destination,parseLocalDataBackup(JSON.stringify(backup([entry(key,raw)]))));
 assert.equal(destination.values.get(key),raw);
 assert.deepEqual(readAccountCache(destination,namespace,owner),{name:'حقل خاص'});
 assert.equal(readAccountCache(destination,namespace,'second-user'),null);
 const forgedOwner=accountCacheKey(namespace,'other-user');
 restoreLocalDataBackup(destination,backup([entry(forgedOwner,raw)]));
 assert.throws(()=>readAccountCache(destination,namespace,'other-user'));
 assert.equal(destination.values.get(forgedOwner),raw);
});
