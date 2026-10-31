"""Plant photo assessment acceptance with the real pinned Supabase browser SDK.

Every HTTP request is intercepted. All users/tokens/provider assessments and
photos are synthetic. No production account, database or Gemini call is made.
The encoded photos are real decodable files, including EXIF privacy markers.
"""
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import base64
import io
import json
import re
import time
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://plant.test'
API_HOST = 'ynsmhtsktbubxfhsekjq.supabase.co'
WORKER_HOST = 'ur-smart-satellite.alialbatekh111.workers.dev'
STORAGE_KEY = 'sb-ynsmhtsktbubxfhsekjq-auth-token'
USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
PUBLIC_KEY = 'sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc'
EXIF_MARKER = 'PRIVATE_PHOTO_EXIF_MARKER'


def encode(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')


now = int(time.time())
ACCESS_TOKEN = '.'.join([encode({'alg': 'HS256', 'typ': 'JWT'}),
                        encode({'sub': USER_ID, 'aud': 'authenticated', 'role': 'authenticated',
                                'aal': 'aal1', 'iat': now, 'exp': now + 3600}),
                        'synthetic-signature-never-sent-to-server'])
REFRESH_TOKEN = 'synthetic-refresh-never-used-on-a-server'
USER = {'id': USER_ID, 'aud': 'authenticated', 'role': 'authenticated',
        'email': 'plant-fixture@example.invalid', 'email_confirmed_at': '2026-01-01T00:00:00Z',
        'created_at': '2026-01-01T00:00:00Z', 'app_metadata': {'provider': 'email'},
        'user_metadata': {}, 'identities': []}
SESSION = {'access_token': ACCESS_TOKEN, 'refresh_token': REFRESH_TOKEN, 'token_type': 'bearer',
           'expires_in': 3600, 'expires_at': now + 3600, 'user': USER}


def photo(fmt='JPEG', width=2000, height=1500, marker=True):
    image = Image.new('RGB', (width, height), (213, 226, 205))
    draw = ImageDraw.Draw(image)
    draw.ellipse((width // 5, height // 6, width * 4 // 5, height * 5 // 6), fill=(37, 111, 46))
    draw.line((width // 2, height // 6, width // 2, height * 5 // 6), fill=(95, 150, 63), width=max(1, width // 90))
    draw.ellipse((width // 2, height // 2, width // 2 + width // 14, height // 2 + height // 14), fill=(121, 79, 27))
    output = io.BytesIO()
    options = {}
    if fmt == 'JPEG' and marker:
        exif = Image.Exif()
        exif[270] = EXIF_MARKER
        exif[315] = 'PRIVATE_AUTHOR_MARKER'
        options['exif'] = exif
    image.save(output, format=fmt, **options)
    return output.getvalue()


JPEG = photo()
PNG = photo('PNG', 96, 72, False)
WEBP = photo('WEBP', 180, 120, False)
noise_image=Image.effect_noise((2400,1800),96).convert('RGB')
noise_bytes=io.BytesIO();noise_image.save(noise_bytes,format='JPEG',quality=95)
NOISY_JPEG=noise_bytes.getvalue()
assert EXIF_MARKER.encode() in JPEG


def upload(payload, name='leaf.jpg', mime='image/jpeg'):
    return {'name': name, 'mimeType': mime, 'buffer': payload}


def wait_status(page, text):
    expect(page.locator('#plantHealthStatus')).to_contain_text(text)


def ready(page):
    page.goto(SITE + '/plant-health.html', wait_until='domcontentloaded')
    page.wait_for_function("()=>document.querySelector('#retryAccount')&&!document.querySelector('#retryAccount').disabled")


def fill_notes(page):
    page.fill('#crop', 'طماطم')
    page.fill('#symptoms', 'بقع بنية على أوراق النبات مع اصفرار محدود')
    page.fill('#duration', 'ثلاثة أيام')
    page.fill('#region', 'بغداد')
    page.fill('#recentCare', 'سقي معتدل، لا رش حديث')


def submit(page):
    page.check('#shareConsent')
    page.click('#analyzePlant')


def route_factory(state):
    def route_request(route):
        request = route.request
        url = urlparse(request.url)
        state['requests'].append(request.url)
        if url.hostname == 'plant.test':
            path = ROOT / url.path.lstrip('/')
            if path.is_file():
                route.fulfill(body=path.read_bytes(), content_type={'.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css'}.get(path.suffix, 'text/html'))
                return
        if url.hostname == API_HOST:
            cors = {'access-control-allow-origin': SITE,
                    'access-control-allow-methods': 'GET,POST,OPTIONS',
                    'access-control-allow-headers': request.headers.get('access-control-request-headers', 'apikey,authorization,content-type,x-client-info,x-supabase-api-version')}
            if request.method == 'OPTIONS':
                route.fulfill(status=204, headers=cors)
                return
            state['auth_calls'].append({'path': url.path, 'method': request.method})
            if url.path == '/auth/v1/logout':
                route.fulfill(status=204, headers=cors)
                return
            if url.path == '/auth/v1/user':
                route.fulfill(json=USER, headers=cors)
                return
            raise AssertionError('Unexpected database/auth request: ' + url.path)
        if url.hostname == WORKER_HOST:
            if url.path == '/plant-health/status':
                assert request.method == 'GET'
                route.fulfill(json=state['readiness'])
                return
            if url.path == '/plant-health':
                assert request.method == 'POST'
                assert request.headers.get('authorization') == 'Bearer ' + state.get('expected_token',ACCESS_TOKEN)
                body = json.loads(request.post_data)
                state['submissions'].append(body)
                if state['mode'] == 'hold':
                    state['held'].append(route)
                    return
                if state['mode'] == 'quota':
                    route.fulfill(status=429, json={'code': 'FREE_QUOTA_EXHAUSTED', 'message': 'انتهت الحصة المجانية، أعد المحاولة لاحقًا.'})
                    return
                if state['mode'] == 'invalid':
                    route.fulfill(body='{bad json', content_type='application/json')
                    return
                route.fulfill(json=state['response'])
                return
        route.abort('blockedbyclient')
    return route_request


def context_for(browser, mobile, authenticated=True):
    context = browser.new_context(viewport={'width': 390 if mobile else 1280, 'height': 844 if mobile else 960},
                                  is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    if authenticated:
        context.add_init_script('if(!localStorage.getItem(' + json.dumps(STORAGE_KEY) + '))localStorage.setItem(' + json.dumps(STORAGE_KEY) + ',' + json.dumps(json.dumps(SESSION)) + ');')
    state = {'requests': [], 'auth_calls': [], 'submissions': [], 'held': [], 'mode': 'ready',
             'readiness': {'available': True, 'free_tier_confirmed': True, 'model': 'gemini-3.5-flash-lite'},
             'response': {}}
    context.route('**/*', route_factory(state))
    page = context.new_page()
    page.set_default_timeout(10000)
    errors, console = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda msg: console.append(msg.text))
    return context, page, state, errors, console


def verify_payload(body):
    assert body['consent'] is True
    assert body['crop'] == 'طماطم' and 'بقع' in body['symptoms']
    assert len(body['images']) >= 1
    assert not any(key in body for key in ('email', 'user_id', 'access_token', 'latitude', 'longitude'))
    total = 0
    for item in body['images']:
        assert item['mime_type'] == 'image/jpeg'
        raw = base64.b64decode(item['data'], validate=True)
        total += len(raw)
        assert len(raw) <= 160 * 1024
        assert EXIF_MARKER.encode() not in raw and b'PRIVATE_AUTHOR_MARKER' not in raw
        image = Image.open(io.BytesIO(raw))
        image.load()
        assert image.format == 'JPEG' and max(image.size) <= 1536
        assert item['width'] == image.width and item['height'] == image.height
        assert not image.getexif(), 'Canvas output must strip EXIF'
    assert total <= 512 * 1024
    assert len(json.dumps(body,ensure_ascii=False).encode()) <= 768 * 1024


def close(context, state):
    for route in state['held']:
        try:
            route.abort('blockedbyclient')
        except Exception:
            pass
    context.close()


# Response contract and the end-to-end scenarios are added after the frontend
# and backend agree on the exact validated JSON schema.


def result_fixture(abstain=False, injection=False):
    return {'provider': 'Google Gemini', 'model': 'gemini-3.5-flash-lite',
            'generated_at': '2026-10-31T12:00:00Z',
            'assessment': {
                'image_quality': 'unusable' if abstain else 'usable',
                'plant_visible': not abstain,
                'summary': 'لا يمكن تمييز نبات أو أعراض صالحة للتقييم.' if abstain else ('<img src=x onerror="window.__plantPwned=1"> ' if injection else '')+'بقع قد ترتبط بأكثر من سبب، ولا تكفي الصورة لتأكيد مرض.',
                'observations': [] if abstain else ['بقع بنية محدودة على الورقة الظاهرة.'],
                'possible_causes': [] if abstain else [
                    {'name': ('<script>window.__plantPwned=1</script> ' if injection else '')+'احتمال مرض ورقي', 'category': 'disease',
                     'supporting_signs': ['البقع الظاهرة قد تتوافق مع أكثر من مرض.'],
                     'distinguishing_checks': ['افحص أسفل الورقة ونمط انتشار البقع.']},
                    {'name': 'إجهاد غير حيوي محتمل', 'category': 'abiotic',
                     'supporting_signs': ['الاصفرار قد يرتبط بالري أو التغذية.'],
                     'distinguishing_checks': ['راجع رطوبة الجذور وتاريخ الإضافات.']}],
                'missing_information': ['صورة أقرب للسطح السفلي للورقة.'],
                'initial_steps': ['أعد التصوير بإضاءة طبيعية.' if abstain else 'راقب الأوراق الجديدة وقارن نباتًا سليمًا مجاورًا.'],
                'expert_review': ['راجع مهندسًا زراعيًا إذا اتسع الضرر.'],
                'limitations': ['تقييم أولي للصورة، وليس تشخيصًا مختبريًا أو وصفة مبيد.']},
            'note': 'فحص أولي يحتاج تحققًا ميدانيًا؛ لم تُحفظ الصور تلقائيًا.'}


def authenticated_scenario(browser, mobile):
    context, page, state, errors, console = context_for(browser, mobile)
    state['response'] = result_fixture(injection=True)
    ready(page)
    assert page.locator('#accountSignIn').is_hidden()
    assert not state['submissions']
    assert any(url.endswith('/supabase-client.mjs') for url in state['requests'])
    assert any(url.endswith('/vendor/supabase-js-2.57.4.js') for url in state['requests'])
    assert not any('cdn.jsdelivr.net' in url for url in state['requests'])
    assert page.locator('#plantCamera').get_attribute('capture') == 'environment'

    # Real file decoding and preprocessing: a large JPEG carries private EXIF.
    page.locator('#plantImages').set_input_files(upload(JPEG))
    expect(page.locator('#photoPreviews .photo-card')).to_have_count(1)
    page.locator('#photoPreviews .expand-photo').first.click()
    expect(page.locator('#photoDialog')).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.locator('#photoDialog')).to_be_hidden()
    fill_notes(page)
    # Consent must gate the provider call, regardless of form validation/UI style.
    page.locator('#plantHealthForm').evaluate('form=>form.requestSubmit()')
    page.wait_for_timeout(100)
    assert not state['submissions']
    submit(page)
    expect(page.locator('#resultPanel')).to_be_visible()
    assert len(state['submissions']) == 1
    verify_payload(state['submissions'][0])
    assert page.locator('#resultPanel img, #resultPanel script').count() == 0
    assert page.evaluate('()=>window.__plantPwned') is None
    assert '<img src=x' in page.locator('#resultSummary').inner_text()
    assert 'إجهاد غير حيوي' in page.locator('#resultPanel').inner_text()
    assert not re.search(r'\d+\s*[%٪]', page.locator('#resultPanel').inner_text())
    assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1')
    state['response'] = result_fixture()
    submit(page)
    expect(page.locator('#resultPanel')).to_be_visible()
    assert len(state['submissions']) == 2
    page.evaluate('()=>scrollTo(0,0)')
    page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    page.screenshot(path='/tmp/ur-plant-health-'+('mobile' if mobile else 'desktop')+'.png', full_page=True)
    page.locator('#resultPanel').screenshot(path='/tmp/ur-plant-health-result-'+('mobile' if mobile else 'desktop')+'.png')

    with page.expect_download() as download:
        page.click('#downloadPlantReport')
    exported = json.loads(Path(download.value.path()).read_text())
    assert EXIF_MARKER not in json.dumps(exported) and ACCESS_TOKEN not in json.dumps(exported)
    assert 'data:image/' not in json.dumps(exported)
    page.evaluate('()=>{window.__plantPrintCalls=0;window.print=()=>window.__plantPrintCalls++;}')
    page.click('#printPlantReport')
    assert page.evaluate('()=>window.__plantPrintCalls') == 1

    # Changing observations must immediately invalidate a prior result/export.
    page.fill('#symptoms', 'تغيّرت الملاحظة: اصفرار محدود دون بقع مؤكدة')
    assert page.locator('#resultPanel').is_hidden()
    assert page.locator('#downloadPlantReport').is_hidden() or page.locator('#downloadPlantReport').is_disabled()
    fill_notes(page)

    # The source may be JPG, PNG or WebP; all outbound photos are clean JPEG.
    page.locator('#plantImages').set_input_files([upload(PNG, 'leaf.png', 'image/png'), upload(WEBP, 'leaf.webp', 'image/webp')])
    expect(page.locator('#photoPreviews .photo-card')).to_have_count(3)
    page.locator('#plantCamera').set_input_files(upload(PNG, 'camera.png', 'image/png'))
    page.wait_for_timeout(100)
    assert page.locator('#photoPreviews .photo-card').count() == 3
    assert len(state['submissions']) == 2
    page.locator('#photoPreviews .remove-photo').last.click()
    expect(page.locator('#photoPreviews .photo-card')).to_have_count(2)
    page.locator('#plantCamera').set_input_files(upload(PNG, 'camera.png', 'image/png'))
    expect(page.locator('#photoPreviews .photo-card')).to_have_count(3)
    submit(page)
    expect(page.locator('#resultPanel')).to_be_visible()
    verify_payload(state['submissions'][-1])
    assert len(state['submissions'][-1]['images']) == 3

    page.click('#clearPlantForm')
    expect(page.locator('#photoPreviews .photo-card')).to_have_count(0)
    assert page.locator('#resultPanel').is_hidden() and not page.locator('#shareConsent').is_checked()
    assert page.locator('#crop').input_value() == ''
    # Invalid signatures, unsupported types and oversized originals never send a request.
    before = len(state['submissions'])
    for file in (upload(b'not an image', 'invalid.jpg'),
                 upload(b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'vector.svg', 'image/svg+xml'),
                 upload(b'\0' * (10 * 1024 * 1024 + 1), 'huge.jpg')):
        page.locator('#plantImages').set_input_files(file)
        page.wait_for_timeout(100)
        assert page.locator('#photoPreviews .photo-card').count() == 0
        assert len(state['submissions']) == before
    page.locator('#plantImages').set_input_files(upload(NOISY_JPEG,'complex-leaf.jpg'))
    expect(page.locator('#photoPreviews .photo-card')).to_have_count(1)
    fill_notes(page)

    # Provider failures must not leave an earlier successful report visible.
    state['mode'] = 'quota'
    submit(page)
    wait_status(page, 'الحصة')
    verify_payload(state['submissions'][-1])
    assert page.locator('#resultPanel').is_hidden()
    state['mode'] = 'invalid'
    submit(page)
    page.wait_for_function("()=>!document.querySelector('#analyzePlant').disabled")
    assert page.locator('#resultPanel').is_hidden()

    state['mode'] = 'ready'
    state['response'] = result_fixture(abstain=True)
    submit(page)
    expect(page.locator('#resultPanel')).to_be_visible()
    assert 'لا يمكن تمييز نبات' in page.locator('#resultSummary').inner_text()
    assert 'احتمال مرض ورقي' not in page.locator('#resultPanel').inner_text()

    # Editing during an outstanding request must reject its late result.
    state['mode'] = 'hold'
    submit(page)
    page.wait_for_function("()=>document.querySelector('#analyzePlant').disabled")
    page.wait_for_timeout(60)
    assert state['held']
    page.fill('#symptoms', 'ملاحظة جديدة أثناء انتظار نتيجة قديمة')
    for held in state['held']:
        try:
            held.fulfill(json=result_fixture())
        except Exception:
            pass
    state['held'].clear()
    page.wait_for_timeout(100)
    assert page.locator('#resultPanel').is_hidden()

    stored = page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', STORAGE_KEY)
    assert stored['access_token'] == ACCESS_TOKEN and stored['refresh_token'] == REFRESH_TOKEN
    assert EXIF_MARKER not in page.evaluate('()=>JSON.stringify(localStorage)')
    assert page.evaluate('(expected)=>Object.keys(localStorage).every(key=>key===expected)', STORAGE_KEY)
    for secret in [ACCESS_TOKEN, REFRESH_TOKEN]:
        assert secret not in page.content()
        assert not any(secret in line for line in console)
    assert not errors, errors
    # A missed cross-tab event must not carry A's photos/notes into B on retry.
    assert page.locator('#photoPreviews .photo-card').count() == 1
    other = json.loads(json.dumps(SESSION))
    other['user']['id'] = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    other['access_token'] = '.'.join([encode({'alg':'HS256','typ':'JWT'}), encode({'sub':other['user']['id'],'aud':'authenticated','role':'authenticated','iat':now,'exp':now+3600}), 'synthetic-other-user-signature'])
    other['refresh_token'] = 'synthetic-other-user-refresh'
    before_switch = len(state['submissions'])
    page.evaluate('([key,value])=>localStorage.setItem(key,JSON.stringify(value))', [STORAGE_KEY,other])
    page.click('#retryAccount')
    expect(page.locator('#photoPreviews .photo-card')).to_have_count(0)
    assert page.locator('#crop').input_value() == '' and page.locator('#symptoms').input_value() == ''
    assert page.locator('#resultPanel').is_hidden() and not page.locator('#shareConsent').is_checked()
    assert len(state['submissions']) == before_switch
    # A real SDK SIGNED_OUT broadcast while an image request is pending clears
    # the photos/notes and cannot be undone by that request's late response.
    state['expected_token']=other['access_token']
    page.locator('#plantImages').set_input_files(upload(JPEG))
    expect(page.locator('#photoPreviews .photo-card')).to_have_count(1)
    fill_notes(page)
    submit(page)
    page.wait_for_function('()=>document.querySelector("#analyzePlant").disabled')
    page.wait_for_timeout(60)
    assert state['held']
    page.evaluate("async([url,key])=>{const {createClient}=await import('./supabase-client.mjs');const signoutClient=createClient(url,key);await signoutClient.auth.signOut({scope:'local'});}", ['https://'+API_HOST,PUBLIC_KEY])
    expect(page.locator('#photoPreviews .photo-card')).to_have_count(0)
    expect(page.locator('#accountSignIn')).to_be_visible()
    assert page.locator('#symptoms').input_value()=='' and page.locator('#resultPanel').is_hidden()
    for held in state['held']:
        try:held.fulfill(json=result_fixture())
        except Exception:pass
    state['held'].clear()
    page.wait_for_timeout(100)
    assert page.locator('#resultPanel').is_hidden()
    assert not errors,errors
    close(context, state)


def anonymous_scenario(browser, mobile):
    context, page, state, errors, console = context_for(browser, mobile, authenticated=False)
    state['response'] = result_fixture()
    ready(page)
    expect(page.locator('#accountSignIn')).to_be_visible()
    assert not state['auth_calls'] and not state['submissions']
    page.locator('#plantImages').set_input_files(upload(JPEG))
    expect(page.locator('#photoPreviews .photo-card')).to_have_count(1)
    fill_notes(page)
    page.check('#shareConsent')
    page.locator('#plantHealthForm').evaluate('form=>form.requestSubmit()')
    page.wait_for_timeout(100)
    assert not state['submissions'] and page.locator('#resultPanel').is_hidden()
    assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1')
    assert not errors, errors
    close(context, state)


if __name__ == '__main__':
    import re
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        for mobile in (False, True):
            authenticated_scenario(browser, mobile)
            anonymous_scenario(browser, mobile)
            print(('Mobile' if mobile else 'Desktop') + ': actual local SDK, camera/upload/EXIF cleanup, consent/auth, precise payload, safe results, quota/invalid/abstention, stale input and exports pass; intercepted fixtures only.')
        browser.close()
