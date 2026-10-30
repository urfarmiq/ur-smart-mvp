"""Dashboard startup recovery with synthetic SDK responses and no cloud access.

Every browser request is intercepted. These scenarios reproduce a failed SDK
import and a stalled/rejected session read while preserving a stored-session
marker. Long product deadlines are accelerated; all other timers are untouched.
Requires Playwright and /usr/bin/chromium.
"""
from pathlib import Path
from urllib.parse import urlparse
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://recovery.test/'
MARKER = 'synthetic-session-must-survive'

SDK = r"""
const mode=FIXTURE_MODE;
window.__recovery={calls:[],signOutCalls:0};
const session={access_token:'synthetic-only',user:{id:'fixture-user',email:'fixture@example.invalid'}};
const valid=()=>({data:{session},error:null});
export function createClient(){return {
 auth:{
  getSession(){
   window.__recovery.calls.push('getSession');
   if(mode==='never'||mode==='late')return new Promise(resolve=>window.__resolveSession=()=>resolve(valid()));
   if(mode==='reject')return Promise.reject(Error('synthetic-private-provider-detail'));
   if(mode==='anonymous')return Promise.resolve({data:{session:null},error:null});
   return Promise.resolve(valid());
  },
  getUser:async()=>({data:{user:session.user},error:null}),
  onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
  signOut:async()=>{window.__recovery.signOutCalls++;return {error:null};}
 },
 rpc:async()=>({data:false,error:null}),
 from(table){
  const query={};
  query.select=query.eq=query.order=query.limit=query.maybeSingle=query.single=()=>query;
  query.insert=()=>{throw Error('Unexpected cloud write');};
  query.then=(ok,fail)=>Promise.resolve().then(()=>{
   window.__recovery.calls.push(table);
   if(table==='farms')return {data:[{id:'fixture-farm',name:'مزرعة تجريبية'}],error:null};
   if(table==='fields')return {data:[{id:'fixture-field',name:'حقل تجريبي',area_donum:3,crop:'حنطة'}],error:null};
   return {data:[],error:null};
  }).then(ok,fail);
  return query;
 }
};}
"""


def scenario(browser, mobile, mode):
    context = browser.new_context(
        viewport={'width': 390 if mobile else 1280, 'height': 844 if mobile else 900},
        is_mobile=mobile, has_touch=mobile)
    context.add_init_script("""
      localStorage.setItem('ur-recovery-session-marker',MARKER);
      const timer=window.setTimeout.bind(window);
      const accelerate=ACCELERATE;
      window.setTimeout=(callback,delay,...args)=>timer(callback,
        !accelerate?delay:delay===12000?200:delay===15000?700:delay,...args);
    """.replace('MARKER', json.dumps(MARKER)).replace('ACCELERATE', json.dumps(mode not in ('ready', 'anonymous'))))

    def route_request(route):
        url = urlparse(route.request.url)
        if url.path.endswith('/supabase-client.mjs'):
            if mode == 'import-failed':
                route.abort('failed')
            elif mode == 'import-stalled':
                route.fulfill(body='await new Promise(()=>{}); export function createClient(){}', content_type='text/javascript')
            else:
                route.fulfill(body=SDK.replace('FIXTURE_MODE', json.dumps(mode)), content_type='text/javascript')
            return
        if url.hostname == 'recovery.test':
            path = ROOT / url.path.lstrip('/')
            if path.is_file():
                route.fulfill(body=path.read_bytes(), content_type={
                    '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css'
                }.get(path.suffix, 'text/html'))
                return
        route.abort('blockedbyclient')

    context.route('**/*', route_request)
    page = context.new_page()
    page.set_default_timeout(5000)
    page.goto(SITE + 'dashboard.html', wait_until='commit')
    if mode == 'ready':
        page.wait_for_function("document.querySelector('#cloudFields').textContent.includes('حقل تجريبي')")
        assert not page.locator('#saveButton').is_disabled()
        assert page.locator('#connectionRecovery').is_hidden()
        assert page.evaluate("window.__recovery.calls.includes('farms')&&window.__recovery.calls.includes('fields')")
    elif mode == 'anonymous':
        page.wait_for_function("document.querySelector('#welcome').textContent.includes('لم يتم تسجيل الدخول')")
        assert page.locator('#saveButton').is_disabled()
        assert 'سجّل الدخول' in page.locator('#cloudFields').inner_text()
        assert not page.evaluate("window.__recovery.calls.includes('farms')")
    else:
        page.wait_for_function("document.querySelector('#welcome').textContent!=='جارٍ التحقق من تسجيل الدخول...'")
        page.locator('#connectionRecovery').wait_for(state='visible')
        assert page.locator('#saveButton').is_disabled()
        assert page.locator('#retryConnection').is_enabled()
        assert page.locator('#connectionRecovery a[href="./auth.html"]').count() == 1
        assert page.locator('#welcome').inner_text() != 'جارٍ التحقق من تسجيل الدخول...'
        assert page.locator('#status').inner_text() != 'جارٍ الاتصال...'
        if mode in ('never', 'late', 'reject'):
            assert not page.evaluate("window.__recovery.calls.includes('farms')")
        if mode == 'late':
            before = page.locator('#status').inner_text()
            page.evaluate('window.__resolveSession()')
            page.wait_for_timeout(100)
            assert page.locator('#status').inner_text() == before
            assert not page.evaluate("window.__recovery.calls.includes('farms')")
            assert page.locator('#connectionRecovery').is_visible()
        if mode == 'import-stalled':
            assert page.evaluate('window.urDashboardBoot.start()') is False
        if mode == 'import-failed':
            # The retry must reload the page without clearing the stored session.
            with page.expect_navigation(wait_until='commit'):
                page.click('#retryConnection')
            page.locator('#connectionRecovery').wait_for(state='visible')
    assert page.evaluate("localStorage.getItem('ur-recovery-session-marker')") == MARKER
    assert page.evaluate('window.__recovery?.signOutCalls||0') == 0
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    context.close()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    for mobile in (False, True):
        for mode in ('ready', 'anonymous', 'import-failed', 'import-stalled', 'never', 'reject', 'late'):
            scenario(browser, mobile, mode)
        print(('Mobile' if mobile else 'Desktop') + ': SDK import/session recovery, bounded wait, late-result guard and stored-session preservation pass; synthetic responses only.')
    browser.close()
