"""Private administration acceptance with synthetic Supabase and no cloud writes.

Requires Playwright and /usr/bin/chromium. Every request is intercepted. The
actual admin HTML and CSP are used, while auth/MFA/database responses are local
fixtures. No production session, credentials, user or database is accessed.
"""
from pathlib import Path
from urllib.parse import urlparse
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
STATE = {'mode': 'anon'}
SECRET = 'JBSWY3DPEHPK3PXP'  # Public test vector, never a real account factor.

MOCK = r"""
const mode=FIXTURE_MODE,secret=FIXTURE_SECRET;
window.__fixture={mode,calls:[],mfaCalls:[],signedIn:mode!=='anon',role:mode!=='anon'&&mode!=='ordinary',aal:mode==='admin'||mode==='pagination'?'aal2':'aal1',hasFactor:mode==='challenge',listeners:[],holdReads:false,pendingReads:[],failSelect:false,holdVisits:false,pendingVisits:[],failVisits:false,malformedVisits:false,rows:[
 {id:'11111111-1111-4111-8111-111111111111',user_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'farmer-one@example.test',display_name:'<img src=x onerror=window.__xss=true>',registered_at:'2026-10-27T09:00:00Z',email_confirmed_at:null,seen_at:null,password:'PASSWORD_MUST_NOT_APPEAR',encrypted_password:'HASH_MUST_NOT_APPEAR',access_token:'TOKEN_MUST_NOT_APPEAR'},
 {id:'22222222-2222-4222-8222-222222222222',user_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',email:'farmer-two@example.test',display_name:null,registered_at:'2026-10-27T08:00:00Z',email_confirmed_at:'2026-10-27T08:05:00Z',seen_at:null}
]};
Object.assign(window.__fixture,{holdOrderReads:false,pendingOrderReads:[],holdReview:false,pendingReviews:[],failReview:false,failOrderRead:false,researchRows:[
 {id:'33333333-3333-4333-8333-333333333333',owner_id:'fixture-admin',topic:'<img src=x onerror=window.__researchXss=true> دراسة محصول القمح',task_type:'combined',fee_iqd:25000,status:'waiting_payment',payment_reference:'TRANSFER-QA-25000',admin_note:null,approved_at:null,created_at:'2026-10-29T09:00:00Z',updated_at:'2026-10-29T09:00:00Z',attempt_count:0,started_at:null,result_status:null,result:{private:'RAW_CSV_MUST_NOT_APPEAR'}},
 {id:'44444444-4444-4444-8444-444444444444',owner_id:'fixture-researcher',topic:'تحليل التربة',task_type:'data',fee_iqd:25000,status:'waiting_payment',payment_reference:null,admin_note:null,approved_at:null,created_at:'2026-10-29T08:00:00Z',updated_at:'2026-10-29T08:00:00Z',attempt_count:0,started_at:null,result_status:null},
 {id:'55555555-5555-4555-8555-555555555555',owner_id:'fixture-researcher',topic:'طلب سابق معتمد',task_type:'study',fee_iqd:25000,status:'approved',payment_reference:'PREVIOUS',admin_note:'تمت مراجعة الدفع',approved_at:'2026-10-29T07:30:00Z',created_at:'2026-10-29T07:00:00Z',updated_at:'2026-10-29T07:30:00Z',attempt_count:0,started_at:null,result_status:null}
]});
if(mode==='pagination')for(let i=0;i<63;i++)window.__fixture.rows.push({id:String(i+3).padStart(8,'0')+'-0000-4000-8000-000000000000',user_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',email:'old-'+i+'@example.test',display_name:'تسجيل قديم '+i,registered_at:new Date(Date.parse('2026-10-27T07:59:00Z')-i*60000).toISOString(),email_confirmed_at:null,seen_at:null});
if(mode==='pagination')for(let i=0;i<63;i++)window.__fixture.researchRows.push({...window.__fixture.researchRows[1],id:String(i+10).padStart(8,'0')+'-1000-4000-8000-000000000000',topic:'طلب بحث قديم '+i,created_at:new Date(Date.parse('2026-10-29T06:59:00Z')-i*60000).toISOString()});
const user=()=>({id:'fixture-admin',email:'admin@example.test',user_metadata:{role:'admin',is_admin:true}});
function createClient(){const s=window.__fixture;return {
 auth:{
  getSession:async()=>({data:{session:s.signedIn?{access_token:'synthetic-auth-session',user:user()}:null},error:null}),
  getUser:async()=>({data:{user:s.signedIn?user():null},error:null}),
  onAuthStateChange(callback){s.listeners.push(callback);return {data:{subscription:{unsubscribe(){s.listeners=s.listeners.filter(row=>row!==callback);}}}};},
  async signOut(){s.signedIn=false;for(const callback of [...s.listeners])callback('SIGNED_OUT',null);return {error:null};},
  mfa:{
   async getAuthenticatorAssuranceLevel(){s.mfaCalls.push({method:'assurance'});return {data:{currentLevel:s.aal,nextLevel:'aal2'},error:null};},
   async listFactors(){s.mfaCalls.push({method:'factors'});return {data:{totp:s.hasFactor?[{id:'factor-existing',status:'verified',factor_type:'totp',friendly_name:'تطبيق المدير'}]:[],all:[]},error:null};},
   async enroll(input){s.mfaCalls.push({method:'enroll',input});return {data:{id:'factor-new',type:'totp',totp:{secret,qr_code:'<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="black"/></svg>'}},error:null};},
   async challengeAndVerify(input){s.mfaCalls.push({method:'verify',input});if(input.code!=='123456')return {data:null,error:{message:'sensitive provider error'}};s.aal='aal2';s.hasFactor=true;return {data:{access_token:'synthetic-promoted-session'},error:null};}
  }
 },
 async rpc(name,input){
  s.calls.push({rpc:name,...(input?{input}: {})});if(name==='admin_access')return {data:s.role,error:null};
  if(name==='review_research_order'){
   if(!s.signedIn||!s.role||s.aal!=='aal2')throw Error('Review attempted before private admin MFA');
   if(s.failReview)return {data:null,error:{message:'PAYMENT_PROVIDER_SECRET_MUST_NOT_APPEAR'}};
   if(!input||Object.keys(input).sort().join(',')!=='p_decision,p_note,p_order_id'||!['approve','reject'].includes(input.p_decision)||input.p_note!==null&&(typeof input.p_note!=='string'||input.p_note.length>1000))throw Error('Unexpected review input');
   const row=s.researchRows.find(row=>row.id===input.p_order_id);
   if(!row||row.status!=='waiting_payment')return {data:null,error:{message:'Already reviewed'}};
   row.status=input.p_decision==='approve'?'approved':'rejected';row.fee_iqd=25000;row.admin_note=input.p_note;row.approved_at=input.p_decision==='approve'?'2026-10-29T10:00:00Z':null;
   const result={data:{id:row.id,status:row.status,fee_iqd:25000},error:null};
   if(s.holdReview)return new Promise(resolve=>s.pendingReviews.push(()=>resolve(result)));
   return result;
  }
  if(name!=='admin_site_visits')throw Error('Unexpected RPC');
  if(!s.signedIn||!s.role||s.aal!=='aal2')throw Error('Visit read attempted before private admin MFA');
  if(s.failVisits)return {data:null,error:{message:'TOKEN_MUST_NOT_APPEAR'}};
  const daily=Array.from({length:30},(_,i)=>({day:new Date(Date.UTC(2026,8,28+i)).toISOString().slice(0,10),views:i===29?12:1}));
  const result={data:{started_at:'2026-09-01T07:00:00Z',today_views:12,week_views:18,month_views:41,total_views:50,daily,pages:[{page:'home',views:30},{page:'weather',views:20}]},error:null};
  if(s.malformedVisits)result.data.pages.push({page:'<img src=x onerror=window.__visitXss=true>',views:0});
  if(s.holdVisits)return new Promise(resolve=>s.pendingVisits.push(()=>resolve(result)));
  return result;
 },
 from(table){let action='select',payload=null,columns='',options={},filters=[],limit=50,start=0,orders=[];const q={};
  q.select=(value,opts={})=>{columns=value;options=opts;return q;};q.order=(key,opts)=>{orders.push([key,opts]);return q;};q.limit=value=>{limit=value;return q;};q.range=(from,to)=>{start=from;limit=to-from+1;return q;};
  q.eq=(key,value)=>{filters.push({op:'eq',key,value});return q;};q.is=(key,value)=>{filters.push({op:'is',key,value});return q;};q.in=(key,value)=>{filters.push({op:'in',key,value});return q;};
  q.update=value=>{action='update';payload=value;return q;};
  q.then=(ok,fail)=>Promise.resolve().then(()=>{
   s.calls.push({table,action,payload,columns,options,filters,range:[start,start+limit-1],orders});
   if(!['signup_notifications','research_orders'].includes(table))throw Error('Unexpected admin fixture table');
   if(!s.signedIn||!s.role||s.aal!=='aal2')throw Error('Admin data read attempted before private admin MFA');
   if((table==='signup_notifications'?s.failSelect:s.failOrderRead)&&action==='select')return {data:null,error:{message:'PASSWORD_MUST_NOT_APPEAR'}};
   const matches=row=>filters.every(f=>f.op==='in'?f.value.includes(row[f.key]):row[f.key]===f.value);
   const selected=(table==='signup_notifications'?s.rows:s.researchRows).filter(matches).sort((a,b)=>{for(const [key,opts] of orders){const result=String(a[key]).localeCompare(String(b[key]));if(result)return opts?.ascending===false?-result:result;}return 0;});
   if(action==='update'){
    if(table!=='signup_notifications')throw Error('Research updates must use trusted RPC');
    if(Object.keys(payload).join(',')!=='seen_at')throw Error('Unexpected notification field update');
    selected.forEach(row=>{row.seen_at=payload.seen_at;});
    return {data:selected.map(row=>({id:row.id})),error:null};
   }
   if(options.head)return {data:null,count:selected.length,error:null};
   const result={data:selected.slice(start,start+limit).map(row=>({...row})),error:null};
   if(table==='research_orders'&&s.holdOrderReads)return new Promise(resolve=>s.pendingOrderReads.push(()=>resolve(result)));
   if(table==='signup_notifications'&&s.holdReads)return new Promise(resolve=>s.pendingReads.push(()=>resolve(result)));
   return result;
  }).then(ok,fail);return q;
 }
};}
export {createClient};
"""


