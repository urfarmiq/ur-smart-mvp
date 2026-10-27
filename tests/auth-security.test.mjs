import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../auth.html',import.meta.url),'utf8');
assert.match(html,/<script type="module" src="\.\/auth\.mjs"><\/script>/);
assert.match(html,/Content-Security-Policy/);
assert.match(html,/script-src-attr 'none'/);
const script=(await readFile(new URL('../auth.mjs',import.meta.url),'utf8')).replace(/^import[^\n]*\n/gm,'');

async function page(overrides={}){
 const calls=[],redirects=[];
 function element(value=''){return {value,textContent:'',disabled:false,autocomplete:'current-password',listeners:{},addEventListener(name,handler){this.listeners[name]=handler;},focus(){this.focused=true;}};}
 const elements={email:element('farmer@example.test'),password:element('existing6'),msg:element(),signup:element(),logout:element(),loginForm:element()};
 elements.loginForm.valid=true;elements.loginForm.reportValidity=()=>elements.loginForm.valid;
 const login=element(),buttons=[login,elements.signup,elements.logout];
 const auth={
  async getSession(){return {data:{session:null},error:null};},
  async signInWithPassword(value){calls.push({method:'login',value});return {data:{session:{user:{id:'fixture'}}},error:null};},
  async signUp(value){calls.push({method:'signup',value});return {data:{session:null},error:null};},
  async signOut(){calls.push({method:'logout'});return {error:null};},
  ...overrides,
 };
 const forbidden=()=>{throw Error('authentication must not write credentials to a custom store or log');};
 const context={createClient:()=>({auth}),document:{getElementById:id=>elements[id],querySelectorAll:()=>buttons},window:{location:{assign:path=>redirects.push(path)}},console:{log:forbidden,warn:forbidden,error:forbidden},localStorage:{setItem:forbidden},sessionStorage:{setItem:forbidden}};
 await vm.runInNewContext(script,context);
 return {elements,buttons,calls,redirects,submit:()=>elements.loginForm.listeners.submit({preventDefault(){}}),signup:()=>elements.signup.listeners.click(),logout:()=>elements.logout.listeners.click()};
}

test('both login and signup use native form validation and new accounts require a long password',async()=>{
 const p=await page();p.elements.loginForm.valid=false;
 await p.signup();await p.submit();assert.equal(p.calls.length,0);
 p.elements.loginForm.valid=true;p.elements.password.value='shortpass11';
 await p.signup();assert.equal(p.calls.length,0);assert.match(p.elements.msg.textContent,/12/);assert.equal(p.elements.password.focused,true);
 p.elements.password.value='a longer passphrase';await p.signup();
 assert.equal(p.calls.length,1);assert.equal(p.calls[0].method,'signup');assert.equal(p.elements.password.value,'');
 assert.match(p.elements.msg.textContent,/إذا كان التسجيل متاحًا/);
});

test('existing shorter login passwords continue to work and are removed from the input',async()=>{
 const p=await page();p.elements.password.value='old123';await p.submit();
 assert.equal(p.calls[0].method,'login');assert.equal(p.calls[0].value.password,'old123');
 assert.equal(p.elements.password.value,'');assert.deepEqual(p.redirects,['./dashboard.html']);
 assert.ok(p.buttons.every(button=>!button.disabled));
});

test('raw provider errors and rejected requests stay out of messages and controls recover',async()=>{
 const marker='provider-secret-account-detail';
 const p=await page({async signInWithPassword(){return {data:null,error:{message:marker}};},async signUp(){throw Error(marker);}});
 await p.submit();assert.match(p.elements.msg.textContent,/تعذر تسجيل الدخول/);assert.ok(!p.elements.msg.textContent.includes(marker));
 p.elements.password.value='a longer passphrase';await p.signup();
 assert.match(p.elements.msg.textContent,/تعذر الاتصال/);assert.ok(!p.elements.msg.textContent.includes(marker));
 assert.equal(p.elements.password.value,'');assert.ok(p.buttons.every(button=>!button.disabled));
});

test('simultaneous actions cannot submit the credentials twice',async()=>{
 let resolve,requests=0;
 const p=await page({signInWithPassword(){requests++;return new Promise(done=>resolve=done);},async signUp(){requests++;return {data:{session:null},error:null};}});
 const pending=p.submit();assert.ok(p.buttons.every(button=>button.disabled));await p.signup();await p.logout();
 assert.equal(requests,1);resolve({data:{session:null},error:null});await pending;
 assert.ok(p.buttons.every(button=>!button.disabled));assert.equal(p.elements.password.value,'');
});

test('session lookup and logout failures are handled without exposing provider messages',async()=>{
 const marker='private-session-detail';
 const p=await page({async getSession(){throw Error(marker);},async signOut(){throw Error(marker);}});
 assert.match(p.elements.msg.textContent,/تعذر التحقق/);assert.ok(!p.elements.msg.textContent.includes(marker));
 p.elements.password.value='unsent input';await p.logout();
 assert.equal(p.elements.password.value,'');assert.match(p.elements.msg.textContent,/تعذر الاتصال/);assert.ok(!p.elements.msg.textContent.includes(marker));
 assert.ok(p.buttons.every(button=>!button.disabled));
});
