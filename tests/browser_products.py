"""Products quote UI, actual pinned Supabase SDK, isolated HTTP fixtures only.

No real account, order, payment, notification or provider call is made.
"""
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from datetime import datetime,timezone
import base64,copy,json,time
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parent.parent
SITE='https://products.test'
API='ynsmhtsktbubxfhsekjq.supabase.co'
KEY='sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc'
STORAGE='sb-ynsmhtsktbubxfhsekjq-auth-token'
OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
INQUIRY='11111111-1111-4111-8111-111111111111'
CREATED='22222222-2222-4222-8222-222222222222'
FOREIGN='33333333-3333-4333-8333-333333333333'
STAMP=datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def encode(v):return base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
def user(owner=OWNER):return {'id':owner,'aud':'authenticated','role':'authenticated','email':'fixture@example.invalid','email_confirmed_at':STAMP,'created_at':STAMP,'app_metadata':{'provider':'email'},'user_metadata':{},'identities':[]}
def session(owner=OWNER):
    now=int(time.time());token='.'.join([encode({'alg':'HS256','typ':'JWT'}),encode({'sub':owner,'aud':'authenticated','role':'authenticated','aal':'aal1','iat':now,'exp':now+3600}),'synthetic-signature-never-used-on-a-server'])
    return {'access_token':token,'refresh_token':'synthetic-products-refresh-never-sent','expires_in':3600,'expires_at':now+3600,'token_type':'bearer','user':user(owner)}
SESSION=session();OTHER_SESSION=session(OTHER)


def fixture(inquiry_id=INQUIRY,owner=OWNER):
    return {'id':inquiry_id,'owner_id':owner,'item_code':'weather_station','quantity':1,'province':'wasit','district':'قضاء الاختبار','area_donum':None,'contact_phone':'TEST-CONTACT-PRIVATE','customer_note':'ملاحظة خاصة لصاحب الطلب' if owner==OWNER else 'FOREIGN_PRIVATE_INQUIRY','status':'new','quote_iqd':None,'admin_reply':None,'created_at':STAMP,'updated_at':STAMP}


def route_factory(state):
    def handler(route):
        req=route.request;url=urlparse(req.url);state['urls'].append(req.url)
        if url.hostname=='products.test':
            file=ROOT/url.path.lstrip('/')
            if file.is_file():route.fulfill(body=file.read_bytes(),content_type={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'}.get(file.suffix,'text/html'));return
        if url.hostname!=API:route.abort('blockedbyclient');return
        cors={'access-control-allow-origin':SITE,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':req.headers.get('access-control-request-headers','apikey,authorization,content-type,x-client-info,x-supabase-api-version')}
        if req.method=='OPTIONS':route.fulfill(status=204,headers=cors);return
        if url.path=='/auth/v1/logout':route.fulfill(status=204,headers=cors);return
        bearer=req.headers.get('authorization','');requester=OWNER if bearer=='Bearer '+SESSION['access_token'] else OTHER if bearer=='Bearer '+OTHER_SESSION['access_token'] else None
        if url.path=='/auth/v1/user':route.fulfill(json=user(requester or OWNER),headers=cors);return
        if not requester:route.fulfill(status=401,json={'message':'Session required'},headers=cors);return
        query=parse_qs(url.query);body=json.loads(req.post_data) if req.post_data else None
        state['api'].append({'path':url.path,'query':query,'body':body,'requester':requester})
        if url.path=='/rest/v1/product_inquiries':
            assert query.get('owner_id')==['eq.'+requester]
            assert query.get('limit')==['50']
            assert query.get('select')==['id,owner_id,item_code,quantity,province,district,area_donum,contact_phone,customer_note,status,quote_iqd,admin_reply,created_at,updated_at']
            rows=copy.deepcopy(state['rows'])
            if state['hold']:state['held'].append((route,rows,cors));state['hold']=False;return
            route.fulfill(json=rows,headers=cors);return
        if url.path=='/rest/v1/rpc/create_product_inquiry':
            assert set(body)=={'p_item_code','p_quantity','p_province','p_district','p_area_donum','p_contact_phone','p_customer_note'}
            state['rpc'].append({'path':url.path,'body':body})
            if state['fail_create']:state['fail_create']=False;route.fulfill(status=500,json={'message':'SYNTHETIC-SERVER-PRIVATE-ERROR'},headers=cors);return
            assert body=={'p_item_code':'drip_installation','p_quantity':1,'p_province':'wasit','p_district':'الكوت','p_area_donum':12.5,'p_contact_phone':'+964 TEST 123','p_customer_note':'<img src=x onerror="window.__pwned=1"> طلب تنفيذ'}
            row=fixture(CREATED,requester);row.update(item_code=body['p_item_code'],quantity=body['p_quantity'],province=body['p_province'],district=body['p_district'],area_donum=body['p_area_donum'],contact_phone=body['p_contact_phone'],customer_note=body['p_customer_note']);state['rows'].insert(0,row)
            route.fulfill(json={'id':CREATED,'status':'new'},headers=cors);return
        if url.path=='/rest/v1/rpc/cancel_product_inquiry':
            assert body=={'p_inquiry_id':INQUIRY};state['rpc'].append({'path':url.path,'body':body});row=next(r for r in state['rows'] if r['id']==INQUIRY);assert row['status']=='new';row['status']='cancelled';route.fulfill(json={'id':INQUIRY,'status':'cancelled'},headers=cors);return
        route.abort('blockedbyclient')
    return handler


def setup(browser,mobile,signed=True):
    context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 960},is_mobile=mobile,has_touch=mobile)
    if signed:context.add_init_script('if(!localStorage.getItem('+json.dumps(STORAGE)+'))localStorage.setItem('+json.dumps(STORAGE)+','+json.dumps(json.dumps(SESSION))+');')
    state={'rows':[fixture(),fixture(FOREIGN,OTHER)],'urls':[],'api':[],'rpc':[],'hold':False,'held':[],'fail_create':False};context.route('**/*',route_factory(state));page=context.new_page();page.set_default_timeout(10000);errors=[];logs=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda e:logs.append(e.text));return context,page,state,errors,logs