def route_request(route):
    url = urlparse(route.request.url)
    if url.hostname == 'ur-smart.test':
        path = ROOT / url.path.lstrip('/')
        if path.is_file():
            route.fulfill(body=path.read_bytes(), content_type={'.mjs':'text/javascript','.css':'text/css'}.get(path.suffix,'text/html'))
            return
    if url.hostname == 'cdn.jsdelivr.net' and '@supabase/supabase-js@2.57.4/' in url.path:
        body = MOCK.replace('FIXTURE_MODE', json.dumps(STATE['mode'])).replace('FIXTURE_SECRET', json.dumps(SECRET))
        route.fulfill(body=body, content_type='text/javascript')
        return
    route.abort()


def wait_text(page, selector, value):
    page.wait_for_function('([selector,value])=>document.querySelector(selector).textContent.includes(value)', arg=[selector,value])


def assert_no_notifications(page):
    assert page.evaluate("window.__fixture.calls.filter(call=>call.table==='signup_notifications').length") == 0
    assert page.evaluate("window.__fixture.calls.filter(call=>call.table==='research_orders'||call.rpc==='review_research_order').length") == 0
    assert page.evaluate("window.__fixture.calls.filter(call=>call.rpc==='admin_site_visits').length") == 0
    assert page.locator('#adminContent').is_hidden()
    assert page.locator('#visitsToday').inner_text() == '—'
    assert page.locator('#notificationList').inner_text() == ''
    assert page.locator('#researchOrderList').inner_text() == ''
    assert page.locator('#researchPendingCount').inner_text() == '—'


