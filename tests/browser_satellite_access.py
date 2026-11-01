"""Paid satellite UI with the actual local Supabase SDK and isolated HTTP fixtures.

No production sessions, transfers, database writes, or provider calls are made.
"""
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timedelta, timezone
import base64
import copy
import json
import time
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
SITE='https://satellite-access.test'
API='ynsmhtsktbubxfhsekjq.supabase.co'
KEY='sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc'
STORAGE='sb-ynsmhtsktbubxfhsekjq-auth-token'
OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
FIELD='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
OTHER_FIELD='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
ORDER='11111111-1111-4111-8111-111111111111'
NEW='22222222-2222-4222-8222-222222222222'
FOREIGN='33333333-3333-4333-8333-333333333333'
NOW=datetime.now(timezone.utc).replace(microsecond=0)
STAMP=NOW.isoformat()


def encode(v):return base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
def user(owner=OWNER):return {'id':owner,'aud':'authenticated','role':'authenticated','email':'fixture@example.invalid','email_confirmed_at':STAMP,'created_at':STAMP,'app_metadata':{'provider':'email'},'user_metadata':{},'identities':[]}
def session(owner=OWNER):
    now=int(time.time());token='.'.join([encode({'alg':'HS256','typ':'JWT'}),encode({'sub':owner,'aud':'authenticated','role':'authenticated','aal':'aal1','iat':now,'exp':now+3600}),'synthetic-signature-never-used-on-a-server'])
    return {'access_token':token,'refresh_token':'synthetic-refresh-never-sent','expires_in':3600,'expires_at':now+3600,'token_type':'bearer','user':user(owner)}
SESSION=session();OTHER_SESSION=session(OTHER)


def order_fixture(order_id=ORDER):
    return {'id':order_id,'owner_id':OWNER,'field_id':FIELD,'request_note':'مؤشرات الحقل والمشاهد المتاحة','status':'waiting_quote','quote_iqd':None,'quote_scope':None,'quote_version':0,'quoted_at':None,'accepted_at':None,'payment_reference':None,'admin_note':None,'approved_at':None,'expires_at':None,'duration_days':30,'created_at':STAMP,'updated_at':STAMP}


def quote(row,version=1,duration=7):
    row.update(status='quoted',quote_iqd=45000,quote_scope='<img src=x onerror="window.__pwned=1"> مؤشرات ومشاهد متاحة لحقل محدد',quote_version=version,quoted_at=STAMP,duration_days=duration)


def route_factory(state):
    def handler(route):
        req=route.request;url=urlparse(req.url);state['urls'].append(req.url)
        if url.hostname=='satellite-access.test':
            file=ROOT/url.path.lstrip('/')
            if file.is_file():route.fulfill(body=file.read_bytes(),content_type={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'}.get(file.suffix,'text/html'));return
        if url.hostname!=API:route.abort('blockedbyclient');return
        cors={'access-control-allow-origin':SITE,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':req.headers.get('access-control-request-headers','apikey,authorization,content-type,x-client-info,x-supabase-api-version')}
        if req.method=='OPTIONS':route.fulfill(status=204,headers=cors);return
        if url.path=='/auth/v1/logout':route.fulfill(status=204,headers=cors);return
        if url.path=='/auth/v1/user':route.fulfill(json=user(state['owner']),headers=cors);return
        token=SESSION['access_token'] if state['owner']==OWNER else OTHER_SESSION['access_token']
        if req.headers.get('authorization')=='Bearer '+KEY:route.fulfill(status=401,json={'message':'Session required'},headers=cors);return
        assert req.headers.get('authorization')=='Bearer '+token
        query=parse_qs(url.query);body=json.loads(req.post_data) if req.post_data else None
        state['api'].append({'path':url.path,'query':query,'body':body})
        if url.path=='/rest/v1/fields':
            assert query.get('farms.owner_id')==['eq.'+state['owner']]
            rows=[] if state['deleted'] else [{'id':FIELD,'name':'حقل الاختبار الفضائي','farms':{'owner_id':OWNER}},{'id':OTHER_FIELD,'name':'FOREIGN_PRIVATE_FIELD','farms':{'owner_id':OTHER}}]
            if state['owner']!=OWNER:rows=[rows[-1]] if rows else []
            route.fulfill(json=rows,headers=cors);return
        if url.path=='/rest/v1/satellite_access_orders':
            assert query.get('owner_id')==['eq.'+state['owner']]
            assert query.get('limit')==['50']
            assert all(secret not in query['select'][0] for secret in ['quoted_by','approved_by','accepted_quote_version'])
            rows=copy.deepcopy(state['orders'])
            if state['hold_orders']:state['held'].append((route,rows,cors));state['hold_orders']=False;return
            route.fulfill(json=rows,headers=cors);return
        if url.path=='/rest/v1/rpc/create_satellite_access_order':
            assert set(body)=={'p_field_id','p_duration_days','p_request_note'}
            assert body['p_field_id']==FIELD and body['p_duration_days']==14
            state['rpc'].append(body);row=order_fixture(NEW);row['duration_days']=14;row['request_note']=body['p_request_note'];state['orders'].insert(0,row)
            route.fulfill(json={'id':NEW,'status':'waiting_quote'},headers=cors);return
        if url.path=='/rest/v1/rpc/accept_satellite_access_quote':
            assert set(body)=={'p_order_id','p_quote_version','p_payment_reference'}
            state['rpc'].append(body);row=next(r for r in state['orders'] if r['id']==body['p_order_id'])
            if row['quote_version']!=body['p_quote_version']:route.fulfill(status=409,json={'code':'55000','message':'Current quote changed'},headers=cors);return
            assert row['status']=='quoted' and body['p_quote_version']==2
            row.update(status='awaiting_payment',accepted_at=STAMP,payment_reference=body['p_payment_reference'])
            route.fulfill(json={'id':row['id'],'status':'awaiting_payment','quote_version':row['quote_version']},headers=cors);return
        route.abort('blockedbyclient')
    return handler


def setup(browser,mobile,signed=True):
    ctx=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 960},is_mobile=mobile,has_touch=mobile)
    if signed:ctx.add_init_script('if(!localStorage.getItem('+json.dumps(STORAGE)+'))localStorage.setItem('+json.dumps(STORAGE)+','+json.dumps(json.dumps(SESSION))+');')
    foreign=order_fixture(FOREIGN);foreign.update(owner_id=OTHER,field_id=OTHER_FIELD,request_note='FOREIGN_PRIVATE_ORDER')
    state={'orders':[order_fixture(),foreign],'owner':OWNER,'deleted':False,'hold_orders':False,'held':[],'urls':[],'api':[],'rpc':[]}
    ctx.route('**/*',route_factory(state));page=ctx.new_page();page.set_default_timeout(10000);errors=[];logs=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda e:logs.append(e.text));return ctx,page,state,errors,logs


