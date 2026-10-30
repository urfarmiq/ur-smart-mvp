"""Regression: real local Supabase SDK across login, actual dashboard and weather.

Only HTTP auth responses are fixtures. The SDK, its storage, account page and
module wrapper are the production files. Every request is intercepted; no
production account, password, token, database or email service is used.
"""
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import base64
import json
import time
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://sdk.test'
API_HOST = 'ynsmhtsktbubxfhsekjq.supabase.co'
STORAGE_KEY = 'sb-ynsmhtsktbubxfhsekjq-auth-token'
USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
PASSWORD = 'legacy6'
REFRESH_TOKEN = 'synthetic-refresh-must-not-be-displayed'


def encode(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')


now = int(time.time())
ACCESS_TOKEN = '.'.join([
    encode({'alg': 'HS256', 'typ': 'JWT'}),
    encode({'sub': USER_ID, 'aud': 'authenticated', 'role': 'authenticated',
            'aal': 'aal1', 'iat': now, 'exp': now + 3600,
            'session_id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}),
    'synthetic-signature-never-used-on-a-server',
])
USER = {'id': USER_ID, 'aud': 'authenticated', 'role': 'authenticated',
        'email': 'sdk-fixture@example.invalid', 'email_confirmed_at': '2026-01-01T00:00:00Z',
        'created_at': '2026-01-01T00:00:00Z', 'app_metadata': {'provider': 'email'},
        'user_metadata': {}, 'identities': []}
SESSION = {'access_token': ACCESS_TOKEN, 'refresh_token': REFRESH_TOKEN,
           'token_type': 'bearer', 'expires_in': 3600, 'expires_at': now + 3600,
           'user': USER}


FIELD_ID='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
FARM_ID='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
FIELD={'id':FIELD_ID,'name':'حقل جلسة اختبار','farm_id':FARM_ID,'crop':'حنطة','area_donum':4}


def forecast():
    from datetime import datetime,timedelta,timezone
    local=(datetime.now(timezone.utc)+timedelta(hours=3)).replace(tzinfo=None,minute=0,second=0,microsecond=0)
    hours=[(local+timedelta(hours=i)).isoformat(timespec='minutes') for i in range(24)]
    days=[(local.date()+timedelta(days=i)).isoformat() for i in range(7)]
    return {'timezone':'Asia/Baghdad','utc_offset_seconds':10800,
      'current':{'time':hours[0],'interval':3600,'temperature_2m':27,'relative_humidity_2m':46,'precipitation':0,'weather_code':1,'wind_speed_10m':12,'is_day':1},
      'hourly':{'time':hours,'temperature_2m':[27]*24,'weather_code':[1]*24,'interval':[3600]*24,'precipitation':[0]*24},
      'daily':{'time':days,'temperature_2m_max':[31]*7,'temperature_2m_min':[20]*7,'weather_code':[1]*7}}


def scenario(browser,mobile,mode):
    context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 900},is_mobile=mobile,has_touch=mobile)
    state={'mode':mode,'held':[]};requests=[];api=[];errors=[];console=[]
    if mode not in ('login','anonymous'):
        stored=dict(SESSION)
        if mode in ('expired','refresh-hang'):stored['expires_at']=int(time.time())-60
        context.add_init_script('if(!localStorage.getItem('+json.dumps(STORAGE_KEY)+'))localStorage.setItem('+json.dumps(STORAGE_KEY)+','+json.dumps(json.dumps(stored))+');')
    if mode in ('fields-hang','refresh-hang'):
        context.add_init_script('const original=setTimeout.bind(window);window.setTimeout=(callback,delay,...args)=>original(callback,delay===12000?400:delay,...args);')

    def route_request(route):
        request=route.request;url=urlparse(request.url);requests.append(request.url)
        if url.hostname=='sdk.test':
            path=ROOT/url.path.lstrip('/')
            if path.is_file():
                route.fulfill(body=path.read_bytes(),content_type={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'}.get(path.suffix,'text/html'));return
        if url.hostname==API_HOST:
            cors={'access-control-allow-origin':SITE,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':request.headers.get('access-control-request-headers','apikey,authorization,content-type,x-client-info,x-supabase-api-version')}
            if request.method=='OPTIONS':route.fulfill(status=204,headers=cors);return
            api.append({'path':url.path,'method':request.method,'query':parse_qs(url.query)})
            if url.path=='/auth/v1/token':
                grant=parse_qs(url.query).get('grant_type')
                if grant==['password']:
                    body=json.loads(request.post_data);assert body['email']==USER['email'] and body['password']==PASSWORD
                else:assert grant==['refresh_token']
                if state['mode']=='refresh-hang':state['held'].append((route,cors));return
                route.fulfill(json=SESSION,headers=cors);return
            if url.path=='/auth/v1/user':
                route.fulfill(status=500,json={'message':'synthetic auth lookup unavailable'},headers=cors);return
            if url.path=='/rest/v1/rpc/admin_access':
                route.fulfill(json=False,headers=cors);return
            assert request.method=='GET',('Unexpected database write',url.path)
            assert request.headers.get('authorization')=='Bearer '+ACCESS_TOKEN
            if url.path=='/rest/v1/farms':
                assert parse_qs(url.query).get('owner_id')==['eq.'+USER_ID]
                route.fulfill(json=[{'id':FARM_ID,'name':'مزرعة جلسة اختبار'}],headers=cors);return
            if url.path=='/rest/v1/fields':
                query=parse_qs(url.query)
                assert query.get('farms.owner_id')==['eq.'+USER_ID] or query.get('farm_id')==['eq.'+FARM_ID],query
                if state['mode']=='fields-fail':route.fulfill(status=503,json={'message':'synthetic unavailable'},headers=cors);return
                if state['mode']=='fields-hang':state['held'].append((route,cors));return
                route.fulfill(json=[FIELD],headers=cors);return
            if url.path=='/rest/v1/field_boundaries':
                query=parse_qs(url.query);assert query.get('field_id')==['eq.'+FIELD_ID]
                if 'owner_id' in query:assert query['owner_id']==['eq.'+USER_ID]
                route.fulfill(json={'geometry':{'type':'Polygon','coordinates':[[[44,33],[44.01,33],[44.01,33.01],[44,33.01],[44,33]]]}},headers=cors);return
            raise AssertionError('Unexpected API path '+url.path)
        if url.hostname=='ur-smart-satellite.alialbatekh111.workers.dev' and url.path=='/weather':
            route.fulfill(json=forecast());return
        # Keep remote font requests pending: account startup may not depend on them.
        if url.hostname in ('fonts.googleapis.com','fonts.gstatic.com'):
            state['held'].append((route,{}));return
        route.abort('blockedbyclient')

    context.route('**/*',route_request);page=context.new_page();page.set_default_timeout(8000)
    page.on('pageerror',lambda error:errors.append(str(error)));page.on('console',lambda msg:console.append(msg.text))
    if mode in ('login','persisted','expired'):
        page.goto(SITE+'/auth.html',wait_until='domcontentloaded')
        if mode=='login':
            expect(page.locator('#msg')).to_contain_text('أدخل بياناتك');page.fill('#email',USER['email']);page.fill('#password',PASSWORD)
            page.get_by_role('button',name='تسجيل الدخول',exact=True).click()
        page.wait_for_url(SITE+'/dashboard.html')
        expect(page.locator('#cloudFields')).to_contain_text(FIELD['name'])
        expect(page.locator('#status')).to_contain_text('تم الاتصال بنجاح')
        assert page.locator('#connectionRecovery').is_hidden() and page.locator('#saveButton').is_enabled()
        assert not any('fonts.google' in url for url in requests)
        page.locator('#cloudFields a[href*="weather.html"]').click()
        page.wait_for_url('**/weather.html?field='+FIELD_ID)
    else:
        page.goto(SITE+'/weather.html?field='+FIELD_ID,wait_until='domcontentloaded')
    if mode=='anonymous':
        expect(page.locator('#accountStatus')).to_contain_text('لا توجد جلسة')
        assert page.locator('#weatherSignIn').is_visible() and page.locator('#weatherField').is_disabled()
        assert not api
        page.select_option('#locationMode','city');page.select_option('#weatherCity','baghdad')
        expect(page.locator('#weatherStatus')).to_contain_text('طقس المدينة المرجعية')
    elif mode in ('fields-fail','fields-hang','refresh-hang'):
        expect(page.locator('#accountStatus')).to_contain_text('أعد المحاولة')
        assert page.locator('#retryWeatherAccount').is_enabled() and page.locator('#weatherField').is_disabled()
        assert page.locator('#weatherSignIn').is_hidden(), 'Network failures must not be presented as signed out'
        stored=page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))',STORAGE_KEY)
        assert stored['refresh_token']==REFRESH_TOKEN and stored['access_token']==ACCESS_TOKEN
        assert page.locator('#weatherResult').is_hidden()
        if mode!='refresh-hang':
            state['mode']='ready'
            for held,cors in state['held']:held.fulfill(json=[FIELD],headers=cors)
            page.click('#retryWeatherAccount')
            expect(page.locator('#weatherStatus')).to_contain_text('تم تحديث توقعات موقع الحقل')
    else:
        expect(page.locator('#weatherStatus')).to_contain_text('تم تحديث توقعات موقع الحقل')
        assert page.locator('#weatherLocation').inner_text()==FIELD['name']
        assert page.locator('#weatherField').input_value()==FIELD_ID
        assert 'تم الاتصال بحسابك' in page.locator('#accountStatus').text_content()
        if mode=='expired':assert any(row['query'].get('grant_type')==['refresh_token'] for row in api)
        assert not any(row['path']=='/auth/v1/user' for row in api), 'Fresh browser session must not require another auth-server user lookup'
        stored=page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))',STORAGE_KEY)
        assert stored['user']['id']==USER_ID and stored['refresh_token']==REFRESH_TOKEN
    assert any(url.endswith('/vendor/supabase-js-2.57.4.js') for url in requests)
    assert not any('cdn.jsdelivr.net' in url for url in requests)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    for secret in [ACCESS_TOKEN,REFRESH_TOKEN,PASSWORD]:
        assert secret not in page.content() and not any(secret in row for row in console)
    assert not errors,errors
    for held,cors in state['held']:
        try:held.abort('blockedbyclient')
        except Exception:pass
    page.wait_for_timeout(100)
    context.close()


with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for mobile in (False,True):
        for mode in ('login','persisted','expired','fresh','fields-fail','fields-hang','refresh-hang','anonymous'):
            scenario(browser,mobile,mode)
        print(('Mobile' if mobile else 'Desktop')+': real SDK login -> actual dashboard -> owned weather, existing/refreshed sessions, timeout/retry and token preservation pass; no cloud reads/writes.')
    browser.close()