def ready(page,item='drip_installation'):
    page.goto(SITE+'/products.html?item='+item,wait_until='domcontentloaded');expect(page.locator('#retryAccount')).to_be_enabled()
    if page.locator('#privateContent').is_visible():expect(page.locator('#refreshInquiries')).to_be_enabled()


def refresh(page):page.click('#refreshInquiries');expect(page.locator('#refreshInquiries')).to_be_enabled()
def wait_held(page,state):
    deadline=time.monotonic()+5
    while not state['held'] and time.monotonic()<deadline:page.wait_for_timeout(20)
    assert state['held'], 'A delayed fixture read should be in flight'


def choose(page,inquiry):page.locator('[data-inquiry-id="'+inquiry+'"]').click();expect(page.locator('#detailPanel')).to_be_visible()


def clean(page,errors,logs):
    assert not errors,errors
    assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1')
    assert page.evaluate('()=>window.__pwned') is None
    for secret in [SESSION['access_token'],OTHER_SESSION['access_token'],SESSION['refresh_token']]:assert secret not in page.content() and not any(secret in line for line in logs)


def close(context,state):
    for route,_,_ in state['held']:
        try:route.abort('blockedbyclient')
        except Exception:pass
    context.close()


def public_scenario(browser,mobile):
    context,page,state,errors,logs=setup(browser,mobile,False);ready(page)
    expect(page.locator('#accountStatus')).to_contain_text('سجّل الدخول');assert page.locator('#privateContent').is_hidden()
    assert page.locator('.product-card').count()==4
    for code in ['drip_supplies','drip_installation','weather_station','pest_station']:assert page.locator('[data-product="'+code+'"]').count()==1
    expect(page.locator('[data-product="drip_installation"]')).to_contain_text('واسط فقط');assert not state['api'] and not state['rpc'];clean(page,errors,logs);close(context,state)
    context=browser.new_context(java_script_enabled=False,viewport={'width':390 if mobile else 1280,'height':844 if mobile else 960});context.route('**/*',route_factory({'urls':[],'api':[],'rpc':[]}));page=context.new_page();page.goto(SITE+'/products.html');assert page.locator('.product-card').count()==4;expect(page.locator('[data-product="weather_station"]')).to_contain_text('محطة الطقس');context.close()


def inquiry_scenario(browser,mobile):
    context,page,state,errors,logs=setup(browser,mobile);ready(page)
    expect(page.locator('#privateContent')).to_be_visible();assert page.locator('#itemCode').input_value()=='drip_installation';assert page.locator('#province').input_value()=='wasit';assert page.locator('#quantity').is_disabled()
    assert 'FOREIGN_PRIVATE_INQUIRY' not in page.locator('#inquiriesList').inner_text();assert any(url.endswith('/vendor/supabase-js-2.57.4.js') for url in state['urls'])
    page.select_option('#province','baghdad');expect(page.locator('#eligibility')).to_contain_text('واسط فقط');assert page.locator('#createInquiry').is_disabled();assert not state['rpc']
    page.select_option('#province','wasit');page.fill('#district','الكوت');page.fill('#areaDonum','12.5');page.fill('#contactPhone','+964 TEST 123');page.fill('#customerNote','<img src=x onerror="window.__pwned=1"> طلب تنفيذ')
    state['fail_create']=True;page.click('#createInquiry');expect(page.locator('#createStatus')).to_contain_text('تعذر إرسال الطلب');assert 'SYNTHETIC-SERVER-PRIVATE-ERROR' not in page.content()
    page.click('#createInquiry');expect(page.locator('#createStatus')).to_contain_text('أُرسل طلب عرض السعر');expect(page.locator('#detailMeta')).to_contain_text(CREATED);assert page.locator('#detailNote img').count()==0;expect(page.locator('#detailFacts')).to_contain_text('١٢٫٥')
    row=next(r for r in state['rows'] if r['id']==CREATED);row.update(status='quoted',quote_iqd=78000,admin_reply='<img src=x onerror="window.__pwned=1"> نطاق تجريبي للتنفيذ في واسط فقط');refresh(page)
    expect(page.locator('#quoteAmount')).to_contain_text('٧٨٬٠٠٠');expect(page.locator('#adminReply')).to_contain_text('نطاق تجريبي');assert page.locator('#adminReply img').count()==0;assert page.locator('#cancelInquiry').is_hidden()
    Path('/workspace/artifacts').mkdir(exist_ok=True);page.screenshot(path='/workspace/artifacts/ur-smart-products-'+('mobile' if mobile else 'desktop')+'-test.png',full_page=True)
    page.locator('.hero').screenshot(path='/workspace/artifacts/ur-smart-products-'+('mobile' if mobile else 'desktop')+'-hero-test.png')
    page.locator('#detailPanel').screenshot(path='/workspace/artifacts/ur-smart-products-'+('mobile' if mobile else 'desktop')+'-quote-test.png')
    choose(page,INQUIRY);page.click('#cancelInquiry');expect(page.locator('#cancelStatus')).to_contain_text('أُلغي الطلب');assert page.locator('#cancelInquiry').is_hidden()
    page.select_option('#itemCode','weather_station');page.select_option('#province','basra');assert page.locator('#createInquiry').is_enabled();assert page.locator('#areaGroup').is_hidden();expect(page.locator('#provinceHelp')).to_contain_text('تؤكد الإدارة إمكانية التسليم');clean(page,errors,logs);close(context,state)


