"""Anonymous page-view collection in Chromium, with every request intercepted.

Loads the actual public homepage and tracker at its production URL. No request
reaches GitHub, Supabase, or a third party; all values are synthetic fixtures.
Requires Playwright and /usr/bin/chromium.
"""
from pathlib import Path
from urllib.parse import urlparse
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://urfarmiq.github.io/ur-smart-mvp/'
API_HOST = 'ynsmhtsktbubxfhsekjq.supabase.co'
PAGES = ['index.html', 'dashboard.html', 'field-map.html', 'field-analysis.html',
         'satellite-analysis.html', 'operations.html', 'weather.html']

for filename in PAGES:
    source = (ROOT / filename).read_text()
    assert source.count('src="./visit-tracker.mjs"') == 1, filename
    assert 'دون حفظ بيانات تعريف الزائر' in source, filename
for filename in ['admin.html', 'auth.html', 'satellite-staging-test.html']:
    assert 'src="./visit-tracker.mjs"' not in (ROOT / filename).read_text(), filename


def scenario(browser, mobile, mode):
    collected, errors = [], []
    context = browser.new_context(
        viewport={'width': 390 if mobile else 1280, 'height': 844 if mobile else 900},
        is_mobile=mobile, has_touch=mobile)
    # Cookies/account data exist but must never be attached to analytics.
    context.add_cookies([{'name': 'private_cookie', 'value': 'synthetic-secret-cookie',
                         'domain': API_HOST, 'path': '/', 'secure': True, 'sameSite': 'None'}])
    context.add_init_script("""
      localStorage.setItem('test-account-token','synthetic-secret-session');
      sessionStorage.setItem('test-account-id','synthetic-private-user');
    """)
    if mode == 'dnt':
        context.add_init_script("Object.defineProperty(navigator,'doNotTrack',{get:()=> '1'});")
    if mode == 'gpc':
        context.add_init_script("Object.defineProperty(navigator,'globalPrivacyControl',{get:()=>true});")
    if mode == 'hidden':
        context.add_init_script("window.__hiddenFixture=true;Object.defineProperty(document,'visibilityState',{get:()=>window.__hiddenFixture?'hidden':'visible'});")

    def route_request(route):
        request = route.request
        url = urlparse(request.url)
        if url.hostname == API_HOST and url.path == '/rest/v1/rpc/record_site_visit':
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers={
                    'access-control-allow-origin': 'https://urfarmiq.github.io',
                    'access-control-allow-methods': 'POST,OPTIONS',
                    'access-control-allow-headers': 'apikey,content-type'})
                return
            collected.append({'method': request.method, 'headers': request.all_headers(),
                              'body': json.loads(request.post_data)})
            if mode == 'offline':
                route.abort('failed')
            else:
                route.fulfill(status=403 if mode == 'forbidden' else 204, body='',
                              headers={'access-control-allow-origin': 'https://urfarmiq.github.io'})
            return
        if url.hostname in ['urfarmiq.github.io', 'preview.example']:
            file = 'visit-tracker.mjs' if url.path.endswith('visit-tracker.mjs') else 'index.html'
            route.fulfill(body=(ROOT / file).read_bytes(),
                          content_type='text/javascript' if file.endswith('.mjs') else 'text/html')
            return
        route.abort('blockedbyclient')

    context.route('**/*', route_request)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    address = SITE if mode != 'preview' else 'https://preview.example/ur-smart-mvp/'
    page.goto(address + '?email=private%40example.test&access_token=synthetic-private-token#private-fragment')
    page.wait_for_load_state('networkidle')
    if mode in ['dnt', 'gpc', 'preview', 'hidden']:
        assert len(collected) == 0, (mode, collected)
    else:
        assert len(collected) == 1, (mode, collected)

    if mode == 'hidden':
        page.evaluate("window.__hiddenFixture=false;document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_timeout(200)
        assert len(collected) == 1
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_timeout(100)
        assert len(collected) == 1

    if mode == 'ready':
        page.evaluate("import('./visit-tracker.mjs?duplicate=1')")
        page.evaluate("dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
        page.wait_for_timeout(100)
        assert len(collected) == 1, 'Duplicate import/BFCache event counted twice'
        page.reload()
        page.wait_for_load_state('networkidle')
        assert len(collected) == 2, 'A new document load should count a page view'

    for request in collected:
        assert request['method'] == 'POST'
        assert request['body'] == {'p_page': 'home'}
        assert request['headers']['apikey'].startswith('sb_publishable_')
        for header in ['authorization', 'cookie', 'referer']:
            assert header not in request['headers'], (header, request)
        serialized = json.dumps(request)
        for value in ['synthetic-secret', 'synthetic-private', 'private@example.test', 'private-fragment']:
            assert value not in serialized, value
    assert errors == [], (mode, errors)
    # The tracker must neither replace nor clear existing application storage.
    assert page.evaluate("localStorage.getItem('test-account-token')") == 'synthetic-secret-session'
    assert page.evaluate("sessionStorage.getItem('test-account-id')") == 'synthetic-private-user'
    context.close()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    for mobile in [False, True]:
        for mode in ['ready', 'dnt', 'gpc', 'hidden', 'preview', 'offline', 'forbidden']:
            scenario(browser, mobile, mode)
        print(('Mobile' if mobile else 'Desktop') + ': page counts, privacy, exclusions, deduplication and failures OK')
    browser.close()
