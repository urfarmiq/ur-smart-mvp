import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ensurePagesProject} from '../scripts/ensure-pages-project.mjs';
import {buildPublicSite} from '../scripts/build-public-site.mjs';
import {getRedirectUrl,buildPagesRedirect} from '../scripts/build-pages-redirect.mjs';

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

test('old links preserve app routes and existing callbacks on the fixed new hostname',async()=>{
 const target=getRedirectUrl({pathname:'/ur-smart-mvp/field-map.html',search:'?field=abc',hash:'#view'});
 assert.equal(target,'https://ur-smart-urfarmiq.pages.dev/field-map.html?field=abc#view');
 for(const pathname of ['//evil.example/','/ur-smart-mvp//evil.example/','/ur-smart-mvp/%2F%2Fevil.example'])assert.equal(new URL(getRedirectUrl({pathname,search:'?redirect=https://evil.example',hash:'#existing-callback'})).origin,'https://ur-smart-urfarmiq.pages.dev');
 const temp=await mkdtemp(path.join(os.tmpdir(),'ur-redirect-'));
 try{await buildPagesRedirect({outDir:temp});const html=await readFile(path.join(temp,'index.html'),'utf8');assert.match(html,/downloadBackup/);assert.match(html,/migrationNotice/);assert.doesNotMatch(html,/supabase-js|signOut\(/);}finally{await rm(temp,{recursive:true,force:true});}
});
