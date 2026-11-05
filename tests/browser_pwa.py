"""Real Chromium PWA lifecycle checks on an isolated localhost site.

Only local files and synthetic responses are used. External requests are blocked;
no real account, order, payment, satellite or AI provider is contacted. Native OS
installation and physical iPhone behavior are outside this headless test.
"""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from contextlib import contextmanager
import json
import subprocess
import tempfile
import threading
import time
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = Path('/workspace/artifacts')
RELEASE_A = 'a' * 40
RELEASE_B = 'b' * 40


class SiteHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.mjs': 'text/javascript', '.js': 'text/javascript',
                      '.webmanifest': 'application/manifest+json',
                      '.svg': 'image/svg+xml'}

    def log_message(self, *args):
        pass

    def end_headers(self):
        path = urlparse(self.path).path
        if path in ('/sw.js', '/manifest.webmanifest'):
            self.send_header('Cache-Control', 'no-cache, max-age=0')
        if path in ('/auth', '/auth.html', '/admin', '/admin.html'):
            self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path in ('/api/private', '/api/denied'):
            self.send_response(200 if path == '/api/private' else 403)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(json.dumps({'private_fixture': True,
                                        'code': 'SATELLITE_PAYMENT_REQUIRED'}).encode())
            return
        if path in ('/offline.html', '/install.html', '/services.html', '/auth.html'):
            self.send_response(308)
            self.send_header('Location', path[:-5] + ('?' + parsed.query if parsed.query else ''))
            self.end_headers()
            return
        if path in ('/offline', '/install', '/services', '/auth'):
            self.path = path + '.html' + ('?' + parsed.query if parsed.query else '')
        super().do_GET()


@contextmanager
def local_site(directory):
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SiteHandler, directory=str(directory)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield 'http://127.0.0.1:' + str(server.server_port)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def build(directory):
    script = "import {buildPublicSite} from './scripts/build-public-site.mjs'; await buildPublicSite({outDir:" + json.dumps(str(directory)) + ",release:" + json.dumps(RELEASE_A) + "});"
    subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT, check=True,
                   capture_output=True, text=True)
    assert RELEASE_A in (directory / 'sw.js').read_text(), 'Build must stamp SW with the deployment revision'
    assert '__UR_PWA_RELEASE__' not in (directory / 'sw.js').read_text()