def account_switch_scenario(browser,mobile):
    context,page,state,errors,logs=setup(browser,mobile);ready(page);choose(page,INQUIRY);page.fill('#contactPhone','PRIVATE-DRAFT');page.fill('#customerNote','PRIVATE-DRAFT-NOTE');state['hold']=True;page.click('#refreshInquiries');expect(page.locator('#refreshInquiries')).to_be_disabled();wait_held(page,state);held,rows,cors=state['held'].pop()
    page.evaluate("async value=>{const {createClient}=await import('./supabase-client.mjs');const c=createClient('https://"+API+"','"+KEY+"');await c.auth.setSession({access_token:value.access_token,refresh_token:value.refresh_token});}",OTHER_SESSION)
    held.fulfill(json=rows,headers=cors)
    expect(page.locator('#inquiriesList')).not_to_contain_text(INQUIRY);assert page.locator('#contactPhone').input_value()!='PRIVATE-DRAFT';assert page.locator('#customerNote').input_value()!='PRIVATE-DRAFT-NOTE';expect(page.locator('#detailPanel')).to_be_hidden();clean(page,errors,logs);close(context,state)


def retry_pending_read_scenario(browser,mobile):
    context,page,state,errors,logs=setup(browser,mobile);ready(page);state['hold']=True;page.click('#refreshInquiries');wait_held(page,state);held,old_rows,cors=state['held'].pop()
    state['rows'][0].update(status='reviewing',admin_reply='FRESH-READ-REPLY')
    page.click('#retryAccount');expect(page.locator('#accountStatus')).to_contain_text('تم الاتصال');expect(page.locator('#refreshInquiries')).to_be_enabled()
    held.fulfill(json=old_rows,headers=cors);choose(page,INQUIRY);expect(page.locator('#adminReply')).to_contain_text('FRESH-READ-REPLY');assert page.locator('#refreshInquiries').is_enabled();clean(page,errors,logs);close(context,state)


def signout_scenario(browser,mobile):
    context,page,state,errors,logs=setup(browser,mobile);ready(page);choose(page,INQUIRY);page.fill('#contactPhone','PRIVATE-DRAFT');page.fill('#customerNote','PRIVATE-NOTE')
    second=context.new_page();second.goto(SITE+'/products.html',wait_until='domcontentloaded')
    second.evaluate("async()=>{const {createClient}=await import('./supabase-client.mjs');const c=createClient('https://"+API+"','"+KEY+"');await c.auth.signOut({scope:'local'});}")
    expect(page.locator('#privateContent')).to_be_hidden();expect(page.locator('#accountStatus')).to_contain_text('انتهت جلسة');assert page.locator('#contactPhone').input_value()=='';assert page.locator('#customerNote').input_value()=='';assert page.locator('#inquiriesList').inner_text()=='';assert page.locator('#detailFacts').inner_text()=='';clean(page,errors,logs);close(context,state)


def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        for mobile in [False,True]:
            public_scenario(browser,mobile);inquiry_scenario(browser,mobile);account_switch_scenario(browser,mobile);retry_pending_read_scenario(browser,mobile);signout_scenario(browser,mobile)
            print(('Mobile' if mobile else 'Desktop')+': actual pinned SDK, public4card/noJS catalogue, owned requests, exact RPC payload, Wasit-only execution, quoted replies, cancellation, private-text safety, account switch/late reply and cross-tab signout PASS; all HTTP isolated fixtures.')
        browser.close()


if __name__=='__main__':main()
