import { createClient } from './supabase-client.mjs';
import { withDeadline } from './request-deadline.mjs';

const supabase = createClient(
'https://ynsmhtsktbubxfhsekjq.supabase.co',
'sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc'
);

const email = document.getElementById('email');
const password = document.getElementById('password');
const msg = document.getElementById('msg');
const form = document.getElementById('loginForm');
const buttons = [...document.querySelectorAll('button')];
let busy = false;
const say = text => msg.textContent = text;
const setBusy = value => {busy=value;for(const button of buttons)button.disabled=value;};
const openDashboard = () => {
 password.value='';
 say('تم تسجيل الدخول. جارٍ فتح لوحة المزارع...');
 window.location.assign('./dashboard.html');
};

async function authenticate(isSignup){
 if(busy||!form.reportValidity())return;
 if(isSignup&&[...password.value].length<12){
  say('للحساب الجديد، اختر عبارة مرور من 12 حرفًا على الأقل.');
  password.focus();return;
 }
 setBusy(true);
 password.autocomplete=isSignup?'new-password':'current-password';
 say(isSignup?'جارٍ إنشاء الحساب...':'جارٍ تسجيل الدخول...');
 try{
  const credentials={email:email.value.trim(),password:password.value};
  const {data,error}=isSignup?await supabase.auth.signUp(credentials):await supabase.auth.signInWithPassword(credentials);
  if(error){say(isSignup?'تعذر إكمال التسجيل. تحقق من المدخلات أو حاول لاحقًا.':'تعذر تسجيل الدخول. تحقق من بياناتك أو تأكيد البريد، ثم أعد المحاولة.');return;}
  if(data?.session)openDashboard();
  else if(isSignup)say('إذا كان التسجيل متاحًا لهذا البريد، ستصلك رسالة تأكيد. افحص بريدك ثم سجّل الدخول.');
  else say('لم تُنشأ جلسة دخول. تحقق من بياناتك أو تأكيد البريد، ثم أعد المحاولة.');
 }catch{
  say('تعذر الاتصال بخدمة الحسابات. تحقق من الاتصال وأعد المحاولة.');
 }finally{
  password.value='';password.autocomplete='current-password';setBusy(false);
 }
}

form.addEventListener('submit', async e => {
 e.preventDefault();await authenticate(false);
});

document.getElementById('signup').addEventListener('click', async () => {
 await authenticate(true);
});

document.getElementById('logout').addEventListener('click', async () => {
 if(busy)return;setBusy(true);
 try{const {error}=await supabase.auth.signOut();say(error?'تعذر تسجيل الخروج. أعد المحاولة.':'تم تسجيل الخروج.');}
 catch{say('تعذر الاتصال بخدمة الحسابات. أعد المحاولة.');}
 finally{password.value='';setBusy(false);}
});

withDeadline(supabase.auth.getSession()).then(({data,error}) => {
 if(busy)return;
 if (error) say('تعذر التحقق من جلسة الحساب. أعد المحاولة.');
 else if (data?.session) openDashboard();
 else say('أدخل بياناتك لتسجيل الدخول أو إنشاء حساب.');
}).catch(()=>{if(!busy)say('تعذر التحقق من جلسة الحساب. أعد المحاولة.');});