def ready(page):
    page.goto(SITE+'/satellite-access.html?field='+FIELD,wait_until='domcontentloaded')
    page.wait_for_function("()=>!document.querySelector('#retryAccount').disabled")
    if page.locator('#paidContent').is_visible():page.wait_for_function("()=>!document.querySelector('#refreshOrders').disabled&&!document.querySelector('#refreshFields').disabled")


def refresh(page):
    page.click('#refreshOrders');page.wait_for_function("()=>!document.querySelector('#refreshOrders').disabled")


def choose(page,order_id):page.locator('[data-order-id="'+order_id+'"]').click();expect(page.locator('#selectedPanel')).to_be_visible()


def clean(page,errors,logs):
    assert not errors,errors
    assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1')
    assert page.evaluate('()=>window.__pwned') is None
    for secret in [SESSION['access_token'],OTHER_SESSION['access_token'],SESSION['refresh_token']]:assert secret not in page.content() and not any(secret in line for line in logs)


def close(ctx,state):
    for route,_,_ in state['held']:
        try:route.abort('blockedbyclient')
        except Exception:pass
    ctx.close()


def public_scenario(browser,mobile):
    ctx,page,state,errors,logs=setup(browser,mobile,False);ready(page)
    expect(page.locator('#accountStatus')).to_contain_text('سجّل الدخول');assert page.locator('#paidContent').is_hidden()
    expect(page.locator('.hero')).to_contain_text('مدفوعة');assert not state['api'] and not state['rpc'];clean(page,errors,logs);close(ctx,state)