def wait_for(page, expression, message, timeout=15):
    """Probe only the existing index page, which has no unsafe-eval restriction."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if page.evaluate(expression):
            return
        page.wait_for_timeout(100)
    raise AssertionError(message)


def own_caches(page):
    return page.evaluate("""async () => {
      const result = {};
      for (const name of await caches.keys()) if (name.startsWith('ur-smart-pwa-')) {
        result[name] = (await (await caches.open(name)).keys()).map(r => r.url);
      }
      return result;
    }""")


def scenario(browser, directory, origin, mobile):
    context = browser.new_context(viewport={'width': 390 if mobile else 1280,
                                           'height': 844 if mobile else 960},
                                  locale='ar-IQ', service_workers='allow')
    external = []

    def route(request_route):
        external.append(request_route.request.url)
        request_route.abort('blockedbyclient')

    # Route only foreign URLs: routing same-origin navigation itself changes
    # Chromium's offline/navigation path and can mask a real service worker.
    context.route(lambda url: not url.startswith(origin + '/'), route)
    probe = context.new_page()
    probe.goto(origin + '/', wait_until='domcontentloaded')
    wait_for(probe, "async () => !!(await navigator.serviceWorker.getRegistration())?.active",
             'Service worker did not activate')
    wait_for(probe, '() => !!navigator.serviceWorker.controller', 'First install did not claim its client')
    registration = probe.evaluate("async () => { const r = await navigator.serviceWorker.ready; return {scope:r.scope,script:r.active.scriptURL}; }")
    assert registration['scope'] == origin + '/'
    assert registration['script'] == origin + '/sw.js'

    manifest_response = context.request.get(origin + '/manifest.webmanifest')
    assert manifest_response.ok
    manifest = manifest_response.json()
    assert manifest['display'] == 'standalone' and manifest['dir'] == 'rtl'
    assert manifest['lang'].startswith('ar') and manifest['start_url'] in ('./', '/')
    assert {icon['sizes'] for icon in manifest['icons']} >= {'192x192', '512x512'}
    for shortcut in manifest.get('shortcuts', []):
        assert not shortcut['url'].startswith(('http:', 'https:', '//'))
    for icon in manifest['icons']:
        icon_response = context.request.get(origin + '/' + icon['src'].removeprefix('./').lstrip('/'))
        assert icon_response.ok and icon_response.body().startswith(b'\x89PNG\r\n\x1a\n')

    cdp = context.new_cdp_session(probe)
    manifest_info = cdp.send('Page.getAppManifest')
    assert manifest_info.get('url', '').endswith('/manifest.webmanifest')
    assert not manifest_info.get('errors'), manifest_info.get('errors')
    try:
        installability = cdp.send('Page.getInstallabilityErrors')
    except Exception as error:
        installability = {'not_available_in_headless_runtime': type(error).__name__}

    guide = context.new_page()
    errors = []
    guide.on('pageerror', lambda error: errors.append(str(error)))
    guide.goto(origin + '/install.html', wait_until='networkidle')
    expect(guide.locator('[data-ur-install]')).to_be_visible()
    expect(guide.locator('[data-pwa-install]').first).to_be_visible()
    guide.screenshot(path=str(ARTIFACTS / ('ur-smart-pwa-install-' + ('mobile' if mobile else 'desktop') + '-test.png')), full_page=True)
    assert not errors, errors
    probe.goto(origin + '/services.html', wait_until='domcontentloaded')
    expect(probe.locator('#servicesTitle')).to_be_visible()
    probe.goto(origin + '/', wait_until='domcontentloaded')
    wait_for(probe, '() => !!navigator.serviceWorker.controller', 'Controller missing after public navigation')
    probe.evaluate("""async () => {
      localStorage.setItem('pwa-fixture-auth', 'synthetic-session-sentinel');
      localStorage.setItem('ur-smart-operations-fixture', 'local-farm-operation-sentinel');
      await (await caches.open('unrelated-app-cache')).put('/unrelated-static.txt', new Response('keep'));
      await fetch('/api/private', {headers:{Authorization:'Bearer synthetic-test-only'}});
      const denied = await fetch('/api/denied');
      if (denied.status !== 403 || (await denied.json()).code !== 'SATELLITE_PAYMENT_REQUIRED') throw Error('SW changed a paid API denial');
      await fetch('/auth.html');
      await fetch('/services.html?code=PWA_SYNTHETIC_TOKEN');
      try { await fetch('https://pwa-no-network.invalid/private?token=synthetic', {headers:{Authorization:'Bearer synthetic-test-only'}}); } catch {}
    }""")
    before = own_caches(probe)
    assert before and any(RELEASE_A in name for name in before)
    forbidden = ('/auth', '/admin', '/dashboard', '/api/', '?', 'supabase', 'workers.dev', 'PWA_SYNTHETIC_TOKEN')
    assert not [url for urls in before.values() for url in urls if any(part in url for part in forbidden)], before

    context.set_offline(True)
    guide.goto(origin + '/services', wait_until='domcontentloaded')
    expect(guide.locator('#servicesTitle')).to_be_visible()
    guide.goto(origin + '/services.html', wait_until='domcontentloaded')
    expect(guide.locator('#servicesTitle')).to_be_visible()
    guide.goto(origin + '/', wait_until='domcontentloaded')
    expect(guide.locator('#home')).to_be_visible()
    guide.goto(origin + '/auth', wait_until='domcontentloaded')
    expect(guide.locator('[data-ur-offline]')).to_be_visible()
    assert guide.locator('input[type=password]').count() == 0
    guide.goto(origin + '/dashboard.html', wait_until='domcontentloaded')
    expect(guide.locator('[data-ur-offline]')).to_be_visible()
    # A fetch/API failure must remain a failure, not cached HTML or old private data.
    assert probe.evaluate("async () => { try {await fetch('/api/private'); return false;} catch {return true;} }")
    assert probe.evaluate("async () => { try {await fetch('https://pwa-no-network.invalid/private'); return false;} catch {return true;} }")
    context.set_offline(False)
    guide.goto(origin + '/install', wait_until='networkidle')
    expect(guide.locator('[data-ur-install]')).to_be_visible()

    # A real new worker must wait while existing pages/form state remain live.
    source = (directory / 'sw.js').read_text()
    assert RELEASE_A in source
    (directory / 'sw.js').write_text(source.replace(RELEASE_A, RELEASE_B))
    probe.evaluate("""() => {
      window.pwaLoadSentinel = 'keep-until-explicit-update';
      const field = document.createElement('input'); field.id = 'pwa-unsaved-form'; field.value = 'unfinished-field-data'; document.body.append(field);
    }""")
    probe.evaluate('async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); }')
    wait_for(probe, 'async () => !!(await navigator.serviceWorker.getRegistration())?.waiting', 'New worker skipped the waiting phase or did not install')
    assert probe.evaluate('() => window.pwaLoadSentinel') == 'keep-until-explicit-update'
    assert probe.locator('#pwa-unsaved-form').input_value() == 'unfinished-field-data'
    expect(guide.locator('[data-pwa-update-notice]')).to_be_visible(timeout=10000)
    with guide.expect_navigation(wait_until='domcontentloaded'):
        guide.locator('[data-pwa-update]').click()
    wait_for(probe, "async () => (await caches.keys()).some(k => k.includes('" + RELEASE_B + "'))", 'Updated cache did not activate')
    assert probe.evaluate('() => window.pwaLoadSentinel') == 'keep-until-explicit-update', 'Another page was force-reloaded without its user action'
    assert probe.locator('#pwa-unsaved-form').input_value() == 'unfinished-field-data'
    assert probe.evaluate("() => localStorage.getItem('pwa-fixture-auth')") == 'synthetic-session-sentinel'
    assert probe.evaluate("() => localStorage.getItem('ur-smart-operations-fixture')") == 'local-farm-operation-sentinel'
    after = own_caches(probe)
    assert after and all(RELEASE_A not in name for name in after)
    assert probe.evaluate("async () => (await caches.keys()).includes('unrelated-app-cache')")
    assert not errors, errors
    evidence = {'viewport':'mobile' if mobile else 'desktop', 'registration':registration,
                'manifest_cdp':{'url':manifest_info.get('url'), 'errors':manifest_info.get('errors')},
                'installability_cdp':installability, 'public_offline':True, 'private_offline_generic':True,
                'api_failures_not_cached':True, 'query_or_private_cache_entries':False,
                'explicit_update_preserves_other_page_and_storage':True, 'cache_names':list(after)}
    context.close()
    # Return the built server to release A for the next independent browser context.
    (directory / 'sw.js').write_text(source)
    return evidence


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    scratch = Path('/workspace/scratch')
    scratch.mkdir(parents=True, exist_ok=True)
    required = ['sw.js','manifest.webmanifest','pwa-client.mjs','pwa.css','install.html','offline.html','icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','icons/apple-touch-icon.png','icons/app-icon.svg']
    assert all((ROOT / path).is_file() for path in required), 'PWA source assets are not ready'
    with tempfile.TemporaryDirectory(prefix='pwa-browser-', dir=scratch) as temporary:
        directory = Path(temporary)
        build(directory)
        with local_site(directory) as origin, sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            results = [scenario(browser, directory, origin, mobile) for mobile in (False, True)]
            browser.close()
            # Incognito browser contexts intentionally cannot install apps.
            # A separate clean local profile verifies browser eligibility while
            # still making no native OS install or real account request.
            with tempfile.TemporaryDirectory(prefix='pwa-profile-', dir=scratch) as profile:
                persistent = playwright.chromium.launch_persistent_context(
                    profile, executable_path='/usr/bin/chromium', headless=True,
                    args=['--no-sandbox'], viewport={'width':1280,'height':960}, locale='ar-IQ')
                persistent.route(lambda url: not url.startswith(origin + '/'), lambda route: route.abort('blockedbyclient'))
                page = persistent.pages[0]
                page.goto(origin + '/', wait_until='domcontentloaded')
                wait_for(page, 'async () => !!(await navigator.serviceWorker.getRegistration())?.active', 'Persistent profile worker did not activate')
                cdp = persistent.new_cdp_session(page)
                info = cdp.send('Page.getAppManifest')
                eligibility = cdp.send('Page.getInstallabilityErrors')
                assert not info.get('errors'), info
                assert not eligibility.get('installabilityErrors'), eligibility
                results.append({'profile':'clean persistent Chromium', 'manifest_errors':info.get('errors'),
                                'installability':eligibility, 'native_os_install_performed':False})
                persistent.close()
    (ARTIFACTS / 'ur-smart-pwa-browser-test.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print('Desktop/mobile: real localhost service worker, parsed manifest/icons, offline public pages, private/API cache isolation, explicit waiting update and preserved storage passed; no real account/provider calls or native OS installation.')


if __name__ == '__main__':
    main()
