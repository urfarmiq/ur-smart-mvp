"""Public advertising integration with isolated HTTP fixtures only.

No real ad network, impression, advertiser, account, payment or provider call is
made. The deliberately synthetic Google script is fulfilled locally if tested.
"""
from pathlib import Path
from urllib.parse import urlparse, urljoin
from datetime import datetime, timezone, timedelta
import copy
import json
import re
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://ur-smart-urfarmiq.pages.dev'
API_HOST = 'ynsmhtsktbubxfhsekjq.supabase.co'
RPC = '/rest/v1/rpc/list_public_advertisements'
AD_HOST = 'pagead2.googlesyndication.com'
ARTIFACTS = Path('/workspace/artifacts')
CANARY = 'SYNTHETIC-ACCOUNT-CONTEXT-DO-NOT-SEND'
DISABLED = {'google': {'mode': 'disabled', 'publisher_id': '', 'ad_slot': '',
                       'site_approved': False, 'cmp_ready': False}}
ACTIVE = {'google': {'mode': 'active', 'publisher_id': 'ca-pub-0000000000000000',
                     'ad_slot': '1234567890', 'site_approved': True, 'cmp_ready': True}}


def stamp(delta=0):
    return (datetime.now(timezone.utc) + timedelta(seconds=delta)).isoformat()


def card(placement='home', **changes):
    value = {'id': '11111111-1111-4111-8111-111111111111',
             'company_name': 'شركة اختبار اصطناعي',
             'ad_title': '<img src=x onerror="window.__adPwned=1"> عنوان اختباري',
             'ad_body': 'نص تجريبي معروض كنص عادي، وليس إعلانًا حقيقيًا.',
             'target_url': 'https://vendor.example/catalog',
             'placement': placement, 'starts_at': stamp(-60), 'ends_at': stamp(3600)}
    value.update(changes)
    return value


def payload(state, placement):
    mode = state['mode']
    if mode == 'empty':
        return []
    if mode == 'mixed':
        return [card(placement),
                card(placement, id='22222222-2222-4222-8222-222222222222', ends_at=stamp(-1)),
                dict(card(placement, id='33333333-3333-4333-8333-333333333333'),
                     owner_id='PRIVATE-OWNER-FIXTURE', contact_phone='PRIVATE-CONTACT-FIXTURE')]
    if mode == 'future':
        return [card(placement, starts_at=stamp(3600), ends_at=stamp(7200))]
    if mode == 'bad_url':
        return [card(placement, target_url='https://127.0.0.1/private')]
    if mode == 'expires':
        return [card(placement, ends_at=stamp(2))]
    return [card(placement)]


def routes(state):
    def route_request(route):
        req = route.request
        parsed = urlparse(req.url)
        state['urls'].append(req.url)
        if parsed.hostname == AD_HOST:
            state['google'].append(req.url)
            assert parsed.path == '/pagead/js/adsbygoogle.js'
            route.fulfill(body='window.__syntheticAdsenseScript=true;',
                          content_type='application/javascript')
            return
        if parsed.hostname == 'ur-smart-urfarmiq.pages.dev':
            if parsed.path == '/monetization-config.json':
                state['config_requests'] += 1
                route.fulfill(json=state['config'], headers={'cache-control': 'no-store'})
                return
            name = parsed.path.lstrip('/') or 'index.html'
            file = ROOT / name
            if not file.is_file() and not Path(name).suffix:
                file = ROOT / (name + '.html')
            if file.is_file() and file.resolve().is_relative_to(ROOT):
                mime = {'.mjs': 'application/javascript', '.js': 'application/javascript',
                        '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
                        '.webmanifest': 'application/manifest+json', '.json': 'application/json'}.get(file.suffix, 'text/html')
                route.fulfill(body=file.read_bytes(), content_type=mime)
                return
        if parsed.hostname == API_HOST:
            cors = {'access-control-allow-origin': SITE,
                    'access-control-allow-methods': 'POST,OPTIONS',
                    'access-control-allow-headers': req.headers.get('access-control-request-headers', 'apikey,content-type')}
            if req.method == 'OPTIONS':
                route.fulfill(status=204, headers=cors)
                return
            if parsed.path == RPC:
                headers = req.all_headers()
                body = json.loads(req.post_data or '{}')
                assert req.method == 'POST' and set(body) == {'p_placement'}
                assert body['p_placement'] in ('home', 'services')
                assert 'authorization' not in headers and 'cookie' not in headers
                assert 'referer' not in headers
                assert CANARY not in json.dumps({'headers': headers, 'body': body})
                state['rpc'].append({'body': body, 'headers': headers})
                route.fulfill(json=payload(state, body['p_placement']), headers=cors)
                return
            # The independent page-view counter is neither an ad impression nor
            # an account lookup. Do not send it to a real service in this test.
            route.fulfill(status=204, headers=cors)
            return
        # Includes Google fonts and every unexpected external destination.
        route.abort('blockedbyclient')
    return route_request


