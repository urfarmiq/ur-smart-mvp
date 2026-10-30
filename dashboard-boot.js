// Recovery remains usable even while account scripts or requests are delayed.
(()=>{
 const byId=id=>document.getElementById(id);
 let failed=false,started=false,finished=false,helpTimer,totalTimer;
 const clearTimers=()=>{clearTimeout(importTimer);clearTimeout(helpTimer);clearTimeout(totalTimer);};
 const fail=message=>{
  failed=true;clearTimers();
  byId('welcome').textContent='تعذر استكمال الاتصال بالحساب.';
  byId('status').textContent=message||'تأخر تحميل لوحة المزارع. أعد المحاولة.';
  byId('cloudFields').textContent='لم تُحمّل الحقول بعد. بياناتك المحفوظة لم تُحذف.';
  byId('saveButton').disabled=true;
  byId('connectionRecovery').hidden=false;
 };
 const importTimer=setTimeout(()=>fail('تأخر تحميل ملفات الاتصال. اضغط «إعادة المحاولة» أو افتح صفحة تسجيل الدخول.'),15000);
 window.urDashboardBoot={
  start(){
   if(failed)return false;started=true;clearTimeout(importTimer);byId('connectionRecovery').hidden=true;
   helpTimer=setTimeout(()=>{if(!finished&&!failed)byId('connectionRecovery').hidden=false;},4000);
   totalTimer=setTimeout(()=>fail('تأخر استكمال الاتصال بالحساب وحقوله. أعد المحاولة دون مسح بياناتك.'),30000);return true;
  },
  isActive(){return !failed;},
  finish(){if(!failed){finished=true;clearTimers();byId('connectionRecovery').hidden=true;}},
  fail,
  cancel(){failed=true;clearTimers();}
 };
 byId('retryConnection').addEventListener('click',event=>{event.preventDefault();window.location.reload();});
 window.addEventListener('pagehide',()=>window.urDashboardBoot.cancel());
 window.addEventListener('pageshow',event=>{if(event.persisted)window.location.reload();});
 window.addEventListener('error',event=>{
  if(!started&&event.target?.tagName==='SCRIPT'&&event.target.type==='module')fail('تعذر تحميل ملفات الاتصال. تحقق من الإنترنت ثم أعد المحاولة.');
 },true);
})();