def assert_secret_not_persisted(page, logs):
    assert page.evaluate("value=>[...Object.values(localStorage),...Object.values(sessionStorage)].every(row=>!row.includes(value))", SECRET)
    assert all(SECRET not in line and 'synthetic-auth-session' not in line for line in logs)


def assert_notifications(page):
    page.wait_for_selector('#adminContent:not([hidden])')
    page.wait_for_function("document.querySelectorAll('#notificationList .notification').length===2")
    text = page.locator('#notificationList').inner_text()
    assert '<img src=x onerror=window.__xss=true>' in text
    assert page.locator('#notificationList img').count() == 0
    assert page.evaluate('window.__xss') is None
    assert 'farmer-one@example.test' in text and 'farmer-two@example.test' in text
    assert 'بانتظار التأكيد' in text and 'تم التأكيد' in text
    for forbidden in ('PASSWORD_MUST_NOT_APPEAR','HASH_MUST_NOT_APPEAR','TOKEN_MUST_NOT_APPEAR','aaaaaaaa-aaaa'):
        assert forbidden not in text
    allowed = {'id','user_id','email','display_name','registered_at','email_confirmed_at','seen_at'}
    for call in page.evaluate("window.__fixture.calls.filter(call=>call.table==='signup_notifications')"):
        assert set(call['columns'].split(',')) <= allowed
        assert '*' not in call['columns']
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')