def setup(browser, mobile=False, mode='active', config=None, standalone=False):
    context = browser.new_context(viewport={'width': 390 if mobile else 1280,
                                          'height': 844 if mobile else 960},
                                  is_mobile=mobile, has_touch=mobile,
                                  service_workers='block')
    context.add_cookies([{'name': 'private-canary', 'value': CANARY,
                         'domain': API_HOST, 'path': '/', 'secure': True}])
    context.add_init_script('localStorage.setItem("private-account-canary",' + json.dumps(CANARY) + ');')
    if standalone:
        context.add_init_script('Object.defineProperty(navigator,"standalone",{get:()=>true});')
    state = {'mode': mode, 'config': copy.deepcopy(config if config is not None else DISABLED),
             'rpc': [], 'urls': [], 'google': [], 'config_requests': 0}
    context.route('**/*', routes(state))
    page = context.new_page()
    page.set_default_timeout(10000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    return context, page, state, errors


def goto(page, path='index.html'):
    response = page.goto(SITE + '/' + path, wait_until='networkidle')
    assert response.status == 200


def sponsor_scenario(browser, mobile):
    context, page, state, errors = setup(browser, mobile, 'mixed')
    goto(page)
    expect(page.locator('.ur-sponsored-card')).to_have_count(1)
    expect(page.locator('.ur-sponsored-label')).to_have_text('إعلان مدفوع')
    expect(page.locator('.ur-sponsored-card')).to_contain_text('<img src=x')
    assert page.locator('.ur-sponsored-card img,.ur-sponsored-card script').count() == 0
    assert page.evaluate('()=>window.__adPwned') is None
    link = page.locator('.ur-sponsored-link')
    assert link.get_attribute('href') == 'https://vendor.example/catalog'
    assert set(link.get_attribute('rel').split()) >= {'sponsored', 'noopener', 'noreferrer'}
    assert link.get_attribute('target') == '_blank'
    assert 'PRIVATE-CONTACT-FIXTURE' not in page.locator('body').inner_text()
    assert not state['google'] and page.locator('#ur-google-adsense-script').count() == 0
    assert page.locator('[data-google-ads]').is_hidden()
    assert page.evaluate('()=>Object.keys(localStorage)') == ['private-account-canary']
    assert page.evaluate('()=>localStorage.getItem("private-account-canary")') == CANARY
    context.set_offline(True)
    expect(page.locator('[data-sponsor-placement]')).to_be_hidden()
    state['mode'] = 'future'
    with page.expect_response(lambda response: urlparse(response.url).path == RPC):
        context.set_offline(False)
    page.wait_for_load_state('networkidle')
    expect(page.locator('.ur-sponsored-card')).to_have_count(0)
    state['mode'] = 'bad_url'
    goto(page, 'services.html')
    expect(page.locator('[data-sponsor-placement]')).to_be_hidden()
    assert state['rpc'] and state['rpc'][-1]['body'] == {'p_placement': 'services'}
    assert page.locator('a[href="./advertise.html"]').count() >= 1
    state['mode'] = 'active'
    goto(page, 'services.html')
    expect(page.locator('.ur-sponsored-card')).to_have_count(1)
    assert not errors and not state['google']
    context.close()


def expiry_scenario(browser, mobile):
    context, page, state, errors = setup(browser, mobile, 'expires')
    goto(page, 'services.html')
    expect(page.locator('.ur-sponsored-card')).to_have_count(1)
    expect(page.locator('[data-sponsor-placement]')).to_be_hidden(timeout=7000)
    assert not errors and not state['google']
    context.close()


def google_fixture_scenario(browser, mobile):
    # All AdSense identifiers and its script here are synthetic HTTP fixtures.
    # No request escapes routes(), so this cannot create a real ad impression.
    context, page, state, errors = setup(browser, mobile, 'empty', ACTIVE)
    goto(page)
    expect(page.locator('.ur-google-ad-allow')).to_be_visible()
    assert not state['google']
    page.click('.ur-google-ad-allow')
    expect(page.locator('#ur-google-adsense-script')).to_have_count(1)
    page.wait_for_function('()=>window.__syntheticAdsenseScript===true')
    assert len(state['google']) == 1
    assert page.evaluate('()=>window.adsbygoogle.length') == 1
    assert not errors
    context.close()
    context, page, state, errors = setup(browser, mobile, 'active', ACTIVE, standalone=True)
    goto(page)
    expect(page.locator('.ur-sponsored-card')).to_have_count(1)
    assert page.locator('[data-google-ads]').is_hidden()
    assert not state['google'] and state['config_requests'] == 0
    assert not errors
    context.close()
    context, page, state, errors = setup(browser, mobile, 'active', ACTIVE)
    goto(page, 'index.html?code=' + CANARY)
    expect(page.locator('.ur-sponsored-card')).to_have_count(1)
    assert page.locator('[data-google-ads]').is_hidden()
    assert not state['google'] and state['config_requests'] == 0
    assert all(CANARY not in json.dumps(item) for item in state['rpc'])
    assert not errors
    context.close()


def public_pages(browser):
    records = []
    for width in (390, 768, 1280):
        context, page, state, errors = setup(browser, width == 390, 'empty')
        page.set_viewport_size({'width': width, 'height': 844 if width == 390 else 960})
        for name in ('index.html', 'services.html', 'privacy.html', 'about.html', 'guides.html', 'advertise.html'):
            goto(page, name)
            assert urlparse(page.url).path == '/' + name, (name, 'public visitor was redirected')
            assert page.locator('input[type="password"]').count() == 0, (name, 'public page requires a password')
            size = page.evaluate('()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth})')
            assert size['scroll'] <= width + 1, (name, width, size)
            assert not state['google']
            assert not errors, (name, errors)
            if name in ('index.html', 'about.html', 'privacy.html'):
                phone = page.locator('a[href="tel:+9647728731910"]')
                assert phone.count() >= 1, (name, 'missing authorized public phone link')
                expect(phone.first).to_contain_text('+9647728731910')
                assert page.locator('a[href^="https://www.instagram.com/ur.farm.iq"]').count() >= 1, (name, 'missing official Instagram contact')
            for href in page.locator('a[href]').evaluate_all('(nodes)=>nodes.map(node=>node.getAttribute("href"))'):
                if not href or href.startswith(('https:', 'http:', 'mailto:', 'tel:', 'data:')):
                    continue
                url = urlparse(urljoin(SITE + '/' + name, href))
                if url.hostname != 'ur-smart-urfarmiq.pages.dev':
                    continue
                file = ROOT / (url.path.lstrip('/') or 'index.html')
                assert file.exists(), (name, href)
                if url.fragment:
                    ids = re.findall(r'\bid=["\']([^"\']+)', file.read_text())
                    assert url.fragment in ids, (name, href, 'missing fragment')
            if width in (390, 1280) and name in ('index.html', 'advertise.html', 'guides.html'):
                page.screenshot(path=str(ARTIFACTS / ('ur-smart-public-ads-' + name[:-5] + '-' + str(width) + '-test.png')), full_page=True)
            records.append({'page': name, 'width': width, 'overflow': False, 'google_network': False, 'javascript_errors': []})
        context.close()
    return records


def static_isolation():
    for name in ('auth.html','admin.html','dashboard.html','products.html','field-services.html',
                 'field-analysis.html','field-map.html','satellite-analysis.html',
                 'satellite-access.html','research-lab.html','plant-health.html'):
        text = (ROOT / name).read_text()
        assert 'src="./google-ads.mjs"' not in text and 'src="./sponsor-ads.mjs"' not in text, name
    worker = (ROOT / 'sw.js').read_text()
    for name in ('google-ads.mjs','sponsor-ads.mjs','monetization-config.json'):
        assert "{path:'" + name + "'" not in worker


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    static_isolation()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        for mobile in (False, True):
            sponsor_scenario(browser, mobile)
            expiry_scenario(browser, mobile)
            google_fixture_scenario(browser, mobile)
            print(('Mobile' if mobile else 'Desktop') + ': anonymous placement-only sponsor lookup, safe paid labels/links, expiry/offline isolation, disabled Google and explicit synthetic opt-in/PWA/query exclusion passed; HTTP fixtures only.', flush=True)
        records = public_pages(browser)
        browser.close()
    (ARTIFACTS / 'ur-smart-public-ads-qa.json').write_text(json.dumps({'public_pages':records,'actual_ad_network_calls':False,'actual_customer_or_payment_calls':False,'campaigns_persisted':False},ensure_ascii=False,indent=2))
    print('Public pages at 390/768/1280: no overflow, broken local links, Google ad network requests or page errors; fixtures only.', flush=True)


if __name__ == '__main__':
    main()
