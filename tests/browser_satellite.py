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
GEOMETRY={'type':'Polygon','coordinates':[[[44,33],[44.01,33],[44.01,33.01],[44,33.01],[44,33]]]}
def chunk(tag,data): return struct.pack('!I',len(data))+tag+data+struct.pack('!I',zlib.crc32(tag+data)&0xffffffff)
raw_rows=[b'\0'+b''.join(bytes([100,100,100,0 if row<2 and col<2 else 255]) for col in range(8)) for row in range(8)]
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',8,8,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(raw_rows)))+chunk(b'IEND',b'')
IMAGE='data:image/png;base64,'+base64.b64encode(png).decode()
boundary={'geometry':GEOMETRY,'area_m2':10000,'perimeter_m':400,'updated_at':'2026-10-23T00:00:00Z'}
field={'id':FIELD,'name':'حقل اختبار','crop':'حنطة','area_donum':4,'farm_id':'farm','farms':{'owner_id':'test-user'}}
mock='''const field=FIELD,boundary=BOUNDARY;
function createClient(){return {auth:{getUser:async()=>({data:{user:{id:'test-user'}}}),getSession:async()=>({data:{session:{access_token:'fixture-only',user:{id:'test-user'}}}})},from(table){const q={};for(const method of ['select','eq','order','limit','single','maybeSingle','upsert'])q[method]=()=>q;q.then=(ok,fail)=>Promise.resolve({data:table==='fields'?[field]:table==='farms'?[{id:'farm',name:'مزرعة اختبار'}]:table==='field_boundaries'?boundary:[],error:null}).then(ok,fail);return q;}};}
'''.replace('FIELD',json.dumps(field)).replace('BOUNDARY',json.dumps(boundary))
stats={'field_id':FIELD,'geometry':GEOMETRY,'ndvi':.5,'ndmi':.2,'date':'2026-10-23T00:00:00Z','valid_pixels':10,'geometry_pixels':10,'coverage_percent':100,'indices':{'NDVI':.5,'NDMI':.2,'NDRE':.3},'resolution_m':20,'series':[{'date':'2026-10-23T00:00:00Z','indices':{'NDVI':.5,'NDMI':.2,'NDRE':.3},'ndvi':.5,'ndmi':.2,'valid_pixels':10,'coverage_percent':100}]}

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
        payload=route.request.post_data_json or {}
        if payload.get('action')=='imagery':
            if payload.get('map_index')=='NDRE':route.fulfill(status=502,json={'error':'Fixture unavailable NDRE'});return
            route.fulfill(json={'image':IMAGE,'bounds':[[33,44],[33.01,44.01]],'index':payload.get('map_index'),'date':payload.get('map_date'),'resolution_m':20});return
        route.fulfill(json=stats);return
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
        prompt=handoff.locator('textarea[id$="-preview"]').input_value()
        report=json.loads(prompt[prompt.index('{'):])
        assert report['field']['name']=='حقل اختبار'
        assert report['observations']['growth_stage']=='الإزهار'
        assert report['satellite']['date']=='2026-10-23'
        assert report['weather'] is None
        assert 'field_id' not in report and 'geometry' not in report
        assert FIELD not in prompt and 'fixture-only' not in prompt and 'sb_publishable_' not in prompt
        assert handoff.get_by_role('link').get_attribute('href')=='https://chatgpt.com/'
        # Clipboard fallback keeps the report available for manual copy.
        page.evaluate("()=>{navigator.clipboard.writeText=async()=>{throw Error('fixture clipboard blocked')};}")
        handoff.get_by_role('button',name='نسخ التقرير للمحادثة').click()
        assert 'انسخه يدويًا' in handoff.locator('[role="status"]').inner_text()
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
        prompt=handoff.locator('textarea[id$="-preview"]').input_value()
        report=json.loads(prompt[prompt.index('{'):])
        assert report['field']['name']=='حقل اختبار'
        assert report['observations']['growth_stage']=='الإزهار'
        assert report['observations']['soil_moisture']=='جافة'
        assert report['satellite'] is None
        assert report['observations']['notes']=='ملاحظة اختبار ميداني'
        assert not errors,errors
        print(('Mobile' if mobile else 'Desktop')+': free ChatGPT report preview, missing-data preservation, private-ID exclusion, clipboard fallback and field-form defaults pass.')
        context.close()
    browser.close()
