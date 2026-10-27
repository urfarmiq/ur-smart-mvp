"""Exercise the real, vendored Supabase SDK under the actual account-page CSP.

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


def scenario(browser, mobile, persisted):
    context = browser.new_context(
        viewport={'width': 390 if mobile else 1280, 'height': 844 if mobile else 900},
        is_mobile=mobile, has_touch=mobile)
    if persisted:
        context.add_init_script(
            'if(!localStorage.getItem(' + json.dumps(STORAGE_KEY) + '))'
            'localStorage.setItem(' + json.dumps(STORAGE_KEY) + ','
            + json.dumps(json.dumps(SESSION)) + ');')
    requests, auth_calls, errors, console = [], [], [], []

    def route_request(route):
        request = route.request
        url = urlparse(request.url)
        requests.append(request.url)
        if url.hostname == 'sdk.test':
            if url.path == '/dashboard.html':
                route.fulfill(body='<!doctype html><html lang="ar"><title>لوحة اختبار محلية</title><p>لوحة اختبار محلية</p></html>',
                              content_type='text/html')
                return
            path = ROOT / url.path.lstrip('/')
            if path.is_file():
                route.fulfill(body=path.read_bytes(), content_type={
                    '.mjs': 'text/javascript', '.js': 'text/javascript',
                    '.css': 'text/css'}.get(path.suffix, 'text/html'))
                return
        if url.hostname == API_HOST:
            cors = {'access-control-allow-origin': SITE,
                    'access-control-allow-methods': 'POST,GET,OPTIONS',
                    'access-control-allow-headers': request.headers.get(
                        'access-control-request-headers', 'apikey,authorization,content-type,x-client-info,x-supabase-api-version')}
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers=cors)
                return
            auth_calls.append({'path': url.path, 'query': parse_qs(url.query),
                               'method': request.method, 'body': request.post_data})
            if url.path == '/auth/v1/token' and parse_qs(url.query).get('grant_type') == ['password']:
                credentials = json.loads(request.post_data)
                assert credentials['email'] == USER['email']
                assert credentials['password'] == PASSWORD
                route.fulfill(body=json.dumps(SESSION), content_type='application/json', headers=cors)
                return
            route.fulfill(status=400, body=json.dumps({'message': 'Unexpected fixture auth request'}),
                          content_type='application/json', headers=cors)
            return
        if url.hostname == 'fonts.googleapis.com':
            route.fulfill(body='', content_type='text/css')
            return
        route.abort('blockedbyclient')

    context.route('**/*', route_request)
    page = context.new_page()
    page.set_default_timeout(10000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: console.append(message.text))
    page.goto(SITE + '/auth.html', wait_until='domcontentloaded')
    if not persisted:
        expect(page.locator('#msg')).to_contain_text('أدخل بياناتك')
        assert auth_calls == [], 'Anonymous session lookup should not send account requests'
        page.fill('#email', USER['email'])
        page.fill('#password', PASSWORD)
        page.get_by_role('button', name='تسجيل الدخول', exact=True).click()
    page.wait_for_url(SITE + '/dashboard.html')
    stored = page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', STORAGE_KEY)
    assert stored['access_token'] == ACCESS_TOKEN
    assert stored['refresh_token'] == REFRESH_TOKEN
    assert stored['user']['id'] == USER_ID
    assert len(auth_calls) == (0 if persisted else 1), auth_calls
    assert any(url.endswith('/supabase-client.mjs') for url in requests)
    assert any(url.endswith('/vendor/supabase-js-2.57.4.js') for url in requests)
    assert not any('cdn.jsdelivr.net' in url for url in requests), requests
    assert errors == [], errors
    for secret in [ACCESS_TOKEN, REFRESH_TOKEN, PASSWORD]:
        assert secret not in page.content()
        assert all(secret not in entry for entry in console)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                        args=['--no-sandbox'])
    for mobile in (False, True):
        for persisted in (False, True):
            scenario(browser, mobile, persisted)
        print(('Mobile' if mobile else 'Desktop') + ': actual local Supabase SDK loads under CSP, '
              'password login and existing persisted session redirect correctly with the same '
              'storage key, without a CDN request or displayed credentials; HTTP fixtures only.')
    browser.close()
