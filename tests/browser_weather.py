"""Weather acceptance in Chromium using synthetic Supabase and forecast responses.
Requires Playwright and /usr/bin/chromium. All browser requests are intercepted;
no production session, account, boundary, forecast service or database is touched.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIELD_A = '11111111-1111-4111-8111-111111111111'
FIELD_B = '22222222-2222-4222-8222-222222222222'
FOREIGN = '33333333-3333-4333-8333-333333333333'
STATE = {'mode': 'ready', 'requests': []}

MOCK = r"""
const fieldA=FIELD_A,fieldB=FIELD_B;
window.__fixture={calls:[],missingBoundary:null,holdBoundary:false,pendingBoundary:null,fields:[
 {id:fieldA,farm_id:'farm',name:'حقل الاختبار الأول',crop:'حنطة',area_donum:4},
 {id:fieldB,farm_id:'farm',name:'حقل الاختبار الثاني',crop:'شعير',area_donum:8}
]};
const geometry=(id)=>{const x=id===fieldB?45:44,y=id===fieldB?34:33;return {type:'Polygon',coordinates:[[[x,y],[x+.01,y],[x+.01,y+.01],[x,y+.01],[x,y]]]};};
function createClient(){return {
 auth:{getSession:async()=>({data:{session:{access_token:'synthetic-only',user:{id:'test-user',email:'fixture@example.test'}}},error:null}),getUser:async()=>({data:{user:{id:'test-user'}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},
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
    return {
        'timezone': 'Asia/Baghdad', 'utc_offset_seconds': 10800,
        'current_units': {'temperature_2m':'°C','relative_humidity_2m':'%','precipitation':'mm','wind_speed_10m':'km/h'},
        'current': {'time':local.isoformat(timespec='minutes'),'interval':900,'temperature_2m':temp,'apparent_temperature':temp+1,'relative_humidity_2m':None,'precipitation':0,'weather_code':2,'wind_speed_10m':12,'wind_gusts_10m':18,'wind_direction_10m':270,'is_day':1},
        'hourly': {'time':times,'temperature_2m':[temp+i/10 for i in range(24)],'relative_humidity_2m':[50]*24,'precipitation':[None]+[0]*23,'precipitation_probability':[None]+[15]*23,'wind_speed_10m':[12]*24,'wind_gusts_10m':[18]*24,'weather_code':[2]*24},
        'daily': {'time':days,'weather_code':[2]*7,'temperature_2m_max':[35]*7,'temperature_2m_min':[19]*7,'precipitation_sum':[0,2,3,0,0,1,0],'precipitation_probability_max':[10,30,40,0,0,20,0],'wind_speed_10m_max':[18]*7,'wind_gusts_10m_max':[25]*7,'et0_fao_evapotranspiration':[None]+[4.2]*6,'sunrise':[day+'T06:00' for day in days],'sunset':[day+'T17:30' for day in days]}
    }


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
    if url.hostname == 'api.open-meteo.com':
        query = parse_qs(url.query)
        STATE['requests'].append({'query':query,'headers':route.request.headers})
        if STATE['mode'] == 'quota':
            route.fulfill(status=429, json={'error':True,'reason':'fixture quota'})
        else:
            route.fulfill(json=fixture_forecast(float(query['latitude'][0])))
        return
    route.abort()


def wait_text(page, selector, value):
    page.wait_for_function('([selector,value])=>document.querySelector(selector).textContent.includes(value)', arg=[selector,value])


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
        assert page.locator('#weatherDaily .day-card').first.locator('dl > div').filter(has_text='التبخر المرجعي').locator('dd').inner_text() == '—'
        assert 'فترة' in page.locator('#weatherCurrent').inner_text()
        assert 'هطول اليوم المتوقع' in page.locator('#weatherCurrent').inner_text()
        assert 'تقديرات نماذج الطقس' in page.locator('#weatherResult').inner_text()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        request = STATE['requests'][-1]
        assert request['query']['timezone'] == ['Asia/Baghdad']
        assert request['query']['forecast_hours'] == ['24'] and request['query']['forecast_days'] == ['7']
        assert 'authorization' not in request['headers'] and 'apikey' not in request['headers']
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
        assert STATE['requests'][-1]['query']['latitude'] == ['30.5085']

        page.goto('https://ur-smart.test/dashboard.html')
        page.wait_for_function("document.querySelector('#dashboardWeatherField').options.length===3")
        page.select_option('#dashboardWeatherField', FIELD_A)
        page.wait_for_function("!document.querySelector('#dashboardWeather [data-weather-summary]').hidden")
        summary = page.locator('#dashboardWeather')
        assert 'غير متاح' in summary.inner_text()
        assert summary.get_by_role('link',name='عرض التوقعات بالساعات ولسبعة أيام ←').get_attribute('href') == './weather.html?field='+FIELD_A
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert page.evaluate("window.__fixture.calls.every(call=>call.action==='select')")
        assert not errors, errors
        print(('Mobile' if mobile else 'Desktop')+': field current/24-hour/7-day forecast, missing values, period precipitation, city attribution, boundary errors, stale field suppression, quota errors, foreign-field guard and dashboard summary pass; no cloud writes.')
        context.close()
    browser.close()
