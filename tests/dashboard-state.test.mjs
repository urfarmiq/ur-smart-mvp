import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../dashboard.html',import.meta.url),'utf8');
const start=source.indexOf('function renderLocalFields(){');
const end=source.indexOf('\nfunction resetForm()',start);
assert.ok(start>=0&&end>start,'legacy reader must be available');
const reader=source.slice(start,end);

function render(raw,{storageError=false}={}){
 const box={textContent:'',children:[],replaceChildren(){this.children=[];},appendChild(node){this.children.push(node);}};
 let writes=0;
 const localStorage={getItem(){if(storageError)throw Error('storage disabled');return raw;},setItem(){writes++;},removeItem(){writes++;},clear(){writes++;}};
 vm.runInNewContext(reader+';renderLocalFields();',{$:()=>box,localStorage,storageKey:'ur-smart-fields',document:{createElement:()=>({textContent:''})}});
 assert.equal(writes,0,'reading legacy fields must never replace or delete stored data');
 return box;
}

test('malformed legacy data cannot prevent dashboard initialization',()=>{
 for(const raw of ['"legacy"','{}','{broken','[null,42,[],"row"]']){
  const box=render(raw);
  assert.match(box.textContent+box.children.map(x=>x.textContent).join(' '),/تعذر/);
 }
 assert.match(render(null,{storageError:true}).textContent,/تعذر/);
});

test('legacy fields remain text and valid rows survive malformed neighbors',()=>{
 const box=render(JSON.stringify([null,{name:'<img src=x onerror=alert(1)>',area:2,crop:'حنطة'},{name:{toString:'invalid'},area:null,crop:[]} ]));
 assert.equal(box.children.length,3);
 assert.match(box.children[0].textContent,/لم تتغير البيانات/);
 assert.equal(box.children[1].textContent,'<img src=x onerror=alert(1)> — 2 دونم — حنطة');
 assert.match(box.children[2].textContent,/حقل بلا اسم.*مساحة غير محددة.*محصول غير محدد/);
 assert.match(render(null).textContent,/لا توجد حقول/);
});
