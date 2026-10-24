import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateEntry,validateBackup,localKey} from '../operations-core.mjs';
const entry={date:'2026-10-25',type:'ري',notes:'  تشغيل 30 دقيقة  '};
test('operations validate and normalize before save',()=>{assert.equal(validateEntry(entry).notes,'تشغيل 30 دقيقة');for(const change of [{date:'2026-02-30'},{date:'invalid'},{type:'invalid'},{notes:' '},{notes:'a'.repeat(1001)}])assert.throws(()=>validateEntry({...entry,...change}));});
test('backup roundtrip stays scoped to selected field',()=>{const b={version:1,field_id:'field1',operations:[entry]};assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(b)),'field1'),[validateEntry(entry)]);assert.throws(()=>validateBackup(b,'field2'));assert.throws(()=>validateBackup({...b,operations:[{}]},'field1'));assert.throws(()=>validateBackup({...b,version:2},'field1'));});
test('local storage separates account and field',()=>{assert.notEqual(localKey('user1','field1'),localKey('user2','field1'));assert.notEqual(localKey('user1','field1'),localKey('user1','field2'));assert.throws(()=>localKey(null,'field1'));});
