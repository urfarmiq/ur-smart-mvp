"""Weather acceptance in Chromium using synthetic Supabase and forecast responses.
Requires Playwright and /usr/bin/chromium. All browser requests are intercepted;
no production session, account, boundary, forecast service or database is touched.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import json
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIELD_A = '11111111-1111-4111-8111-111111111111'
FIELD_B = '22222222-2222-4222-8222-222222222222'
FOREIGN = '33333333-3333-4333-8333-333333333333'
STATE = {'mode': 'ready', 'requests': []}

MOCK = r"""
const fieldA=FIELD_A,fieldB=FIELD_B;
window.__fixture={calls:[],authCallback:null,missingBoundary:null,holdBoundary:false,pendingBoundary:null,fields:[
 {id:fieldA,farm_id:'farm',name:'حقل الاختبار الأول',crop:'حنطة',area_donum:4},
 {id:fieldB,farm_id:'farm',name:'حقل الاختبار الثاني',crop:'شعير',area_donum:8}
]};
const geometry=(id)=>{const x=id===fieldB?45:44,y=id===fieldB?34:33;return {type:'Polygon',coordinates:[[[x,y],[x+.01,y],[x+.01,y+.01],[x,y+.01],[x,y]]]};};
function createClient(){return {
 auth:{getSession:async()=>({data:{session:{access_token:'synthetic-only',user:{id:'test-user',email:'fixture@example.test'}}},error:null}),getUser:async()=>({data:{user:{id:'test-user'}},error:null}),onAuthStateChange:callback=>{window.__fixture.authCallback=callback;return {data:{subscription:{unsubscribe(){}}}};},signOut:async()=>({error:null})},
 from(table){let filters=[],single=false,action='select';const q={};
 q.select=()=>q;q.eq=(key,value)=>{filters.push([key,value]);return q;};q.order=q.limit=()=>q;q.single=q.maybeSingle=()=>{single=true;return q;};
 for(const method of ['insert','update','delete','upsert'])q[method]=()=>{action=method;return q;};
 q.then=(ok,fail)=>Promise.resolve().then(()=>{
  const s=window.__fixture;s.calls.push({table,action,filters});if(action!=='select')throw Error('Unexpected cloud mutation in weather fixture');
  if(table==='farms')return {data:[{id:'farm',name:'مزرعة اختبار'}],error:null};
  if(table==='fields')return {data:single?s.fields[0]:s.fields,error:null};
  if(table==='field_boundaries'){
   const id=filters.find(([key])=>key==='field_id')?.[1];
   if(id===s.missingBoundary)return {data:null,error:null};
   const result={data:{geometry:geometry(id)},error:null};
   if(id===fieldA&&s.holdBoundary)return new Promise(resolve=>{s.pendingBoundary=()=>{s.pendingBoundary=null;resolve(result);};});
   return result;
  }
  return {data:[],error:null};
 }).then(ok,fail);return q;}
};}
export {createClient};
""".replace('FIELD_A', json.dumps(FIELD_A)).replace('FIELD_B', json.dumps(FIELD_B))


def fixture_forecast(latitude):
    local = (datetime.now(timezone.utc) + timedelta(hours=3)).replace(tzinfo=None, second=0, microsecond=0)
    hour = local.replace(minute=0)
    times = [(hour + timedelta(hours=i)).isoformat(timespec='minutes') for i in range(24)]
    days = [(local.date() + timedelta(days=i)).isoformat() for i in range(7)]
    temp = 32 if latitude > 33.5 else 28
    forecast = {
        'source': {'name':'MET Norway','url':'https://www.met.no/','license':'CC BY 4.0','license_url':'https://creativecommons.org/licenses/by/4.0/'},
        'timezone': 'Asia/Baghdad', 'utc_offset_seconds': 10800,
        'current_units': {'temperature_2m':'°C','relative_humidity_2m':'%','precipitation':'mm','wind_speed_10m':'km/h'},
        'current': {'time':local.isoformat(timespec='minutes'),'interval':3600,'temperature_2m':temp,'apparent_temperature':None,'relative_humidity_2m':None,'precipitation':0,'weather_code':2,'wind_speed_10m':12,'wind_gusts_10m':18,'wind_direction_10m':270,'is_day':1},
        'hourly': {'time':times,'temperature_2m':[temp+i/10 for i in range(24)],'relative_humidity_2m':[50]*24,'precipitation':[None]+[0]*23,'precipitation_probability':[None]*24,'wind_speed_10m':[12]*24,'wind_gusts_10m':[18]*24,'weather_code':[2]*24},
        'daily': {'time':days,'weather_code':[2]*7,'temperature_2m_max':[35]*7,'temperature_2m_min':[19]*7,'precipitation_sum':[0,2,3,0,0,1,0],'precipitation_probability_max':[None]*7,'wind_speed_10m_max':[18]*7,'wind_gusts_10m_max':[25]*7,'et0_fao_evapotranspiration':[None]*7,'sunrise':[None]*7,'sunset':[None]*7}
    }
    if STATE['mode'].startswith('rain_'):
        add_rain_fixture(forecast, hour, STATE['mode'][5:])
    return forecast


def add_rain_fixture(forecast, hour, mode):
    """True, nonoverlapping future periods; never infer probability from amount."""
    start = hour + timedelta(hours=1)
    step = 6 if mode == 'six_hour' else 1
    count = 12 if step == 6 else 72
    periods = []
    for index in range(count):
        amount = 0
        if mode in ('wet', 'probability', 'partial') and index == 2:
            amount = 2
        if mode in ('wet', 'probability') and index == 3:
            amount = 6
        if mode == 'six_hour' and index == 1:
            amount = 6
        if mode == 'six_hour' and index == 2:
            amount = 1
        if mode == 'later' and index == 36:
            amount = .7
        if mode == 'missing' or mode == 'partial' and index == 4:
            amount = None
        probability = 75 if mode == 'probability' and amount else None
        begin = start + timedelta(hours=index * step)
        end = begin + timedelta(hours=step)
        periods.append({'start':begin.isoformat(timespec='minutes'), 'end':end.isoformat(timespec='minutes'),
                        'precipitation_mm':amount, 'rain_probability_percent':probability,
                        'interval_seconds':step * 3600, 'weather_code':63 if amount else 2})
    forecast['precipitation_periods'] = periods
    # Source periods beyond the first24h allow an upcoming wet day to remain
    # visible even when the next24h aggregate is genuinely dry.
    shown = periods[:24 // step]
    hourly = forecast['hourly']
    hourly['time'] = [row['start'] for row in shown]
    hourly['interval'] = [row['interval_seconds'] for row in shown]
    hourly['interval_end'] = [row['end'] for row in shown]
    hourly['precipitation'] = [row['precipitation_mm'] for row in shown]
    hourly['precipitation_probability'] = [row['rain_probability_percent'] for row in shown]
    for key in ['temperature_2m','relative_humidity_2m','wind_speed_10m','wind_gusts_10m','weather_code']:
        hourly[key] = hourly[key][:len(shown)]
    if mode in ('wet','probability'):
        forecast['daily']['precipitation_sum'][0] = 8
    forecast['current']['precipitation'] = None


def route_request(route):
    url = urlparse(route.request.url)
    if url.path.endswith('/supabase-client.mjs'):
        route.fulfill(body=MOCK, content_type='text/javascript')
        return
    if url.hostname == 'ur-smart.test':
        path = ROOT / url.path.lstrip('/')
        if path.is_file():
            route.fulfill(body=path.read_bytes(), content_type={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'}.get(path.suffix,'text/html'))
            return
    if '@supabase/supabase-js' in url.path:
        route.fulfill(body=MOCK, content_type='text/javascript')
        return
    if url.hostname == 'ur-smart-satellite.alialbatekh111.workers.dev' and url.path == '/weather':
        query = parse_qs(url.query)
        STATE['requests'].append({'query':query,'headers':route.request.headers})
        if STATE['mode'] == 'quota':
            route.fulfill(status=429, json={'error':True,'reason':'fixture quota'})
        else:
            forecast = fixture_forecast(float(query['lat'][0]))
            STATE['last_forecast'] = forecast
            route.fulfill(json=forecast)
        return
    route.abort()


def wait_text(page, selector, value):
    page.wait_for_function('([selector,value])=>document.querySelector(selector).textContent.includes(value)', arg=[selector,value])


def ascii_text(value):
    return value.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫٬٪', '01234567890123456789.,%'))


def has_number(value, expected):
    numbers = re.findall(r'(?<!\d)\d+(?:\.\d+)?(?!\d)', ascii_text(value))
    return any(abs(float(number) - expected) < 1e-9 for number in numbers)


def rain_cases(page, mobile):
    for mode in ('wet', 'dry', 'missing', 'partial', 'six_hour', 'later', 'probability'):
        STATE['mode'] = 'rain_' + mode
        page.goto('https://ur-smart.test/weather.html?field=' + FIELD_A)
        wait_text(page, '#weatherStatus', 'تم تحديث توقعات موقع الحقل')
        assert page.locator('#weatherRainSummary').is_visible(), mode
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), mode
        forecast = STATE['last_forecast']
        summary = page.evaluate("async data=>(await import('./weather-core.mjs')).normalizeWeather(data).rain_forecast", forecast)
        amount = ascii_text(page.locator('#rainForecastAmount').inner_text())
        title = page.locator('#rainForecastTitle').inner_text()
        coverage = ascii_text(page.locator('#rainForecastCoverage').inner_text())
        probability = ascii_text(page.locator('#rainForecastProbability').inner_text())
        next_rain = ascii_text(page.locator('#rainForecastNext').inner_text())
        if mode != 'probability':
            assert summary['rain_probability_percent_max'] is None
            assert not re.search(r'\d\s*%', probability), probability
        if mode == 'wet':
            assert summary['complete'] and summary['precipitation_mm'] == 8
            assert summary['covered_hours'] == 24 and has_number(amount, 8), amount
            assert 'هطول' in page.locator('#weatherAlerts').inner_text()
            expected = forecast['precipitation_periods'][2]
            assert expected['start'][11:16] in next_rain and expected['end'][11:16] in next_rain, next_rain
            assert has_number(next_rain, 2), next_rain
            page.locator('#weatherRainSummary').screenshot(path='/tmp/ur-rain-wet-'+('mobile' if mobile else 'desktop')+'.png')
        elif mode == 'dry':
            assert summary['complete'] and summary['precipitation_mm'] == 0
            assert has_number(amount, 0), amount
            assert 'لا' in title and ('هطول' in title or 'مطر' in title), title
            assert summary['next_rain'] is None
        elif mode == 'missing':
            assert not summary['complete'] and summary['precipitation_mm'] is None
            assert summary['known_precipitation_mm'] is None and summary['covered_hours'] == 0
            assert not re.search(r'\d', amount), amount
            assert 'لا يُتوقع' not in title and 'لا يتوقع' not in title, title
        elif mode == 'partial':
            assert not summary['complete'] and summary['precipitation_mm'] is None
            assert summary['known_precipitation_mm'] == 2 and summary['covered_hours'] == 23
            assert has_number(coverage, 23) and has_number(coverage, 24), coverage
            assert 'كامل' in coverage or 'ناقص' in coverage or 'جزئ' in coverage, coverage
            assert 'لا يُتوقع' not in title and 'لا يتوقع' not in title, title
            page.locator('#weatherRainSummary').screenshot(path='/tmp/ur-rain-partial-'+('mobile' if mobile else 'desktop')+'.png')
        elif mode == 'six_hour':
            assert summary['complete'] and summary['precipitation_mm'] == 7
            assert has_number(amount, 7), amount
            assert len(summary['periods']) == 4 and summary['next_rain']['interval_seconds'] == 21600
            expected = forecast['precipitation_periods'][1]
            assert expected['start'][11:16] in next_rain and expected['end'][11:16] in next_rain, next_rain
            assert has_number(next_rain, 6), next_rain
            period_text = ascii_text(page.locator('#rainForecastPeriods').inner_text())
            assert has_number(period_text, 6) and 'ملم/ساعة' not in period_text, period_text
            hourly = ascii_text(page.locator('#weatherHourly').inner_text())
            assert '6' in hourly and ('ساعات' in hourly or 'فترة' in hourly), hourly
        elif mode == 'later':
            assert summary['complete'] and summary['precipitation_mm'] == 0
            assert has_number(amount, 0), amount
            expected = forecast['precipitation_periods'][36]
            assert summary['next_rain']['start'] == expected['start']
            assert expected['start'][11:16] in next_rain and expected['end'][11:16] in next_rain, next_rain
            assert has_number(next_rain, .7), next_rain
            # The nearest wet interval belongs to a later date, not a claim of
            # current rain merely because its clock time repeats tomorrow.
            expected_day = page.evaluate("date=>new Intl.DateTimeFormat('ar-IQ',{weekday:'long',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'))", expected['start'][:10])
            assert ascii_text(expected_day) in next_rain, next_rain
        elif mode == 'probability':
            assert summary['rain_probability_percent_max'] == 75
            assert has_number(probability, 75) and '%' in probability, probability
    # Expiring a field session must hide its rain result and disable private
    # field selection rather than leave the previous forecast attributed to it.
    before = len(STATE['requests'])
    page.evaluate("window.__fixture.authCallback('SIGNED_OUT')")
    assert page.locator('#weatherResult').is_hidden()
    assert page.locator('#weatherField').is_disabled()
    assert len(STATE['requests']) == before
    assert page.evaluate("window.__fixture.calls.every(call=>call.action==='select')")
    STATE['mode'] = 'ready'


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    for mobile in (False, True):
        context = browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 900}, is_mobile=mobile, has_touch=mobile)
        context.route('**/*', route_request)
        page = context.new_page()
        page.set_default_timeout(10000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        STATE['mode'] = 'ready'
        page.goto('https://ur-smart.test/weather.html?field='+FIELD_A)
        wait_text(page, '#weatherStatus', 'تم تحديث توقعات موقع الحقل')
        assert page.locator('#weatherLocation').inner_text() == 'حقل الاختبار الأول'
        assert page.locator('#weatherHourly .hour-card').count() == 24
        assert page.locator('#weatherDaily .day-card').count() == 7
        assert page.locator('#weatherCurrent .metric').filter(has_text='الرطوبة النسبية').locator('strong').inner_text() == '—'
        assert page.locator('#weatherDaily .day-card').first.locator('dl > div').filter(has_text='التبخر المرجعي').locator('dd').inner_text() == 'غير متاح'
        assert 'فترة' in page.locator('#weatherCurrent').inner_text()
        assert page.locator('#weatherRainSummary').is_visible()
        assert 'مجموع الهطول ليوم كامل' in page.locator('#weatherDaily').inner_text()
        assert 'تقديرات نماذج الطقس' in page.locator('#weatherResult').inner_text()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        request = STATE['requests'][-1]
        assert set(request['query']) == {'lat', 'lon'}
        assert 'MET Norway' in page.locator('footer.source').inner_text()
        assert 'CC BY 4.0' in page.locator('footer.source').inner_text()
        assert 'authorization' not in request['headers'] and 'apikey' not in request['headers'] and 'cookie' not in request['headers']
        assert not any('key' in key.lower() for key in request['query'])
        assert page.evaluate("window.__fixture.calls.every(call=>call.action==='select')")
        page.screenshot(path='/tmp/ur-weather-'+('mobile' if mobile else 'desktop')+'.png', full_page=True)

        # An unavailable boundary must never become a reference-city forecast silently.
        before = len(STATE['requests'])
        page.evaluate('id=>{window.__fixture.missingBoundary=id;}', FIELD_B)
        page.select_option('#weatherField', FIELD_B)
        wait_text(page, '#weatherStatus', 'لا توجد حدود محفوظة')
        assert page.locator('#weatherResult').is_hidden()
        assert len(STATE['requests']) == before

        # A delayed A boundary cannot replace B or launch A's stale forecast request.
        page.evaluate("()=>{window.__fixture.missingBoundary=null;window.__fixture.holdBoundary=true;}")
        page.select_option('#weatherField', FIELD_A)
        page.wait_for_function('!!window.__fixture.pendingBoundary')
        page.select_option('#weatherField', FIELD_B)
        wait_text(page, '#weatherLocation', 'حقل الاختبار الثاني')
        before = len(STATE['requests'])
        page.evaluate("async()=>{window.__fixture.pendingBoundary();await new Promise(resolve=>setTimeout(resolve,0));}")
        assert page.locator('#weatherLocation').inner_text() == 'حقل الاختبار الثاني'
        assert len(STATE['requests']) == before
        page.evaluate('window.__fixture.holdBoundary=false')

        STATE['mode'] = 'quota'
        page.click('#refreshWeather')
        wait_text(page, '#weatherStatus', 'حد الطلبات')
        assert page.locator('#weatherResult').is_hidden()
        STATE['mode'] = 'ready'

        # A foreign query parameter cannot read a boundary or trigger a weather lookup.
        before = len(STATE['requests'])
        page.goto('https://ur-smart.test/weather.html?field='+FOREIGN)
        wait_text(page, '#weatherStatus', 'غير متاح في حسابك')
        assert page.locator('#weatherField').input_value() == ''
        assert page.evaluate("window.__fixture.calls.filter(call=>call.table==='field_boundaries').length") == 0
        assert len(STATE['requests']) == before
        page.select_option('#locationMode', 'city')
        page.select_option('#weatherCity', 'basra')
        wait_text(page, '#weatherStatus', 'طقس المدينة المرجعية')
        assert page.locator('#weatherLocation').inner_text() == 'البصرة'
        assert 'مدينة مرجعية' in page.locator('#weatherLocationKind').inner_text()
        assert STATE['requests'][-1]['query']['lat'] == ['30.5085']

        page.goto('https://ur-smart.test/dashboard.html')
        page.wait_for_function("document.querySelector('#dashboardWeatherField').options.length===3")
        page.select_option('#dashboardWeatherField', FIELD_A)
        page.wait_for_function("!document.querySelector('#dashboardWeather [data-weather-summary]').hidden")
        summary = page.locator('#dashboardWeather')
        assert 'غير متاح' in summary.inner_text()
        assert summary.get_by_role('link',name='عرض التوقعات بالساعات ولسبعة أيام ←').get_attribute('href') == './weather.html?field='+FIELD_A
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert page.evaluate("window.__fixture.calls.every(call=>call.action==='select')")
        rain_cases(page, mobile)
        assert not errors, errors
        print(('Mobile' if mobile else 'Desktop')+': rain quantity/time/coverage, unknown probability, dry versus missing, partial-day and6-hour periods, later wet-day visibility, session cleanup, existing field/current/daily forecast, city attribution, stale field suppression, quota/foreign-field guards and dashboard summary pass; no cloud writes.')
        context.close()
    browser.close()