def assert_visits(page):
    page.wait_for_function("document.querySelector('#visitPages').children.length===2")
    for selector, count in (('#visitsToday',12),('#visitsWeek',18),('#visitsMonth',41),('#visitsTotal',50)):
        assert page.locator(selector).inner_text() == page.evaluate("value=>new Intl.NumberFormat('ar-IQ').format(value)", count)
    assert 'الرئيسية' in page.locator('#visitPages').inner_text()
    assert 'الطقس' in page.locator('#visitPages').inner_text()
    assert page.locator('#visitDays tr').count() == 30
    assert page.locator('#visitDetails').is_visible()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')


def assert_research_orders(page):
    page.wait_for_function("document.querySelectorAll('#researchOrderList .research-order').length===2")
    assert page.locator('#researchOrderFilter').input_value() == 'waiting_payment'
    assert page.locator('#researchPendingCount').inner_text() == page.evaluate("new Intl.NumberFormat('ar-IQ').format(2)")
    text = page.locator('#researchOrderList').inner_text()
    assert '<img src=x onerror=window.__researchXss=true>' in text
    assert page.locator('#researchOrderList img').count() == 0
    assert page.evaluate('window.__researchXss') is None
    assert 'TRANSFER-QA-25000' in text
    assert page.evaluate("new Intl.NumberFormat('ar-IQ').format(25000)") in text
    assert 'بعد التأكيد يستطيع الباحث بدء التنفيذ الآلي من صفحة الخدمة.' in page.locator('#adminContent').inner_text()
    for forbidden in ('RAW_CSV_MUST_NOT_APPEAR','fixture-researcher','PAYMENT_PROVIDER_SECRET_MUST_NOT_APPEAR'):
        assert forbidden not in text
    allowed = {'id','owner_id','topic','task_type','fee_iqd','status','payment_reference','admin_note','approved_at','created_at','updated_at','attempt_count','started_at','result_status'}
    calls = page.evaluate("window.__fixture.calls.filter(call=>call.table==='research_orders')")
    assert calls and any(call['options'].get('head') and call['options'].get('count') == 'exact' and call['filters'] == [{'op':'eq','key':'status','value':'waiting_payment'}] for call in calls)
    for call in calls:
        assert call['action'] == 'select' and '*' not in call['columns']
        assert set(call['columns'].split(',')) <= allowed
        if not call['options'].get('head'):
            assert set(call['columns'].split(',')) == allowed
            assert call['orders'] == [['created_at',{'ascending':False}],['id',{'ascending':False}]]
    assert page.locator('#researchOrderList textarea').first.get_attribute('maxlength') == '1000'
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    for mobile in (False, True):
        context = browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 900}, is_mobile=mobile, has_touch=mobile)
        context.route('**/*', route_request)
        page = context.new_page()
        page.set_default_timeout(10000)
        errors, logs = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: logs.append(message.text))

        STATE['mode'] = 'anon'
        page.goto('https://ur-smart.test/admin.html')
        wait_text(page, '#adminStatus', 'سجّل الدخول')
        assert_no_notifications(page)

        # User-editable role metadata must never grant administration.
        STATE['mode'] = 'ordinary'
        page.goto('https://ur-smart.test/admin.html')
        wait_text(page, '#adminStatus', 'لا يملك')
        assert_no_notifications(page)

        STATE['mode'] = 'enroll'
        page.goto('https://ur-smart.test/admin.html')
        page.wait_for_selector('#mfaPanel:not([hidden])')
        assert_no_notifications(page)
        assert page.evaluate("window.__fixture.mfaCalls.filter(call=>call.method==='enroll').length") == 0
        assert page.locator('#mfaSetup').is_hidden()
        page.click('#enrollMfa')
        page.wait_for_selector('#mfaSetup:not([hidden])')
        assert page.locator('#mfaSecret').input_value() == SECRET
        assert page.locator('#mfaSecret').get_attribute('readonly') is not None
        assert page.locator('#mfaQr').get_attribute('src').startswith('data:image/svg+xml')
        assert_no_notifications(page)
        assert_secret_not_persisted(page, logs)
        page.fill('#mfaCode', '123456')
        page.click('#verifyMfaButton')
        assert_notifications(page)
        assert_visits(page)
        assert_research_orders(page)
        assert page.locator('#mfaSecret').input_value() == ''
        assert page.locator('#mfaQr').get_attribute('src') is None
        assert page.locator('#mfaCode').input_value() == ''
        assert_secret_not_persisted(page, logs)

        # The real page's CSP must reject an injected inline script.
        policy = page.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute('content')
        assert "'unsafe-inline'" not in policy and "base-uri 'none'" in policy and "object-src 'none'" in policy
        page.evaluate("()=>{const script=document.createElement('script');script.textContent='window.__inlineRan=true';document.body.append(script);}")
        assert page.evaluate('window.__inlineRan') is None
        page.screenshot(path='/tmp/ur-admin-'+('mobile' if mobile else 'desktop')+'.png', full_page=True)

        STATE['mode'] = 'challenge'
        page.goto('https://ur-smart.test/admin.html')
        page.wait_for_selector('#verifyMfa:not([hidden])')
        assert page.locator('#enrollMfa').is_hidden() and page.locator('#mfaSetup').is_hidden()
        assert_no_notifications(page)
        page.fill('#mfaCode', '000000')
        page.click('#verifyMfaButton')
        wait_text(page, '#mfaStatus', 'تعذر التحقق')
        assert_no_notifications(page)
        assert 'sensitive provider error' not in page.locator('#mfaStatus').inner_text()
        page.fill('#mfaCode', '123456')
        page.click('#verifyMfaButton')
        assert_notifications(page)
        assert_visits(page)
        assert_research_orders(page)
        assert page.evaluate("window.__fixture.mfaCalls.filter(call=>call.method==='enroll').length") == 0
        assert page.evaluate("window.__fixture.mfaCalls.filter(call=>call.method==='verify').at(-1).input.factorId") == 'factor-existing'

        STATE['mode'] = 'admin'
        page.goto('https://ur-smart.test/admin.html')
        assert_notifications(page)
        assert_visits(page)
        assert_research_orders(page)

        # A trusted MFA administrator may review their own QA order. The
        # confirmation checkbox is required before any approval RPC is sent.
        order = page.locator('#researchOrderList .research-order').first
        order.get_by_role('button', name='تأكيد الدفع والسماح بالتنفيذ', exact=True).click()
        assert page.evaluate("window.__fixture.calls.filter(call=>call.rpc==='review_research_order').length") == 0
        order.locator('textarea').fill('وصل المبلغ وتمت مراجعة نطاق الدراسة')
        order_reads = page.evaluate("window.__fixture.calls.filter(call=>call.table==='research_orders').length")
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        assert page.evaluate("window.__fixture.calls.filter(call=>call.table==='research_orders').length") == order_reads
        assert order.locator('textarea').input_value() == 'وصل المبلغ وتمت مراجعة نطاق الدراسة'
        order.locator('input[type=checkbox]').check()
        page.evaluate('window.__fixture.failReview=true')
        order.get_by_role('button', name='تأكيد الدفع والسماح بالتنفيذ', exact=True).click()
        wait_text(page, '#researchOrdersStatus', 'تعذر تأكيد قرار المراجعة')
        assert 'تم تأكيد الدفع' not in page.locator('#researchOrdersStatus').inner_text()
        assert 'PAYMENT_PROVIDER_SECRET_MUST_NOT_APPEAR' not in page.locator('#researchOrdersStatus').inner_text()
        assert page.locator('#researchOrderList .research-order').count() == 2
        page.evaluate('window.__fixture.failReview=false')
        order.get_by_role('button', name='تأكيد الدفع والسماح بالتنفيذ', exact=True).click()
        wait_text(page, '#researchOrdersStatus', 'تم تأكيد الدفع والسماح بالتنفيذ')
        assert page.locator('#researchOrderList .research-order').count() == 1
        assert page.locator('#researchPendingCount').inner_text() == page.evaluate("new Intl.NumberFormat('ar-IQ').format(1)")
        assert page.evaluate("window.__fixture.calls.filter(call=>call.rpc==='review_research_order').at(-1).input") == {
            'p_order_id':'33333333-3333-4333-8333-333333333333','p_decision':'approve','p_note':'وصل المبلغ وتمت مراجعة نطاق الدراسة'}
        # Rejection can leave the optional note empty and does not claim payment.
        page.locator('#researchOrderList .research-order').first.get_by_role('button', name='رفض الطلب', exact=True).click()
        wait_text(page, '#researchOrdersStatus', 'تم رفض الطلب')
        assert page.evaluate("window.__fixture.calls.filter(call=>call.rpc==='review_research_order').at(-1).input") == {
            'p_order_id':'44444444-4444-4444-8444-444444444444','p_decision':'reject','p_note':None}
        assert page.locator('#researchOrderList .research-order').count() == 0
        page.select_option('#researchOrderFilter', 'approved')
        page.wait_for_function("document.querySelectorAll('#researchOrderList .research-order').length===2")
        assert 'وصل المبلغ وتمت مراجعة نطاق الدراسة' in page.locator('#researchOrderList').inner_text()
        assert page.locator('#researchOrderList form').count() == 0
        assert page.evaluate("window.__fixture.calls.filter(call=>call.rpc&&call.rpc.includes('research')&&call.rpc!=='review_research_order').length") == 0
        page.locator('#notificationList .notification').first.get_by_role('button', name='تعليم كمقروء', exact=True).click()
        page.wait_for_function("window.__fixture.rows[0].seen_at!==null&&document.querySelectorAll('#notificationList .notification.seen').length===1")
        page.click('#markAllSeen')
        page.wait_for_function("window.__fixture.rows.every(row=>row.seen_at!==null)&&document.querySelector('#markAllSeen').disabled")
        for call in page.evaluate("window.__fixture.calls.filter(call=>call.action==='update')"):
            assert set(call['payload']) == {'seen_at'}
        assert page.locator('#unreadCount').inner_text() == page.evaluate("new Intl.NumberFormat('ar-IQ').format(0)")

        # Stats failure or malformed data must never become a misleading zero.
        page.evaluate('window.__fixture.failVisits=true')
        page.click('#refreshVisits')
        wait_text(page, '#visitsStatus', 'تعذر تحميل')
        assert page.locator('#visitsToday').inner_text() == '—'
        assert page.locator('#visitDetails').is_hidden()
        assert page.locator('#notificationList .notification').count() == 2
        assert 'TOKEN_MUST_NOT_APPEAR' not in page.locator('#visitsStatus').inner_text()
        page.evaluate('window.__fixture.failVisits=false;window.__fixture.malformedVisits=true')
        page.click('#refreshVisits')
        wait_text(page, '#visitsStatus', 'تعذر تحميل')
        assert page.locator('#visitPages img').count() == 0
        assert page.evaluate('window.__visitXss') is None
        assert page.locator('#visitsToday').inner_text() == '—'
        page.evaluate('window.__fixture.malformedVisits=false')
        page.click('#refreshVisits')
        assert_visits(page)

        # Queued stats and notification responses must not restore data after sign-out.
        page.evaluate('window.__fixture.holdReads=true;window.__fixture.holdVisits=true;window.__fixture.holdOrderReads=true')
        page.click('#refreshVisits')
        page.wait_for_function('window.__fixture.pendingVisits.length===1')
        page.click('#refreshNotifications')
        page.wait_for_function('window.__fixture.pendingReads.length===1')
        page.click('#refreshResearchOrders')
        page.wait_for_function('window.__fixture.pendingOrderReads.length===1')
        page.click('#logoutAdmin')
        wait_text(page, '#adminStatus', 'تم تسجيل الخروج')
        assert page.locator('#adminContent').is_hidden()
        assert page.locator('#notificationList').inner_text() == ''
        assert page.locator('#researchOrderList').inner_text() == ''
        page.evaluate("async()=>{const pending=[...window.__fixture.pendingReads.splice(0),...window.__fixture.pendingVisits.splice(0),...window.__fixture.pendingOrderReads.splice(0)];for(const resolve of pending)resolve();await new Promise(resolve=>setTimeout(resolve,0));}")
        assert page.locator('#adminContent').is_hidden() and page.locator('#notificationList').inner_text() == ''
        assert page.locator('#visitsToday').inner_text() == '—'
        assert page.locator('#visitPages').inner_text() == ''
        assert page.locator('#researchOrderList').inner_text() == ''
        assert page.locator('#researchPendingCount').inner_text() == '—'
        assert_secret_not_persisted(page, logs)

        # A delayed approval response must not restore forms or claim success
        # after sign-out, an assurance downgrade, or leaving the page.
        for lock_kind in ('signout', 'downgrade', 'pagehide'):
            STATE['mode'] = 'admin'
            page.goto('https://ur-smart.test/admin.html')
            assert_research_orders(page)
            page.evaluate('window.__fixture.holdReview=true')
            first = page.locator('#researchOrderList .research-order').first
            first.locator('input[type=checkbox]').check()
            first.get_by_role('button', name='تأكيد الدفع والسماح بالتنفيذ', exact=True).click()
            page.wait_for_function('window.__fixture.pendingReviews.length===1')
            if lock_kind == 'signout':
                page.click('#logoutAdmin')
                wait_text(page, '#adminStatus', 'تم تسجيل الخروج')
            elif lock_kind == 'downgrade':
                page.evaluate("()=>{window.__fixture.aal='aal1';for(const callback of window.__fixture.listeners)callback('TOKEN_REFRESHED',{user:{id:'fixture-admin'}});}")
                wait_text(page, '#adminStatus', 'يلزم التحقق')
            else:
                page.evaluate("window.dispatchEvent(new Event('pagehide'))")
            assert page.locator('#adminContent').is_hidden()
            assert page.locator('#researchOrderList').inner_text() == ''
            assert page.locator('#researchOrderList form').count() == 0
            page.evaluate("async()=>{for(const resolve of window.__fixture.pendingReviews.splice(0))resolve();await new Promise(resolve=>setTimeout(resolve,0));}")
            assert page.locator('#adminContent').is_hidden()
            assert page.locator('#researchOrderList').inner_text() == ''
            assert 'تم تأكيد الدفع' not in page.locator('#researchOrdersStatus').inner_text()

        # Every stored registration remains reachable beyond the first batch.
        STATE['mode'] = 'pagination'
        page.goto('https://ur-smart.test/admin.html')
        page.wait_for_function("document.querySelectorAll('#notificationList .notification').length===50")
        page.wait_for_function("document.querySelectorAll('#researchOrderList .research-order').length===50")
        assert page.locator('#loadOlderNotifications').is_visible()
        page.click('#loadOlderNotifications')
        page.wait_for_function("document.querySelectorAll('#notificationList .notification').length===65")
        assert page.locator('#loadOlderNotifications').is_hidden()
        assert page.evaluate("new Set([...document.querySelectorAll('#notificationList .notification')].map(row=>row.dataset.notificationId)).size") == 65
        queries = page.evaluate("window.__fixture.calls.filter(call=>call.table==='signup_notifications'&&call.action==='select'&&!call.options.head)")
        assert [query['range'] for query in queries] == [[0,49],[50,99]]
        assert all(query['orders'] == [['registered_at',{'ascending':False}],['id',{'ascending':False}]] for query in queries)
        before = len(queries)
        assert_visits(page)
        visits_before = page.evaluate("window.__fixture.calls.filter(call=>call.rpc==='admin_site_visits').length")
        research_before = page.evaluate("window.__fixture.calls.filter(call=>call.table==='research_orders'&&!call.options.head).length")
        page.evaluate("async()=>{document.dispatchEvent(new Event('visibilitychange'));await new Promise(resolve=>setTimeout(resolve,0));}")
        assert page.evaluate("window.__fixture.calls.filter(call=>call.table==='signup_notifications'&&call.action==='select'&&!call.options.head).length") == before
        page.wait_for_function("before=>window.__fixture.calls.filter(call=>call.rpc==='admin_site_visits').length>before",arg=visits_before)
        page.wait_for_function("before=>window.__fixture.calls.filter(call=>call.table==='research_orders'&&!call.options.head).length>before",arg=research_before)
        old = page.locator('#notificationList .notification').filter(has_text='old-62@example.test')
        old.get_by_role('button', name='تعليم كمقروء', exact=True).click()
        page.wait_for_function("window.__fixture.rows.find(row=>row.email==='old-62@example.test').seen_at!==null&&[...document.querySelectorAll('#notificationList .notification.seen')].some(row=>row.textContent.includes('old-62@example.test'))")
        assert page.locator('#notificationList .notification').count() == 65
        page.click('#refreshNotifications')
        page.wait_for_function("document.querySelectorAll('#notificationList .notification').length===50")
        assert page.locator('#loadOlderNotifications').is_visible()
        page.click('#loadOlderResearchOrders')
        page.wait_for_function("document.querySelectorAll('#researchOrderList .research-order').length===65")
        assert page.locator('#loadOlderResearchOrders').is_hidden()
        assert page.evaluate("new Set([...document.querySelectorAll('#researchOrderList .research-order')].map(row=>row.dataset.orderId)).size") == 65
        research_queries = page.evaluate("window.__fixture.calls.filter(call=>call.table==='research_orders'&&!call.options.head)")
        assert research_queries[-1]['range'] == [50,99]
        page.select_option('#researchOrderFilter', 'approved')
        page.wait_for_function("document.querySelectorAll('#researchOrderList .research-order').length===1")
        assert 'طلب سابق معتمد' in page.locator('#researchOrderList').inner_text()
        page.select_option('#researchOrderFilter', 'waiting_payment')
        page.wait_for_function("document.querySelectorAll('#researchOrderList .research-order').length===50")
        assert page.locator('#loadOlderResearchOrders').is_visible()
        assert not errors, errors
        print(('Mobile' if mobile else 'Desktop')+': strict CSP, private admin MFA gates, safe signup/order fields, payment checkbox and review RPC, provider errors, order filters/pagination, draft-preserving polling, stale read/review cleanup, assurance downgrade, existing notifications/visits, and no secret storage pass using fixtures only.')
        context.close()
    browser.close()
