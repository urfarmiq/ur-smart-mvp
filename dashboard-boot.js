// Runs independently of the SDK/module graph so an import failure is visible.
(()=>{
 const byId=id=>document.getElementById(id);
 let failed=false,started=false;
 const fail=message=>{
  failed=true;clearTimeout(timer);
  byId('welcome').textContent='تعذر استكمال الاتصال بالحساب.';
  byId('status').textContent=message||'تأخر تحميل لوحة المزارع. أعد المحاولة.';
  byId('cloudFields').textContent='لم تُحمّل الحقول بعد. بياناتك المحفوظة لم تُحذف.';
  byId('saveButton').disabled=true;
  byId('connectionRecovery').hidden=false;
 };
 const timer=setTimeout(()=>fail('تأخر تحميل ملفات الاتصال. اضغط «إعادة المحاولة» أو افتح صفحة تسجيل الدخول.'),15000);
 window.urDashboardBoot={
  start(){if(failed)return false;started=true;clearTimeout(timer);return true;},
  isActive(){return !failed;},
  finish(){if(!failed){clearTimeout(timer);byId('connectionRecovery').hidden=true;}},
  fail,
  cancel(){failed=true;clearTimeout(timer);}
 };
 byId('retryConnection').addEventListener('click',()=>window.location.reload());
 window.addEventListener('pagehide',()=>window.urDashboardBoot.cancel());
 window.addEventListener('pageshow',event=>{if(event.persisted)window.location.reload();});
 window.addEventListener('error',event=>{
  if(!started&&event.target?.tagName==='SCRIPT'&&event.target.type==='module')fail('تعذر تحميل ملفات الاتصال. تحقق من الإنترنت ثم أعد المحاولة.');
 },true);
})();
