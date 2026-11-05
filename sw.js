/* UR Smart PWA: public static files only; account and paid-service traffic is never cached. */
const BUILD_RELEASE = '__UR_PWA_RELEASE__';
const CACHE_PREFIX = 'ur-smart-pwa-';
const CACHE_NAME = CACHE_PREFIX + BUILD_RELEASE;
const SCOPE = new URL(self.registration.scope);
const MAX_HTML_BYTES = 131072;

const publicFiles = [
  {path:'index.html', aliases:['','index.html'], type:'html', marker:'id="home"'},
  {path:'services.html', aliases:['services','services.html'], type:'html', marker:'id="servicesTitle"'},
  {path:'install.html', aliases:['install','install.html'], type:'html', marker:'data-ur-install'},
  {path:'offline.html', aliases:['offline','offline.html'], type:'html', marker:'data-ur-offline'},
  {path:'pwa.css', type:'css'},
  {path:'pwa-client.mjs', type:'js'},
  {path:'services.css', type:'css'},
  {path:'manifest.webmanifest', type:'manifest'},
  {path:'icons/icon-192.png', type:'png'},
  {path:'icons/icon-512.png', type:'png'},
  {path:'icons/maskable-512.png', type:'png'},
  {path:'icons/apple-touch-icon.png', type:'png'},
  {path:'icons/app-icon.svg', type:'svg'}
].map(file => ({...file, key:new URL(file.path,SCOPE).href,
  paths:(file.aliases || [file.path]).map(path => new URL(path,SCOPE).pathname)}));
const byPath = new Map(publicFiles.flatMap(file => file.paths.map(path => [path,file])));
const offlineFile = publicFiles.find(file => file.path === 'offline.html');

function isScoped(url) {
  return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
}

async function fetchNetwork(request) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (request.signal?.aborted) controller.abort();
  else request.signal?.addEventListener('abort',cancel,{once:true});
  const timer = setTimeout(cancel,8000);
  try { return await fetch(request,{signal:controller.signal}); }
  finally { clearTimeout(timer); request.signal?.removeEventListener('abort',cancel); }
}

async function boundedHTML(response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('Missing public document');
  let size = 0, timedOut = false;
  const chunks = [];
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); },5000);
  try {
    for (;;) {
      const {value,done} = await reader.read();
      if (timedOut) throw Error('Public document timeout');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTML_BYTES) { void reader.cancel().catch(() => {}); throw Error('Public document too large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk,at); at += chunk.byteLength; }
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  } finally { clearTimeout(timer); try { reader.releaseLock(); } catch {} }
}

async function cacheable(response,file) {
  if (!response || response.status !== 200 || !['basic','default'].includes(response.type)) return false;
  let url;
  try { url = new URL(response.url); } catch { return false; }
  if (!isScoped(url) || url.search || url.username || url.password || !file.paths.includes(url.pathname)) return false;
  const policy = response.headers.get('cache-control') || '';
  if (/(?:^|,)\s*(?:no-store|private)(?:\s|=|,|$)/i.test(policy) || response.headers.has('set-cookie')) return false;
  if ((response.headers.get('vary') || '').split(',').some(value => ['*','cookie','authorization'].includes(value.trim().toLowerCase()))) return false;
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const types = {html:['text/html'],css:['text/css'],js:['application/javascript','text/javascript','application/ecmascript'],
    manifest:['application/manifest+json','application/json'],png:['image/png'],svg:['image/svg+xml']};
  if (!types[file.type].includes(mime)) return false;
  if (file.type === 'html') {
    try { return (await boundedHTML(response.clone())).includes(file.marker); } catch { return false; }
  }
  return true;
}

async function cachedFile(file) {
  try {
    const stored = await (await caches.open(CACHE_NAME)).match(file.key);
    if (!stored) return undefined;
    // A Pages .html URL may have been precached through a canonical redirect.
    // Navigation requests use manual redirect mode: replaying a Response with
    // redirected=true is rejected by browsers, including for an offline notice
    // returned at a private URL. A synthetic response retains the validated
    // public body/CSP/MIME but has no redirect URL or redirect flag.
    const headers = new Headers(stored.headers);
    headers.delete('content-encoding'); headers.delete('content-length');
    return new Response(stored.body,{status:stored.status,statusText:stored.statusText,headers});
  } catch { return undefined; }
}

async function offlineResponse() {
  const stored = await cachedFile(offlineFile);
  if (stored) return stored;
  return new Response('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>أور — لا يوجد اتصال</title><h1>أنت غير متصل بالإنترنت</h1><p>أعد الاتصال ثم افتح الصفحة مجددًا. الحسابات والطلبات والتحليل تحتاج اتصالًا.</p></html>',{
    status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"}
  });
}

async function publicResponse(request,file,isNavigation) {
  try {
    const response = await fetchNetwork(request);
    if (await cacheable(response,file)) {
      try { await (await caches.open(CACHE_NAME)).put(file.key,response.clone()); } catch {}
    }
    // HTTP failures are real responses, including 401/403/404. Do not replace them.
    return response;
  } catch (error) {
    const stored = await cachedFile(file);
    if (stored) return stored;
    if (isNavigation) return offlineResponse();
    throw error;
  }
}

self.addEventListener('install',event => {
  event.waitUntil((async () => {
    // Validate every file before opening/writing the new cache. A Pages SPA
    // fallback is not an offline page, a manifest or an image.
    const entries = await Promise.all(publicFiles.map(async file => {
      const response = await fetchNetwork(new Request(file.key,{credentials:'omit',cache:'reload'}));
      if (!await cacheable(response,file)) throw Error('Required public app file unavailable');
      return [file.key,response];
    }));
    const existed = await caches.has(CACHE_NAME);
    try {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(entries.map(([key,response]) => cache.put(key,response)));
    } catch (error) {
      if (!existed) await caches.delete(CACHE_NAME);
      throw error;
    }
    // A future version waits for existing tabs or an explicit update choice.
  })());
});

self.addEventListener('activate',event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message',event => {
  const data = event.data;
  if (!data || typeof data !== 'object' || Object.keys(data).length !== 1 || data.type !== 'SKIP_WAITING') return;
  let source;
  try { source = new URL(event.source?.url); } catch { return; }
  if (event.source.type !== 'window' || !isScoped(source) || (event.origin && event.origin !== SCOPE.origin)) return;
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch',event => {
  const request = event.request;
  let url;
  try { url = new URL(request.url); } catch { return; }
  // In particular: no Supabase/AI/satellite responses, access decisions,
  // photographs, payment submissions, callback tokens or account data.
  if (request.method !== 'GET' || !isScoped(url) || url.search || url.username || url.password ||
      request.headers.has('authorization') || request.headers.has('proxy-authorization')) return;
  const navigation = request.mode === 'navigate';
  if (request.cache === 'no-store') {
    // A protected document may explicitly require no-store. It still receives
    // the generic public notice when offline, but its own response never enters
    // Cache Storage (nor is a cached copy of that document served).
    if (navigation) event.respondWith(fetchNetwork(request).catch(() => offlineResponse()));
    return;
  }
  const file = byPath.get(url.pathname);
  if (file) { event.respondWith(publicResponse(request,file,navigation)); return; }
  if (navigation) {
    // Protected document HTML is never stored. On connectivity loss show only
    // the same generic public notice, without replaying a previous account.
    event.respondWith(fetchNetwork(request).catch(() => offlineResponse()));
  }
});
