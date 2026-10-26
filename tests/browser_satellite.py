"""Browser regression check with synthetic auth, geometry and PNG fixtures.
Does not sign into or alter production. Requires Playwright and Chromium.
Leaflet 1.9.4 JS/CSS are read from /workspace/scratch/ur-leaflet.{js,css}.
"""
from pathlib import Path
from urllib.parse import urlparse
import base64, json, struct, zlib
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
FIELD='11111111-1111-4111-8111-111111111111'
FIELD_TWO='22222222-2222-4222-8222-222222222222'
GEOMETRY={'type':'Polygon','coordinates':[[[44,33],[44.01,33],[44.01,33.01],[44,33.01],[44,33]]]}
def chunk(tag,data): return struct.pack('!I',len(data))+tag+data+struct.pack('!I',zlib.crc32(tag+data)&0xffffffff)
raw_rows=[b'\0'+b''.join(bytes([100,100,100,0 if row<2 and col<2 else 255]) for col in range(8)) for row in range(8)]
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',8,8,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(raw_rows)))+chunk(b'IEND',b'')
IMAGE='data:image/png;base64,'+base64.b64encode(png).decode()
boundary={'geometry':GEOMETRY,'area_m2':10000,'perimeter_m':400,'updated_at':'2026-10-23T00:00:00Z'}
field={'id':FIELD,'name':'حقل اختبار','crop':'حنطة','area_donum':4,'farm_id':'farm','farms':{'owner_id':'test-user'}}
mock='''const field=FIELD,boundary=BOUNDARY;
function createClient(){return {auth:{getUser:async()=>({data:{user:{id:'test-user'}}}),getSession:async()=>({data:{session:{access_token:'fixture-only',user:{id:'test-user'}}}})},from(table){const q={};for(const method of ['select','eq','order','limit','single','maybeSingle','upsert'])q[method]=()=>q;q.then=(ok,fail)=>Promise.resolve({data:table==='fields'?[field,{...field,id:FIELD_TWO,name:'حقل ثانٍ'}]:table==='farms'?[{id:'farm',name:'مزرعة اختبار'}]:table==='field_boundaries'?boundary:[],error:null}).then(ok,fail);return q;}};}
'''.replace('FIELD_TWO',json.dumps(FIELD_TWO)).replace('FIELD',json.dumps(field)).replace('BOUNDARY',json.dumps(boundary))
stats={'field_id':FIELD,'geometry':GEOMETRY,'ndvi':.5,'ndmi':.2,'date':'2026-10-23T00:00:00Z','valid_pixels':10,'geometry_pixels':10,'coverage_percent':100,'indices':{'NDVI':.5,'NDMI':.2,'NDRE':.3},'resolution_m':20,'series':[{'date':'2026-10-23T00:00:00Z','indices':{'NDVI':.5,'NDMI':.2,'NDRE':.3},'ndvi':.5,'ndmi':.2,'valid_pixels':10,'coverage_percent':100}]}
stats['series'].append({**stats['series'][0],'date':'2026-10-22T00:00:00Z'})

ADVICE_MODE={'value':'ready','requests':[]}
DEFER_NEXT_IMAGE={'value':False,'pending':[]}
RECOMMENDATION={'summary':'توصية اختبار <img src=x onerror=alert(1)>','evidence':['مؤشرات مؤرخة'],'missing_data':['تحليل التربة والماء'],'irrigation':['افحص رطوبة الجذور'],'fertilization':['راجع تحليل التربة'],'follow_up':['سجل الفحص'],'limitations':['إرشادي'] }
def route_request(route):
    u=urlparse(route.request.url)
    if u.hostname=='ur-smart.test':
        path=ROOT/u.path.lstrip('/')
        if path.is_file():route.fulfill(body=path.read_bytes(),content_type='text/javascript' if path.suffix=='.mjs' else 'text/html');return
    if 'leaflet' in u.path:
        if u.path.endswith('leaflet.js'):route.fulfill(body=Path('/workspace/scratch/ur-leaflet.js').read_bytes(),content_type='text/javascript');return
        if u.path.endswith('leaflet.css'):route.fulfill(body=Path('/workspace/scratch/ur-leaflet.css').read_bytes(),content_type='text/css');return
    if '@supabase/supabase-js' in u.path:
        route.fulfill(body=mock+('export {createClient};' if u.path.endswith('/+esm') else 'window.supabase={createClient};'),content_type='text/javascript');return
    if u.hostname and u.hostname.endswith('workers.dev'):
        if u.path=='/advice/status':
            route.fulfill(json={'available':ADVICE_MODE['value']!='setup','model':'gemini-3.5-flash-lite'});return
        payload=route.request.post_data_json or {}
        if u.path=='/advice':
            ADVICE_MODE['requests'].append(payload)
            if ADVICE_MODE['value']=='quota':route.fulfill(status=429,json={'code':'FREE_QUOTA_EXHAUSTED'});return
            route.fulfill(json={'provider':'Google Gemini','model':'gemini-3.5-flash-lite','generated_at':'2026-10-25T12:00:00Z','recommendation':RECOMMENDATION});return
        if payload.get('action')=='imagery':
            if payload.get('map_index')=='NDRE':route.fulfill(status=502,json={'error':'Fixture unavailable NDRE'});return
            image_response={'image':IMAGE,'bounds':[[33,44],[33.01,44.01]],'index':payload.get('map_index'),'date':payload.get('map_date'),'resolution_m':20}
            if DEFER_NEXT_IMAGE['value']:
                DEFER_NEXT_IMAGE['value']=False;DEFER_NEXT_IMAGE['pending'].append((route,image_response));return
            route.fulfill(json=image_response);return
        route.fulfill(json={**stats,'field_id':payload.get('field_id',FIELD)});return
    if u.hostname=='api.open-meteo.com':
        route.fulfill(status=503,json={'error':'fixture weather unavailable'});return
    route.abort()

