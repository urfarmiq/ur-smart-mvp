import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {withDeadline,RequestDeadlineError} from '../request-deadline.mjs';

test('a stalled request leaves the loading state and a late result cannot resume it',async()=>{
 let resolve,painted=false;
 const request=new Promise(done=>{resolve=done;});
 const pending=withDeadline(request,5).then(()=>{painted=true;});
 await assert.rejects(pending,RequestDeadlineError);
 resolve({session:'late synthetic response'});
 await Promise.resolve();
 assert.equal(painted,false);
});

test('successful responses and provider errors retain their result',async()=>{
 const result={session:null};
 assert.equal(await withDeadline(Promise.resolve(result),50),result);
 const failure=Error('synthetic provider failure');
 await assert.rejects(withDeadline(Promise.reject(failure),50),error=>error===failure);
});

test('local login SDK matches its pinned upstream release',async()=>{
 const bundle=await readFile(new URL('../vendor/supabase-js-2.57.4.js',import.meta.url));
 assert.equal(createHash('sha256').update(bundle).digest('hex'),'7e94b62086deecef8c0ba3b38f514e2a1944ff6c81d92fb3ff967828c406c38f');
 for(const name of ['auth.mjs','dashboard.html']){
  const source=await readFile(new URL('../'+name,import.meta.url),'utf8');
  assert.match(source,/from '\.\/supabase-client\.mjs'/);
  assert.doesNotMatch(source,/from 'https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase/);
 }
});
