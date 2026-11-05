"""Paid field-service acceptance with the actual pinned browser Supabase SDK.

All HTTP is intercepted. Quotes, users, payments, reports and satellite/weather
values are synthetic fixtures. No production account, payment, database write,
Gemini call or scheduled monitoring job is used by this test.
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
SITE='https://field-service.test'
API_HOST='ynsmhtsktbubxfhsekjq.supabase.co'
WORKER_HOST='ur-smart-satellite.alialbatekh111.workers.dev'
STORAGE_KEY='sb-ynsmhtsktbubxfhsekjq-auth-token'
PUBLIC_KEY='sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc'
OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
FIELD='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
OTHER_FIELD='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
ORDER='11111111-1111-4111-8111-111111111111'
MONITOR='22222222-2222-4222-8222-222222222222'
REPORT='33333333-3333-4333-8333-333333333333'
FOREIGN_ORDER='44444444-4444-4444-8444-444444444444'
CREATED_ORDER='55555555-5555-4555-8555-555555555555'
REFRESH_TOKEN='synthetic-field-refresh-never-sent-to-a-server'
NOW=datetime.now(timezone.utc).replace(microsecond=0)
STAMP=NOW.isoformat().replace('+00:00','Z')


def encode(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')


def user(owner=OWNER):
    return {'id':owner,'aud':'authenticated','role':'authenticated',
            'email':'field-fixture@example.invalid','email_confirmed_at':'2026-01-01T00:00:00Z',
            'created_at':'2026-01-01T00:00:00Z','app_metadata':{'provider':'email'},
            'user_metadata':{},'identities':[]}


def session(owner=OWNER):
    now=int(time.time())
    token='.'.join([encode({'alg':'HS256','typ':'JWT'}),
                    encode({'sub':owner,'aud':'authenticated','role':'authenticated','aal':'aal1','iat':now,'exp':now+3600}),
                    'synthetic-signature-never-used-on-a-server'])
    return {'access_token':token,'refresh_token':REFRESH_TOKEN,'token_type':'bearer',
            'expires_in':3600,'expires_at':now+3600,'user':user(owner)}


SESSION=session()
ACCESS_TOKEN=SESSION['access_token']
OTHER_SESSION=session(OTHER)


def order_fixture(order_id=ORDER,service='field_report',status='waiting_quote'):
    return {'id':order_id,'owner_id':OWNER,'field_id':FIELD,'service_type':service,
            'request_note':'تقرير شامل للحقل مع توضيح البيانات الناقصة',
            'cadence_days':7 if service=='field_monitoring' else None,
            'report_count':3 if service=='field_monitoring' else 1,'status':status,
            'quote_iqd':None,'quote_scope':None,'quote_version':0,'quoted_at':None,
            'accepted_at':None,'payment_reference':None,'approved_at':None,
            'created_at':STAMP,'updated_at':STAMP,'completed_reports':0,
            'period_attempts':0,'started_at':None,'next_due_at':None}


def report_fixture(service='field_report'):
    return {'schema_version':1,'created_at':STAMP,'service_type':service,
            'report_number':1,'due_at':STAMP,'summary':'<img src=x onerror="window.__paidPwned=1"> تقرير اصطناعي لمراجعة حقلي',
            'field':{'id':FIELD,'name':'حقل الاختبار المدفوع','crop':'حنطة','area_donum':4,'soil':'مزيجية','irrigation':'تنقيط'},
            'satellite':{'source':'Sentinel-2 L2A','date':NOW.date().isoformat(),
                         'indices':{'NDVI':0.63,'NDMI':0.21},'ndvi':0.63,'ndmi':0.21,'valid_pixels':90,'geometry_pixels':100,'coverage_percent':90},
            'weather':{'source':'MET Norway','fetched_at':STAMP,'timezone':'Asia/Baghdad',
                       'current':{'temperature_c':27,'humidity_percent':51,'wind_kmh':13}},
            'irrigation_logs':[],'comparison':None,'notes':[],
            'sources':{'satellite':'Sentinel-2 L2A','weather':'MET Norway'},
            'observations':['المشهد المتاح له تاريخ وتغطية معلومان'],
            'recommendations':['تحقق من رطوبة منطقة الجذور قبل تعديل الري'],
            'limitations':['هذه قيم اختبار وليست قياسات إنتاجية أو مراجعة مهندس'],
            'next_steps':['قارن التحديث المقبل مع هذا التقرير']}


def response_headers(request):
    return {'access-control-allow-origin':SITE,'access-control-allow-methods':'GET,POST,OPTIONS',
            'access-control-allow-headers':request.headers.get('access-control-request-headers',
               'apikey,authorization,content-type,x-client-info,x-supabase-api-version')}


def route_factory(state):
    def route_request(route):
        request=route.request;url=urlparse(request.url);state['requests'].append(request.url)
        if url.hostname=='field-service.test':
            file=ROOT/url.path.lstrip('/')
            if file.is_file():
                route.fulfill(body=file.read_bytes(),content_type={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'}.get(file.suffix,'text/html'));return
        if url.hostname==API_HOST:
            cors=response_headers(request)
            if request.method=='OPTIONS':route.fulfill(status=204,headers=cors);return
            state['api'].append({'path':url.path,'method':request.method,'query':parse_qs(url.query),
                                 'body':json.loads(request.post_data) if request.post_data else None})
            if url.path=='/auth/v1/user':route.fulfill(json=user(state['active_owner']),headers=cors);return
            if url.path=='/auth/v1/logout':route.fulfill(status=204,headers=cors);return
            token=SESSION['access_token'] if state['active_owner']==OWNER else OTHER_SESSION['access_token']
            if request.headers.get('authorization')=='Bearer '+PUBLIC_KEY:
                route.fulfill(status=401,json={'message':'A session is required'},headers=cors);return
            assert request.headers.get('authorization')=='Bearer '+token
            if url.path=='/rest/v1/fields':
                assert parse_qs(url.query).get('farms.owner_id')==['eq.'+state['active_owner']]
                if state.get('fields_deleted'):route.fulfill(json=[],headers=cors);return
                route.fulfill(json=[{'id':FIELD,'name':'حقل الاختبار المدفوع','farms':{'owner_id':OWNER}},
                                    {'id':OTHER_FIELD,'name':'FOREIGN_PRIVATE_FIELD','farms':{'owner_id':OTHER}}],headers=cors);return
            if url.path=='/rest/v1/field_service_orders':
                assert parse_qs(url.query).get('owner_id')==['eq.'+state['active_owner']]
                if state['mode']=='orders_fail':route.fulfill(status=503,json={'message':'synthetic unavailable'},headers=cors);return
                route.fulfill(json=copy.deepcopy(state['orders']),headers=cors);return
            if url.path=='/rest/v1/field_service_reports':
                assert parse_qs(url.query).get('owner_id')==['eq.'+state['active_owner']]
                query=parse_qs(url.query);selected=query.get('order_id',[None])[0]
                rows=[row for row in state['reports'] if selected is None or selected=='eq.'+row['order_id']]
                route.fulfill(json=copy.deepcopy(rows),headers=cors);return
            if url.path=='/rest/v1/rpc/create_field_service_order':
                body=json.loads(request.post_data);state['rpc'].append({'name':'create','body':body})
                assert set(body)=={'p_field_id','p_service_type','p_request_note','p_cadence_days','p_report_count'}
                assert body['p_field_id']==FIELD
                assert body['p_service_type'] in ('field_report','field_monitoring')
                if body['p_service_type']=='field_report':assert body['p_cadence_days'] is None and body['p_report_count']==1
                else:assert body['p_cadence_days'] in (7,14,30) and 2<=body['p_report_count']<=12
                row=order_fixture(CREATED_ORDER,body['p_service_type']);row['request_note']=body['p_request_note'];row['cadence_days']=body['p_cadence_days'];row['report_count']=body['p_report_count'];state['orders'].insert(0,row)
                route.fulfill(json=copy.deepcopy(row),headers=cors);return
            if url.path=='/rest/v1/rpc/accept_field_service_quote':
                body=json.loads(request.post_data);state['rpc'].append({'name':'accept','body':body})
                assert set(body)=={'p_order_id','p_quote_version','p_payment_reference'}
                row=next(row for row in state['orders'] if row['id']==body['p_order_id'])
                assert row['owner_id']==state['active_owner'] and row['status']=='quoted'
                assert row['quote_iqd'] is not None and row['quote_scope']
                if state['mode']=='quote_changed':
                    row['quote_version']+=1;row['quote_iqd']=68000
                    route.fulfill(status=400,json={'message':'Quote changed; refresh before accepting'},headers=cors);return
                assert body['p_quote_version']==row['quote_version']
                row['status']='awaiting_payment';row['accepted_at']=STAMP;row['payment_reference']=body['p_payment_reference'];row['approved_at']=None
                route.fulfill(json=copy.deepcopy(row),headers=cors);return
            raise AssertionError('Unexpected database/auth path '+url.path)
        if url.hostname==WORKER_HOST:
            cors=response_headers(request)
            if request.method=='OPTIONS':route.fulfill(status=204,headers=cors);return
            if url.path=='/field-service/status':
                route.fulfill(json={'available':True,'quote_required':True,'manual_admin_approval_required':True,'scheduled_automatically':False},headers=cors);return
            if url.path=='/field-service':
                assert request.method=='POST'
                token=SESSION['access_token'] if state['active_owner']==OWNER else OTHER_SESSION['access_token']
                assert request.headers.get('authorization')=='Bearer '+token
                body=json.loads(request.post_data);state['runs'].append(body)
                assert set(body)=={'order_id','consent'} and body['consent'] is True
                row=next((row for row in state['orders'] if row['id']==body['order_id'] and row['owner_id']==state['active_owner']),None)
                if not row or not row['approved_at'] or not row['accepted_at'] or row['status'] not in ('approved','failed'):
                    route.fulfill(status=403,json={'message':'Payment has not been confirmed'},headers=cors);return
                if row['completed_reports']>=row['report_count']:
                    route.fulfill(status=409,json={'message':'All agreed reports are complete'},headers=cors);return
                if row['next_due_at'] and datetime.fromisoformat(row['next_due_at'].replace('Z','+00:00'))>datetime.now(timezone.utc):
                    route.fulfill(status=409,json={'message':'The next period is not due'},headers=cors);return
                if state['mode']=='hold_run':state['held'].append((route,copy.deepcopy(row),cors));return
                if state['mode']=='boundary_error':route.fulfill(status=404,json={'code':'FIELD_UNAVAILABLE','message':'الحقل أو حدوده غير متاحة لهذا الحساب'},headers=cors);return
                if state['mode']=='run_fail':route.fulfill(status=502,json={'message':'Data temporarily unavailable'},headers=cors);return
                result=copy.deepcopy(state['result']);result['service_type']=row['service_type']
                result['report_number']=row['completed_reports']+1
                report_id=REPORT if result['report_number']==1 else '33333333-3333-4333-8333-'+str(result['report_number']).zfill(12)
                if state['mode']=='no_sources':
                    row['status']='failed';row['period_attempts']+=1
                    result.update(satellite=None,weather=None,summary='تعذر جلب مصادر فعلية؛ لا يحتسب تقرير',recommendations=[],limitations=['لم تتوفر بيانات فضائية أو طقس فعلية'])
                    result['sources']={'satellite':None,'weather':None}
                    state['reports'].insert(0,{'id':report_id,'order_id':row['id'],'owner_id':state['active_owner'],'report_number':result['report_number'],'due_at':STAMP,'status':'failed','created_at':STAMP,'result':result})
                    route.fulfill(status=502,json={'order_id':row['id'],'status':'failed','code':'NO_SOURCE_DATA','result_saved':True,'message':'تعذر جلب المصادر؛ لم يُحتسب تقرير. حدّث سجل الطلب.'},headers=cors);return
                outcome='needs_review' if state['mode']=='partial' else 'completed'
                if outcome=='needs_review':
                    result['weather']=None;result['sources']['weather']=None
                    result['limitations'].append('لم تتوفر بيانات الطقس؛ التقرير جزئي ويحتسب ضمن العدد')
                row['completed_reports']+=1;row['period_attempts']=0
                complete=row['completed_reports']>=row['report_count'];row['status']='completed' if complete else 'approved'
                row['next_due_at']=None if complete else (datetime.now(timezone.utc)+timedelta(days=row['cadence_days'])).isoformat()
                report={'id':report_id,'order_id':row['id'],'owner_id':state['active_owner'],'report_number':row['completed_reports'],'due_at':STAMP,'status':outcome,'created_at':STAMP,'result':result}
                state['reports']=[item for item in state['reports'] if not(item['order_id']==row['id'] and item['report_number']==result['report_number'])]
                state['reports'].insert(0,report)
                route.fulfill(json={'order_id':row['id'],'report_id':report_id,'report_number':row['completed_reports'],'status':outcome,'order_status':row['status'],'completed_reports':row['completed_reports'],'next_due_at':row['next_due_at'],'result':result},headers=cors);return
        route.abort('blockedbyclient')
    return route_request


def context_for(browser,mobile,authenticated=True):
    context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 960},is_mobile=mobile,has_touch=mobile,accept_downloads=True)
    if authenticated:
        context.add_init_script('if(!localStorage.getItem('+json.dumps(STORAGE_KEY)+'))localStorage.setItem('+json.dumps(STORAGE_KEY)+','+json.dumps(json.dumps(SESSION))+');')
    foreign=order_fixture(FOREIGN_ORDER);foreign['owner_id']=OTHER;foreign['field_id']=OTHER_FIELD;foreign['request_note']='FOREIGN_PRIVATE_ORDER'
    state={'active_owner':OWNER,'orders':[order_fixture(),order_fixture(MONITOR,'field_monitoring'),foreign],
           'reports':[],'requests':[],'api':[],'rpc':[],'runs':[],'held':[],'mode':'ready','result':report_fixture()}
    context.route('**/*',route_factory(state));page=context.new_page();page.set_default_timeout(10000)
    errors=[];console=[];page.on('pageerror',lambda error:errors.append(str(error)));page.on('console',lambda entry:console.append(entry.text))
    return context,page,state,errors,console


def ready(page,query='?service=field_report&field='+FIELD):
    page.goto(SITE+'/field-services.html'+query,wait_until='domcontentloaded')
    page.wait_for_function("()=>document.querySelector('#retryAccount')&&!document.querySelector('#retryAccount').disabled")


def select_order(page,order=ORDER):
    page.locator('[data-order-id="'+order+'"]').click()
    expect(page.locator('#selectedPanel')).to_be_visible()


def quote_order(state,order=ORDER,amount=47000):
    row=next(row for row in state['orders'] if row['id']==order)
    row.update(status='quoted',quote_iqd=amount,quote_scope='تقرير شامل متفق عليه: مؤشرات ومشهد متاح وطقس وملاحظات دون مراجعة مهندس',quote_version=row['quote_version']+1,quoted_at=STAMP,accepted_at=None,approved_at=None)
    return row


def paid_order(state,order=ORDER):
    row=next(row for row in state['orders'] if row['id']==order)
    row.update(status='approved',accepted_at=STAMP,approved_at=STAMP,next_due_at=STAMP)
    return row


def close(context,state):
    for held,_,_ in state['held']:
        try:held.abort('blockedbyclient')
        except Exception:pass
    context.close()


def wait_loaded(page):
    page.wait_for_function("()=>!document.querySelector('#refreshOrders').disabled")


def refresh(page):
    page.click('#refreshOrders');wait_loaded(page)


def assert_no_secrets(page,console):
    for secret in [ACCESS_TOKEN,OTHER_SESSION['access_token'],REFRESH_TOKEN]:
        assert secret not in page.content() and not any(secret in entry for entry in console)
    assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1')


def anonymous_scenario(browser,mobile):
    context,page,state,errors,console=context_for(browser,mobile,False)
    ready(page)
    expect(page.locator('#accountStatus')).to_contain_text('سجّل الدخول')
    assert page.locator('#paidContent').is_hidden()
    assert page.locator('#loginLink').is_visible()
    assert not state['rpc'] and not state['runs']
    assert not any(call['path'].startswith('/rest/v1/') for call in state['api'])
    assert_no_secrets(page,console);assert not errors,errors
    close(context,state)


def paid_report_scenario(browser,mobile):
    context,page,state,errors,console=context_for(browser,mobile)
    ready(page);expect(page.locator('#paidContent')).to_be_visible();wait_loaded(page)
    assert page.locator('#orderField').input_value()==FIELD
    assert page.locator('#serviceType').input_value()=='field_report'
    assert 'مدفوعة' in page.locator('body').inner_text()
    assert 'FOREIGN_PRIVATE_FIELD' not in page.locator('#orderField').inner_text()
    assert 'FOREIGN_PRIVATE_ORDER' not in page.locator('#ordersList').inner_text()
    assert any(url.endswith('/supabase-client.mjs') for url in state['requests'])
    assert any(url.endswith('/vendor/supabase-js-2.57.4.js') for url in state['requests'])
    assert not any('cdn.jsdelivr.net' in url or 'fonts.googleapis.com' in url for url in state['requests'])
    page.fill('#orderNotes','تقرير مدفوع عن حقل اختبار، لا رسوم محددة قبل عرض الإدارة')
    page.click('#createOrder')
    page.wait_for_function("()=>!document.querySelector('#createOrder').disabled")
    assert len([row for row in state['rpc'] if row['name']=='create'])==1
    created=next(row for row in state['orders'] if row['id']==CREATED_ORDER)
    assert created['status']=='waiting_quote' and created['quote_iqd'] is None and created['approved_at'] is None
    create=next(row['body'] for row in state['rpc'] if row['name']=='create')
    assert 'p_quote_iqd' not in create and 'p_status' not in create and 'p_approved_at' not in create

    select_order(page,ORDER)
    assert page.locator('#runReport').is_disabled()
    assert page.locator('#acceptQuote').is_disabled() or page.locator('#acceptQuote').is_hidden()
    assert not state['runs']
    quoted=quote_order(state);refresh(page)
    expect(page.locator('#quoteDetails')).to_contain_text(quoted['quote_scope'])
    quoted_amount=page.evaluate("value=>new Intl.NumberFormat('ar-IQ').format(value)",quoted['quote_iqd'])
    assert quoted_amount in page.locator('#quoteDetails').inner_text()
    assert page.locator('#runReport').is_disabled()
    assert page.locator('#acceptQuote').is_disabled()
    page.check('#acceptQuoteConsent');page.fill('#quotePaymentReference','TEST-REFERENCE-NO-REAL-PAYMENT')
    page.click('#acceptQuote')
    expect(page.locator('#paymentStatus')).to_contain_text('تنتظر الخدمة تأكيد الإدارة')
    wait_loaded(page)
    accepted=[row['body'] for row in state['rpc'] if row['name']=='accept']
    assert len(accepted)==1 and accepted[0]['p_quote_version']==quoted['quote_version']
    assert accepted[0]['p_payment_reference']=='TEST-REFERENCE-NO-REAL-PAYMENT'
    row=next(row for row in state['orders'] if row['id']==ORDER)
    assert row['status']=='awaiting_payment' and row['accepted_at'] and row['approved_at'] is None
    assert page.locator('#runReport').is_disabled(), 'Accepting quote must not self-confirm payment'
    assert not state['runs']

    # The fixture now represents an independent admin payment confirmation.
    paid_order(state);refresh(page)
    assert page.locator('#runReport').is_disabled()
    page.check('#runConsent');expect(page.locator('#runReport')).to_be_enabled()
    page.click('#runReport');expect(page.locator('#reportPanel')).to_be_visible()
    # The saved report is reloaded after the first render; wait for its content
    # before checking that the deliberately hostile fixture remains plain text.
    expect(page.locator('#reportContent')).to_contain_text('<img src=x')
    assert state['runs']==[{'order_id':ORDER,'consent':True}]
    assert page.locator('#reportContent img,#reportContent script').count()==0
    assert page.evaluate('()=>window.__paidPwned') is None
    expect(page.locator('#reportContent')).to_contain_text('<img src=x')
    expect(page.locator('#reportContent')).to_contain_text('Sentinel')
    expect(page.locator('#reportContent')).to_contain_text('MET Norway')
    assert page.locator('#runReport').is_disabled(), 'A paid single report cannot be rerun after delivery'
    with page.expect_download() as downloaded:page.click('#downloadReport')
    exported=json.loads(Path(downloaded.value.path()).read_text())
    exported_text=json.dumps(exported,ensure_ascii=False)
    assert 'Sentinel' in exported_text and 'MET Norway' in exported_text
    assert ACCESS_TOKEN not in exported_text and REFRESH_TOKEN not in exported_text
    page.evaluate('()=>{window.__paidPrintCalls=0;window.print=()=>window.__paidPrintCalls++;}')
    page.click('#printReport');assert page.evaluate('()=>window.__paidPrintCalls')==1
    page.emulate_media(media='print');assert page.locator('#reportPanel').is_visible();page.emulate_media(media='screen')
    page.locator('#selectedTitle').scroll_into_view_if_needed()
    page.screenshot(path='/workspace/artifacts/ur-smart-paid-field-'+('mobile' if mobile else 'desktop')+'-quote-test.png')
    page.locator('#reportTitle').scroll_into_view_if_needed()
    page.screenshot(path='/workspace/artifacts/ur-smart-paid-field-'+('mobile' if mobile else 'desktop')+'-report-test.png')
    page.evaluate('()=>{document.activeElement?.blur();window.scrollTo(0,0);}')
    page.wait_for_timeout(100)
    page.screenshot(path='/workspace/artifacts/ur-smart-paid-field-'+('mobile' if mobile else 'desktop')+'-test.png',full_page=True)
    assert_no_secrets(page,console);assert not errors,errors
    close(context,state)


def monitoring_scenario(browser,mobile):
    context,page,state,errors,console=context_for(browser,mobile)
    ready(page,'?service=field_monitoring&field='+FIELD)
    expect(page.locator('#paidContent')).to_be_visible();wait_loaded(page)
    assert page.locator('#serviceType').input_value()=='field_monitoring'
    page.select_option('#cadenceDays','14');page.fill('#reportCount','4')
    page.fill('#orderNotes','متابعة دورية بتقارير عند الطلب للفترات المتفق عليها')
    page.click('#createOrder');page.wait_for_function("()=>!document.querySelector('#createOrder').disabled")
    create=next(row['body'] for row in state['rpc'] if row['name']=='create')
    assert create['p_service_type']=='field_monitoring' and create['p_cadence_days']==14 and create['p_report_count']==4
    select_order(page,MONITOR)
    row=quote_order(state,MONITOR,120000);row['accepted_at']=STAMP;row['payment_reference']='ALREADY-ACCEPTED';paid_order(state,MONITOR)
    refresh(page);page.check('#runConsent');page.click('#runReport')
    expect(page.locator('#reportPanel')).to_be_visible()
    assert len(state['runs'])==1 and state['runs'][0]['order_id']==MONITOR
    row=next(row for row in state['orders'] if row['id']==MONITOR)
    assert row['status']=='approved' and row['completed_reports']==1 and row['report_count']==3
    assert row['next_due_at']
    assert page.locator('#runReport').is_disabled(), 'Future period cannot run immediately after current delivery'
    assert 'متابعة' in page.locator('body').inner_text()
    # Waiting on the page does not create automatic report execution.
    before=len(state['runs']);page.wait_for_timeout(250);assert len(state['runs'])==before

    # A newly due period can run, and the second report is distinct in history.
    row['next_due_at']=(NOW-timedelta(minutes=1)).isoformat();refresh(page)
    page.check('#runConsent');expect(page.locator('#runReport')).to_be_enabled();page.click('#runReport')
    expect(page.locator('#planProgress')).to_contain_text('٢')
    page.wait_for_function("()=>document.querySelector('#runReport').textContent==='إنشاء التقرير المستحق'&&!document.querySelector('#refreshOrders').disabled")
    assert len(state['runs'])==2 and row['completed_reports']==2
    assert page.locator('#reportsList [data-report-id]').count()==2
    assert len({item['id'] for item in state['reports'] if item['order_id']==MONITOR})==2
    row['completed_reports']=row['report_count'];row['status']='completed';row['next_due_at']=None;refresh(page)
    assert page.locator('#runReport').is_disabled()
    assert len(state['runs'])==2
    assert_no_secrets(page,console);assert not errors,errors
    close(context,state)


def quote_revision_scenario(browser,mobile):
    context,page,state,errors,console=context_for(browser,mobile)
    quote_order(state);ready(page);expect(page.locator('#paidContent')).to_be_visible();wait_loaded(page)
    select_order(page);page.check('#acceptQuoteConsent');page.fill('#quotePaymentReference','STALE-QUOTE-TEST')
    state['mode']='quote_changed';page.click('#acceptQuote')
    expect(page.locator('#quoteStatus')).to_contain_text('تعذر اعتماد العرض')
    row=next(row for row in state['orders'] if row['id']==ORDER)
    assert row['quote_version']==2 and row['accepted_at'] is None and row['approved_at'] is None
    assert len([call for call in state['rpc'] if call['name']=='accept'])==1
    assert page.locator('#runReport').is_disabled()
    state['mode']='ready';refresh(page)
    assert not page.locator('#acceptQuoteConsent').is_checked(), 'New quote needs new explicit consent'
    assert_no_secrets(page,console);assert not errors,errors
    close(context,state)


def account_cleanup_scenario(browser,mobile):
    context,page,state,errors,console=context_for(browser,mobile)
    quote_order(state);paid_order(state);ready(page);expect(page.locator('#paidContent')).to_be_visible();wait_loaded(page)
    select_order(page);page.check('#runConsent');state['mode']='hold_run';page.click('#runReport')
    page.wait_for_timeout(100);assert state['held']
    # Simulate a missed cross-tab event: the actual SDK must read the new stored
    # session during explicit retry and clear previous account data first.
    state['active_owner']=OTHER
    page.evaluate('([key,session])=>localStorage.setItem(key,JSON.stringify(session))',[STORAGE_KEY,OTHER_SESSION])
    page.click('#retryAccount');page.wait_for_function("()=>!document.querySelector('#retryAccount').disabled")
    assert page.locator('#reportPanel').is_hidden()
    assert page.locator('#selectedPanel').is_hidden()
    assert 'حقل الاختبار المدفوع' not in page.locator('#ordersList').inner_text()
    assert page.locator('#orderNotes').input_value()==''
    for held,row,cors in state['held']:
        try:held.fulfill(json={'order_id':row['id'],'report_id':REPORT,'report_number':1,'status':'completed','order_status':'completed','result':report_fixture()},headers=cors)
        except Exception:pass
    state['held'].clear();page.wait_for_timeout(100)
    assert page.locator('#reportPanel').is_hidden(), 'Late A report cannot appear in B session'
    assert_no_secrets(page,console);assert not errors,errors
    close(context,state)


def partial_and_failed_scenario(browser,mobile):
    context,page,state,errors,console=context_for(browser,mobile)
    quote_order(state,MONITOR,120000);row=paid_order(state,MONITOR)
    # Only an admin quote supplies the price. Partial-count policy is disclosed
    # before acceptance; a failed source attempt consumes no purchased report.
    quote_order(state,ORDER);ready(page);wait_loaded(page);select_order(page,ORDER)
    expect(page.locator('.partial-policy')).to_be_visible()
    expect(page.locator('.partial-policy')).to_contain_text('التقرير الجزئي')
    expect(page.locator('#selectedPanel .boundary-policy')).to_be_visible()
    expect(page.locator('#selectedPanel .boundary-policy')).to_contain_text('قبل الموافقة والدفع')
    assert '25000' not in page.locator('body').inner_text()
    select_order(page,MONITOR);state['mode']='boundary_error';page.check('#runConsent');page.click('#runReport')
    expect(page.locator('#executionStatus')).to_contain_text('الحقل أو حدوده غير متاحة')
    expect(page.locator('#executionMapLink')).to_be_visible()
    assert row['completed_reports']==0 and not state['reports']
    page.wait_for_function("()=>document.querySelector('#runReport').textContent==='إنشاء التقرير المستحق'&&!document.querySelector('#refreshOrders').disabled")
    state['mode']='no_sources';page.check('#runConsent');page.click('#runReport')
    expect(page.locator('#executionStatus')).to_contain_text('لم يُحتسب تقرير')
    expect(page.locator('#reportsList')).to_contain_text('تعذّر التنفيذ')
    assert row['completed_reports']==0 and row['period_attempts']==1
    page.locator('#reportsList [data-report-id]').click()
    expect(page.locator('#reportQuality')).to_contain_text('تعذّر التنفيذ')
    assert page.locator('#reportContent img,#reportContent script').count()==0
    state['mode']='partial';refresh(page);page.check('#runConsent');page.click('#runReport')
    expect(page.locator('#executionStatus')).to_contain_text('يُحتسب ضمن العدد')
    page.wait_for_function("()=>document.querySelector('#runReport').textContent==='إنشاء التقرير المستحق'&&!document.querySelector('#refreshOrders').disabled")
    expect(page.locator('#reportQuality')).to_contain_text('جزئي')
    expect(page.locator('#reportContent')).to_contain_text('لم تتوفر بيانات الطقس')
    assert row['completed_reports']==1 and row['status']=='approved'
    assert page.locator('#runReport').is_disabled(), 'Valid partial report consumes one and waits for next due date'
    assert page.locator('#reportsList [data-report-id]').count()==1, 'Retry replaces failed period without duplicating report'
    with page.expect_download() as download:page.click('#downloadReport')
    exported=json.loads(Path(download.value.path()).read_text())
    assert exported['report_status']=='needs_review' and exported['result']['weather'] is None
    assert exported['result']['sources']['weather'] is None
    assert_no_secrets(page,console);assert not errors,errors
    close(context,state)


def deleted_field_history_scenario(browser,mobile):
    context,page,state,errors,console=context_for(browser,mobile)
    row=quote_order(state);paid_order(state);row['field_id']=None
    state['fields_deleted']=True
    result=report_fixture();result['sources']={'satellite':{'name':'Sentinel-2 L2A','scene_date':NOW.date().isoformat()},'weather':{'name':'MET Norway','url':'https://api.met.no/weatherapi/locationforecast/2.0/'}}
    state['reports']=[{'id':REPORT,'order_id':ORDER,'owner_id':OWNER,'report_number':1,'due_at':STAMP,'status':'completed','created_at':STAMP,'result':result}]
    ready(page);wait_loaded(page);select_order(page)
    expect(page.locator('#selectedOrderMeta')).to_contain_text('حقل محذوف')
    expect(page.locator('#nextReportDue')).to_contain_text('حُفظ سجل الطلب')
    assert page.locator('#createOrder').is_disabled()
    page.check('#runConsent');assert page.locator('#runReport').is_disabled()
    expect(page.locator('#reportsList [data-report-id]')).to_be_enabled()
    page.locator('#reportsList [data-report-id]').click()
    expect(page.locator('#reportTitle')).to_contain_text('حقل الاختبار المدفوع')
    expect(page.locator('#reportContent')).to_contain_text('Sentinel-2 L2A')
    expect(page.locator('#reportContent')).to_contain_text('https://api.met.no/weatherapi')
    assert '[object Object]' not in page.locator('#reportContent').inner_text()
    with page.expect_download() as download:page.click('#downloadReport')
    exported=json.loads(Path(download.value.path()).read_text())
    assert exported['result']['field']['id']==FIELD
    assert not state['runs']
    assert_no_secrets(page,console);assert not errors,errors
    close(context,state)


def signout_cleanup_scenario(browser,mobile):
    context,page,state,errors,console=context_for(browser,mobile)
    quote_order(state);paid_order(state);ready(page);wait_loaded(page);select_order(page)
    page.check('#runConsent');page.click('#runReport')
    expect(page.locator('#reportPanel')).to_be_visible()
    page.wait_for_function("()=>document.querySelector('#runReport').textContent==='إنشاء التقرير المستحق'&&!document.querySelector('#refreshOrders').disabled")
    # A same-origin tab signs out with the actual SDK and broadcast channel.
    # Its HTTP is intercepted; no production account is signed out.
    second=context.new_page();second.goto(SITE+'/field-services.html',wait_until='domcontentloaded')
    second.evaluate("""async()=>{const {createClient}=await import('./supabase-client.mjs');const c=createClient('https://ynsmhtsktbubxfhsekjq.supabase.co','sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc');await c.auth.signOut({scope:'local'});}""")
    expect(page.locator('#accountStatus')).to_contain_text('لا توجد جلسة دخول')
    assert page.locator('#paidContent').is_hidden()
    assert page.locator('#reportPanel').is_hidden() and page.locator('#selectedPanel').is_hidden()
    assert page.locator('#reportContent').inner_text()==''
    assert page.locator('#ordersList').inner_text()==''
    assert page.locator('#downloadReport').is_disabled()
    assert_no_secrets(page,console);assert not errors,errors
    close(context,state)


def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        for mobile in (False,True):
            anonymous_scenario(browser,mobile)
            paid_report_scenario(browser,mobile)
            monitoring_scenario(browser,mobile)
            quote_revision_scenario(browser,mobile)
            account_cleanup_scenario(browser,mobile)
            partial_and_failed_scenario(browser,mobile)
            deleted_field_history_scenario(browser,mobile)
            signout_cleanup_scenario(browser,mobile)
            print(('Mobile' if mobile else 'Desktop')+': actual local SDK; owned orders, exact versioned quotes, manual-payment gate, safe export, on-demand due/count/history, failed/partial policy, deleted field history, stale quote/account and cross-tab signout cleanup passed; HTTP fixtures only.')
        browser.close()


if __name__=='__main__':main()
