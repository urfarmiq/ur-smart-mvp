import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../satellite-backend/worker.js',import.meta.url),'utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
test('worker rejects unauthorized origin and missing configuration',async()=>{
 let r=await worker.fetch(new Request('https://worker.test',{method:'POST',headers:{Origin:'https://other.test'}}),{});assert.equal(r.status,403);
 r=await worker.fetch(new Request('https://worker.test',{method:'POST'}),{});assert.equal(r.status,503);
 r=await worker.fetch(new Request('https://worker.test',{method:'POST'}),{SENTINEL_CLIENT_ID:'x',SENTINEL_CLIENT_SECRET:'x',SUPABASE_URL:'https://test',SUPABASE_PUBLISHABLE_KEY:'public'});assert.equal(r.status,401);
});
test('indicator scripts request SCL and mask cloud pixels',()=>{
 const start=source.indexOf('script=`//VERSION=3'),end=source.indexOf('`;\n   }else',start);
 const template=source.slice(start+'script=`'.length,end).replace('${expression}','(s.B08-s.B04)/(s.B08+s.B04)').replace('${JSON.stringify(requiredBands)}','["B08","B04"]').replace('${scaleExpression}','(v+0.2)/1');
 const context=vm.createContext({});vm.runInContext(template,context);
 assert.ok(context.setup().input[0].bands.includes('SCL'));
 assert.equal(context.evaluatePixel({B08:.6,B04:.2,dataMask:1,SCL:9})[3],0);
 assert.equal(context.evaluatePixel({B08:.6,B04:.2,dataMask:1,SCL:4})[3],255);
});