def quote_and_access_scenario(browser,mobile):
    ctx,page,state,errors,logs=setup(browser,mobile);ready(page)
    expect(page.locator('#paidContent')).to_be_visible();assert page.locator('#orderField').input_value()==FIELD
    assert 'FOREIGN_PRIVATE_FIELD' not in page.locator('#orderField').inner_text();assert 'FOREIGN_PRIVATE_ORDER' not in page.locator('#ordersList').inner_text()
    assert any(url.endswith('/vendor/supabase-js-2.57.4.js') for url in state['urls'])
    page.fill('#durationDays','14');page.fill('#orderNotes','مؤشرات الحقل فقط');page.click('#createOrder')
    expect(page.locator('#createStatus')).to_contain_text('أُرسل الطلب');expect(page.locator('#selectedOrderMeta')).to_contain_text(NEW)
    row=next(r for r in state['orders'] if r['id']==NEW);quote(row);refresh(page)
    expect(page.locator('#quoteMeta')).to_contain_text('٧ يومًا');expect(page.locator('#quoteAmount')).to_contain_text('٤٥٬٠٠٠')
    assert page.locator('#acceptQuote').is_disabled();assert page.locator('#analysisLinks').is_hidden();assert page.locator('#quoteScope img').count()==0
    expect(page.locator('.boundary-policy')).to_contain_text('حفظ حدود الحقل')
    page.check('#acceptQuoteConsent');quote(row,version=2,duration=14);page.click('#acceptQuote')
    expect(page.locator('#quoteStatus')).to_contain_text('تغيّرت حالة العرض');assert row['status']=='quoted';assert page.locator('#analysisLinks').is_hidden()
    refresh(page);assert not page.is_checked('#acceptQuoteConsent');expect(page.locator('#quoteMeta')).to_contain_text('١٤ يومًا')
    page.check('#acceptQuoteConsent');page.fill('#quotePaymentReference','TEST-REFERENCE');page.click('#acceptQuote')
    expect(page.locator('#paymentStatus')).to_contain_text('يتبقى تأكيد الإدارة');page.wait_for_function("()=>!document.querySelector('#refreshOrders').disabled")
    assert row['status']=='awaiting_payment';assert row['approved_at'] is None;assert page.locator('#analysisLinks').is_hidden()
    row.update(status='approved',approved_at=STAMP,expires_at=(NOW+timedelta(days=14)).isoformat());refresh(page)
    expect(page.locator('#analysisLinks')).to_be_visible();assert page.locator('#analysisLink').get_attribute('href')=='./satellite-analysis.html?field='+FIELD
    assert page.locator('#fieldMapLink').get_attribute('href')=='./field-map.html?field='+FIELD
    expect(page.locator('#expiryStatus')).to_contain_text('بداية التفعيل');expect(page.locator('#paymentStatus')).to_contain_text('استلام الدفع')
    Path('/workspace/artifacts').mkdir(exist_ok=True);page.locator('#selectedPanel').scroll_into_view_if_needed();page.screenshot(path='/workspace/artifacts/ur-smart-satellite-access-'+('mobile' if mobile else 'desktop')+'-test.png')
    row['expires_at']=(NOW-timedelta(seconds=1)).isoformat();refresh(page)
    expect(page.locator('#selectedOrderStatus')).to_contain_text('انتهت مدة التفعيل');assert page.locator('#analysisLinks').is_hidden()
    assert page.locator('#analysisLink').get_attribute('href')=='./satellite-analysis.html'
    clean(page,errors,logs);close(ctx,state)


def deletion_scenario(browser,mobile):
    ctx,page,state,errors,logs=setup(browser,mobile);row=state['orders'][0];quote(row);row['field_id']=None;state['deleted']=True;ready(page);choose(page,ORDER)
    expect(page.locator('#selectedOrderMeta')).to_contain_text('حقل محذوف');assert page.locator('#quoteAcceptance').is_hidden();assert page.locator('#analysisLinks').is_hidden();assert page.locator('#createOrder').is_disabled();clean(page,errors,logs);close(ctx,state)


def account_switch_scenario(browser,mobile):
    ctx,page,state,errors,logs=setup(browser,mobile);quote(state['orders'][0]);ready(page);choose(page,ORDER)
    page.fill('#quotePaymentReference','PRIVATE-DRAFT');page.check('#acceptQuoteConsent');state['hold_orders']=True;page.click('#refreshOrders');page.wait_for_timeout(30)
    assert state['held'];held,rows,cors=state['held'].pop()
    state['owner']=OTHER
    page.evaluate("async value=>{const {createClient}=await import('./supabase-client.mjs');const c=createClient('https://"+API+"','"+KEY+"');await c.auth.setSession({access_token:value.access_token,refresh_token:value.refresh_token});}",OTHER_SESSION)
    held.fulfill(json=rows,headers=cors)
    expect(page.locator('#ordersList')).not_to_contain_text('مؤشرات الحقل والمشاهد المتاحة')
    assert page.locator('#quotePaymentReference').input_value()!='PRIVATE-DRAFT';assert not page.is_checked('#acceptQuoteConsent');clean(page,errors,logs);close(ctx,state)


def signout_scenario(browser,mobile):
    ctx,page,state,errors,logs=setup(browser,mobile);quote(state['orders'][0]);ready(page);choose(page,ORDER);page.fill('#quotePaymentReference','PRIVATE-DRAFT');page.check('#acceptQuoteConsent')
    second=ctx.new_page();second.goto(SITE+'/satellite-access.html',wait_until='domcontentloaded')
    second.evaluate("async()=>{const {createClient}=await import('./supabase-client.mjs');const c=createClient('https://"+API+"','"+KEY+"');await c.auth.signOut({scope:'local'});}")
    expect(page.locator('#paidContent')).to_be_hidden();expect(page.locator('#accountStatus')).to_contain_text('لا توجد جلسة');assert page.locator('#quotePaymentReference').input_value()=='';assert not page.is_checked('#acceptQuoteConsent');assert page.locator('#ordersList').inner_text()=='';clean(page,errors,logs);close(ctx,state)


def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        for mobile in [False,True]:
            public_scenario(browser,mobile);quote_and_access_scenario(browser,mobile);deletion_scenario(browser,mobile);account_switch_scenario(browser,mobile);signout_scenario(browser,mobile)
            print(('Mobile' if mobile else 'Desktop')+': actual pinned SDK, owned fields/orders, quote version and duration, manual payment, expiry, deleted field, safe text, stale reads/account switch and cross-tab signout passed; isolated fixtures only.')
        browser.close()


if __name__=='__main__':main()