def probe_point(page,map_selector,mobile,fx=.5,fy=.5,outside=False):
    raster=page.locator(map_selector+' img.leaflet-image-layer').last
    raster.scroll_into_view_if_needed()
    box=raster.bounding_box()
    assert box and box['width']>0 and box['height']>0
    x=box['x']+(box['width']*fx if not outside else -12)
    y=box['y']+box['height']*fy
    if mobile: page.touchscreen.tap(x,y)
    else: page.mouse.move(x,y)
    return page.locator(map_selector+' .ur-pixel-probe-value')

def check_probe(page,map_selector,mobile,index='NDVI',value='0.192'):
    readout=probe_point(page,map_selector,mobile)
    page.wait_for_function("([selector,index,value])=>{const node=document.querySelector(selector+' .ur-pixel-probe-value');return node&&node.textContent.includes(index)&&node.textContent.includes(value)&&node.textContent.includes('39.2');}",arg=[map_selector,index,value])
    assert page.locator(map_selector+' .ur-pixel-probe').count()==1
    assert 'مقياس' in readout.inner_text()
    # PNG alpha is zero in the northwestern 2x2 pixels: no pixel value is allowed.
    readout=probe_point(page,map_selector,mobile,.125,.125)
    page.wait_for_function("selector=>{const n=document.querySelector(selector+' .ur-pixel-probe-value');return n&&!n.textContent.includes('39.2')&&!n.textContent.includes('0.192');}",arg=map_selector)
    assert readout.inner_text().strip()
    # Just beyond the raster is still within map padding but outside the field.
    readout=probe_point(page,map_selector,mobile,outside=True)
    page.wait_for_function("selector=>{const n=document.querySelector(selector+' .ur-pixel-probe-value');return n&&!n.textContent.includes('39.2');}",arg=map_selector)
    assert readout.inner_text().strip()
    probe_point(page,map_selector,mobile)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for mobile in (False,True):
        context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 900},is_mobile=mobile,has_touch=mobile)
        context.route('**/*',route_request)
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(e.stack))
        page.goto('https://ur-smart.test/field-map.html')
        page.wait_for_function("document.querySelector('#cloudField').options.length>1")
        page.select_option('#cloudField',FIELD);page.click('#loadIndicatorMap')
        page.wait_for_function("document.querySelector('#indicatorStatus').textContent.includes('✓')")
        assert page.locator('img.leaflet-image-layer').count()>0
        check_probe(page,'#map',mobile)
        page.click('#loadIndicatorMap')
        page.wait_for_function("!document.querySelector('#loadIndicatorMap').disabled")
        assert page.locator('img.leaflet-image-layer').count()==1
        check_probe(page,'#map',mobile)
        # Finish an older field's imagery after a newer field is already visible.
        # The old response must never replace the new layer, its label or controls.
        page.select_option('#mapIndicator','NDMI')
        DEFER_NEXT_IMAGE['value']=True
        page.click('#loadIndicatorMap')
        page.wait_for_function("document.querySelector('#indicatorStatus').textContent.includes('جارٍ إنشاء طبقة NDMI')")
        page.wait_for_timeout(50)
        assert len(DEFER_NEXT_IMAGE['pending'])==1
        page.select_option('#cloudField',FIELD_TWO)
        assert page.locator('#loadIndicatorMap').is_enabled()
        page.select_option('#mapIndicator','NDVI');page.click('#loadIndicatorMap')
        page.wait_for_function("document.querySelector('#indicatorStatus').textContent.includes('✓ ظهرت طبقة NDVI')")
        pending,image_response=DEFER_NEXT_IMAGE['pending'].pop()
        pending.fulfill(json=image_response)
        page.wait_for_timeout(100)
        assert '✓ ظهرت طبقة NDVI' in page.locator('#indicatorStatus').inner_text()
        assert page.locator('#cloudField').input_value()==FIELD_TWO
        assert page.locator('img.leaflet-image-layer').count()==1
        check_probe(page,'#map',mobile)
        # Editing a boundary also clears its cached image: palette changes must
        # not resurrect a raster clipped to the old geometry.
        page.click('#draw')
        page.locator('#map').click(position={'x':100,'y':180})
        assert page.locator('img.leaflet-image-layer').count()==0
        page.locator('#mapLowColor').evaluate("node=>{node.value='#222222';node.dispatchEvent(new Event('input',{bubbles:true}));}")
        page.wait_for_timeout(50)
        assert page.locator('img.leaflet-image-layer').count()==0
        assert not errors,errors
        page.goto('https://ur-smart.test/satellite-analysis.html')
        page.wait_for_function("document.querySelector('#field').options.length>1")
        page.select_option('#field',FIELD);page.click('#autoAnalyze')
        page.wait_for_selector('#urFieldIndicatorMap img.leaflet-image-layer')
        page.wait_for_function("document.querySelector('#autoResult').textContent.includes('Fixture unavailable NDRE')")
        assert page.locator('.ag-preview img.leaflet-image-layer').count()==2
        check_probe(page,'#urFieldIndicatorMap',mobile)
        page.get_by_role('button',name='↻ تحديث صورة القمر وطبقات المؤشرات').click()
        page.wait_for_selector('#urFieldIndicatorMap img.leaflet-image-layer')
        page.wait_for_function("document.querySelector('#autoResult').textContent.includes('Fixture unavailable NDRE')")
        assert page.locator('.ag-preview img.leaflet-image-layer').count()==2
        check_probe(page,'#urFieldIndicatorMap',mobile)
        if mobile:
            # Use the phone's native indicator pickers, then reload that layer.
            page.locator('.ag-map-main select').nth(0).select_option('NDMI')
            page.locator('.ag-map-main select').nth(1).select_option('NDVI')
            page.get_by_role('button',name='↻ تحديث صورة القمر وطبقات المؤشرات').click()
            page.wait_for_selector('#urFieldIndicatorMap img.leaflet-image-layer')
            page.wait_for_function("document.querySelector('#autoResult').textContent.includes('Fixture unavailable NDRE')")
        else:
            overlays=page.locator('#urFieldIndicatorMap .leaflet-control-layers-overlays')
            overlays.locator('label').filter(has_text='NDVI').locator('input').uncheck()
            overlays.locator('label').filter(has_text='NDMI').locator('input').check()
        check_probe(page,'#urFieldIndicatorMap',mobile,index='NDMI',value='-0.108')
        handoff=page.locator('.advisor-handoff')
        assert handoff.count()==1
        handoff.locator('select').nth(0).select_option('الإزهار')
        handoff.locator('select').nth(1).select_option('جافة')
        handoff.get_by_role('button',name='تجهيز تقرير لمناقشته مع ChatGPT').click()
        prompt=handoff.locator('textarea[id^="ur-advisor-"][id$="-preview"]').input_value()
        report=json.loads(prompt[prompt.index('{'):])
        assert report['field']['name']=='حقل اختبار'
        assert report['observations']['growth_stage']=='الإزهار'
        assert report['satellite']['date']=='2026-10-23'
        assert report['weather'] is None
        assert 'field_id' not in report and 'geometry' not in report
        assert FIELD not in prompt and 'fixture-only' not in prompt and 'sb_publishable_' not in prompt
        assert handoff.get_by_role('link',name='فتح ChatGPT ثم لصق التقرير').get_attribute('href')=='https://chatgpt.com/'
        gemini=handoff.locator('.gemini-advisor')
        gemini.get_by_role('button',name='مراجعة البيانات قبل إرسالها إلى Gemini').click()
        assert gemini.get_by_role('button',name='طلب توصية Gemini').is_disabled()
        assert 'حقل اختبار' not in gemini.locator('.gemini-preview').input_value()
        gemini.locator('input[type="checkbox"]').check()
        gemini.get_by_role('button',name='طلب توصية Gemini').click()
        page.wait_for_function("document.querySelector('.gemini-result').textContent.includes('توصية اختبار')")
        assert gemini.locator('.gemini-result img').count()==0
        assert 'fixture-only' not in json.dumps(ADVICE_MODE['requests'][-1]['report'])
        assert FIELD==ADVICE_MODE['requests'][-1]['field_id']
        page.locator('select[aria-label="اختيار تاريخ مشهد الأقمار الصناعية"]').select_option('2026-10-22T00:00:00Z')
        assert gemini.locator('.gemini-result').inner_text()==''
        assert gemini.locator('.gemini-preview').is_hidden()
        assert not gemini.locator('input[type="checkbox"]').is_checked()
        assert gemini.get_by_role('button',name='طلب توصية Gemini',include_hidden=True).is_disabled()
        gemini.get_by_role('button',name='مراجعة البيانات قبل إرسالها إلى Gemini').click()
        gemini.locator('input[type="checkbox"]').check()
        ADVICE_MODE['value']='quota'
        gemini.get_by_role('button',name='طلب توصية Gemini').click()
        page.wait_for_function("document.querySelector('.gemini-status').textContent.includes('حد الاستخدام المجاني')")
        ADVICE_MODE['value']='setup'
        gemini.get_by_role('button',name='تحديث حالة المساعد').click()
        page.wait_for_function("document.querySelector('.gemini-availability').textContent.includes('غير مفعّل')")
        assert gemini.get_by_role('button',name='طلب توصية Gemini').is_disabled()
        ADVICE_MODE['value']='ready'

        # Clipboard fallback keeps the report available for manual copy.
        page.evaluate("()=>{navigator.clipboard.writeText=async()=>{throw Error('fixture clipboard blocked')};}")
        handoff.get_by_role('button',name='نسخ التقرير للمحادثة').click()
        assert 'انسخه يدويًا' in handoff.locator(':scope > [role="status"]').inner_text()
        assert not errors,errors
        page.screenshot(path=f'/tmp/ur-satellite-{ "mobile" if mobile else "desktop"}.png',full_page=True)
        print(('Mobile' if mobile else 'Desktop')+': real Leaflet renders raster fixtures on both pages, repeat refresh works, partial failure and weather failure retain images; pixel hover/touch, nodata, outside mask and active-layer readings pass.')
        page.goto('https://ur-smart.test/field-analysis.html')
        page.wait_for_function("document.querySelector('#savedField').options.length>1")
        page.select_option('#savedField',FIELD)
        page.select_option('#growthStage','الإزهار')
        page.select_option('#soilMoisture','جافة')
        page.fill('#notes','ملاحظة اختبار ميداني')
        handoff=page.locator('.advisor-handoff')
        handoff.get_by_role('button',name='تجهيز تقرير لمناقشته مع ChatGPT').click()
        prompt=handoff.locator('textarea[id^="ur-advisor-"][id$="-preview"]').input_value()
        report=json.loads(prompt[prompt.index('{'):])
        assert report['field']['name']=='حقل اختبار'
        assert report['observations']['growth_stage']=='الإزهار'
        assert report['observations']['soil_moisture']=='جافة'
        assert report['satellite'] is None
        assert report['observations']['notes']=='ملاحظة اختبار ميداني'
        page.select_option('#plantSymptoms','اصفرار الأوراق')
        handoff.locator('textarea[id$="-soilWaterLab"]').fill('تحليل مخبري للحقل الأول فقط')
        handoff.locator('textarea[id$="-notes"]').fill('ملاحظة خاصة بالحقل الأول')
        gemini=handoff.locator('.gemini-advisor')
        gemini.get_by_role('button',name='مراجعة البيانات قبل إرسالها إلى Gemini').click()
        gemini.locator('input[type="checkbox"]').check()
        gemini.get_by_role('button',name='طلب توصية Gemini').click()
        page.wait_for_function("document.querySelector('.gemini-result').textContent.includes('توصية اختبار')")
        page.select_option('#savedField',FIELD_TWO)
        for selector in ('#growthStage','#plantSymptoms','#soilMoisture','#notes'):
            assert page.locator(selector).input_value()==''
        for suffix in ('soilWaterLab','notes'):
            assert handoff.locator('textarea[id$="-'+suffix+'"]').input_value()==''
        assert handoff.locator('textarea[id^="ur-advisor-"][id$="-preview"]').input_value()==''
        assert gemini.locator('.gemini-result').inner_text()==''
        assert gemini.locator('.gemini-preview').is_hidden()
        assert not gemini.locator('input[type="checkbox"]').is_checked()
        assert not errors,errors
        print(('Mobile' if mobile else 'Desktop')+': free ChatGPT report preview, missing-data preservation, private-ID exclusion, clipboard fallback and field-form defaults pass.')
        context.close()
    browser.close()
