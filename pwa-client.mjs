const MAIN_HOST = 'ur-smart-urfarmiq.pages.dev';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isStandalone(win, nav) {
 return !!(nav.standalone === true || win.matchMedia?.('(display-mode: standalone)').matches);
}

// The bootstrap has no account, API or storage access. Installation and update
// actions always follow an explicit click; a newly active worker never reloads
// an existing form on its own.
export function createPwaClient({win = globalThis.window, doc = globalThis.document, nav = globalThis.navigator} = {}) {
 if (!win || !doc || !nav) return null;
 const installLinks = [...doc.querySelectorAll('[data-pwa-install]')];
 const updateButtons = [...doc.querySelectorAll('[data-pwa-update]')];
 const notices = [...doc.querySelectorAll('[data-pwa-update-notice]')];
 const statusNodes = [...doc.querySelectorAll('[data-pwa-status]')];
 const message = value => { for (const node of statusNodes) node.textContent = value; };
 const listeners = [];
 const listen = (target, name, callback, options) => {
  if (!target?.addEventListener) return;
  target.addEventListener(name, callback, options);
  listeners.push(() => target.removeEventListener?.(name, callback, options));
 };
 let registration = null, waitingWorker = null, deferredPrompt = null;
 let installed = isStandalone(win, nav), prompting = false, reloadRequested = false, disposed = false;
 let registrationStarted = false;
 const ios = /iPad|iPhone|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);

 function updateInstallState() {
  for (const link of installLinks) {
   link.hidden = installed;
   if (deferredPrompt) link.setAttribute('aria-label', 'تثبيت تطبيق أور الزراعية');
   else link.removeAttribute('aria-label');
  }
 }
 function showWaiting(worker) {
  if (disposed || !worker || worker.state && worker.state !== 'installed') return;
  waitingWorker = worker;
  for (const node of notices) node.hidden = false;
  for (const button of updateButtons) button.disabled = false;
 }
 function clearWaiting() {
  waitingWorker = null;
  for (const node of notices) node.hidden = true;
  for (const button of updateButtons) button.disabled = false;
 }
 async function install(event) {
  if (prompting) { event.preventDefault(); return; }
  if (!deferredPrompt || installed) return; // The real href opens the guide.
  event.preventDefault();
  const prompt = deferredPrompt;
  deferredPrompt = null;
  prompting = true;
  updateInstallState();
  try {
   await prompt.prompt();
   const choice = await prompt.userChoice;
   if (disposed || installed) return;
   message(choice?.outcome === 'accepted'
    ? 'وافق المتصفح على طلب التثبيت. أكمل الخطوات التي يعرضها جهازك.'
    : 'يمكنك تثبيت التطبيق لاحقًا من قائمة المتصفح أو اتباع الخطوات أدناه.');
  } catch {
   if (!disposed && !installed) message('افتح دليل التثبيت أو أضف أور من قائمة المتصفح.');
  } finally {
   prompting = false;
  }
 }
 function requestUpdate(event) {
  event.preventDefault();
  const worker = registration?.waiting || waitingWorker;
  if (!worker || reloadRequested) return;
  if (worker.state && worker.state !== 'installed') { clearWaiting(); return; }
  reloadRequested = true;
  for (const button of updateButtons) button.disabled = true;
  message('جارٍ تفعيل التحديث الذي طلبته…');
  try { worker.postMessage({type:'SKIP_WAITING'}); }
  catch {
   reloadRequested = false;
   for (const button of updateButtons) button.disabled = false;
   message('تعذر بدء التحديث. يمكنك المحاولة مجددًا بعد الاتصال بالإنترنت.');
  }
 }
 async function register() {
  if (registrationStarted || disposed) return;
  registrationStarted = true;
  let location;
  try { location = new URL(win.location.href); } catch { return; }
  const allowed = location.hostname === MAIN_HOST && location.protocol === 'https:'
   || LOCAL_HOSTS.has(location.hostname) && ['http:', 'https:'].includes(location.protocol);
  if (!allowed || !nav.serviceWorker?.register) return;
  try {
   const base = new URL('./', location);
   registration = await nav.serviceWorker.register(new URL('sw.js', base).href, {scope:base.href, updateViaCache:'none'});
   if (disposed) return;
   if (registration.waiting) showWaiting(registration.waiting);
   const observeInstalling = () => {
    const worker = registration.installing;
    if (!worker) return;
    listen(worker, 'statechange', () => {
     if (worker.state === 'installed' && nav.serviceWorker.controller) showWaiting(registration.waiting || worker);
    });
   };
   listen(registration, 'updatefound', observeInstalling);
   observeInstalling();
  } catch {
   if (!disposed && !installed) message('تعذر تجهيز وضع انقطاع الإنترنت الآن. يمكنك متابعة الموقع وإعادة فتحه عند تحسن الاتصال.');
  }
 }
 listen(win, 'beforeinstallprompt', event => {
  event.preventDefault();
  deferredPrompt = event;
  if (!installed) message('التطبيق جاهز للتثبيت. اضغط «تثبيت التطبيق» للمتابعة.');
  updateInstallState();
 });
 listen(win, 'appinstalled', () => {
  installed = true;
  deferredPrompt = null;
  updateInstallState();
  message('تم تثبيت أور. افتحه من أيقونته على جهازك.');
 });
 listen(nav.serviceWorker, 'controllerchange', () => {
  if (disposed) return;
  const requested = reloadRequested;
  reloadRequested = false;
  clearWaiting();
  if (requested) win.location.reload();
 });
 for (const link of installLinks) listen(link, 'click', install);
 for (const button of updateButtons) listen(button, 'click', requestUpdate);
 updateInstallState();
 message(installed ? 'أور مفتوح كتطبيق مستقل على جهازك.'
  : ios ? 'على iPhone أو iPad: افتح هذه الصفحة في Safari ثم اتبع خطوات الإضافة أدناه.'
  : 'يمكنك تثبيت أور من زر التثبيت عند توفره أو من قائمة المتصفح.');
 if (doc.readyState === 'complete') void register();
 else listen(win, 'load', () => { void register(); }, {once:true});
 return {
  dispose() { disposed = true; for (const remove of listeners) remove(); },
  // Kept as a callable entry for non-DOM verification; it is idempotent.
  register
 };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') createPwaClient();
