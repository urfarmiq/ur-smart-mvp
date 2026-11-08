"""Terrain UI with actual Copernicus DEM-derived analysis, isolated HTTP fixtures.

User/session IDs, fields and report persistence are synthetic. Elevations and all
terrain layers come from the real DEM fixture produced by the source integration
check. No production login, database write, provider request or payment occurs.
Run after generating /workspace/artifacts/terrain-real-dem-analysis.json.
"""
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from datetime import datetime,timezone
import base64,copy,json,time
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parent.parent
ART=Path('/workspace/artifacts')
FIXTURE=ART/'terrain-real-dem-analysis.json'
SITE='https://terrain-ui.test'
API='ynsmhtsktbubxfhsekjq.supabase.co'
WORKER='ur-smart-satellite.alialbatekh111.workers.dev'
OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
FIELD='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
NEW_FIELD='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
FARM='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
REPORT='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
STAMP='2026-11-08T12:00:00Z'
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFAcAAAAASUVORK5CYII=')

def enc(value):return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
def user():return {'id':OWNER,'aud':'authenticated','role':'authenticated','email':'terrain-ui@example.invalid','created_at':STAMP,'app_metadata':{'provider':'email'},'user_metadata':{},'identities':[]}
def session():
    stamp=int(time.time())
    token='.'.join([enc({'alg':'HS256','typ':'JWT'}),enc({'sub':OWNER,'aud':'authenticated','role':'authenticated','iat':stamp,'exp':stamp+3600}),'isolated-fixture-signature'])
    return {'access_token':token,'refresh_token':'isolated-fixture-refresh','token_type':'bearer','expires_in':3600,'expires_at':stamp+3600,'user':user()}

def fixture_state():
    return {'analysis':json.loads(FIXTURE.read_text()),'fields':[{'id':FIELD,'name':'حقل واسط — DEM حقيقي','crop':'حنطة','farm_id':FARM,'farms':{'owner_id':OWNER}}],
            'boundaries':{},'saved_report':False,'api_error':False,'requests':[],'posts':[],'deletes':[],'reports':[]}

def cors(request):return {'access-control-allow-origin':SITE,'access-control-allow-methods':'GET,POST,DELETE,OPTIONS','access-control-allow-headers':request.headers.get('access-control-request-headers','apikey,authorization,content-type,x-client-info,x-supabase-api-version')}

def routes(state):
    state['boundaries'][FIELD]=state['analysis']['polygon']
    def handle(route):
        req=route.request;url=urlparse(req.url);state['requests'].append(req.url)
        if url.hostname=='terrain-ui.test':
            rel=url.path.lstrip('/') or 'index.html';p=(ROOT/rel).resolve()
            if p.is_relative_to(ROOT) and p.is_file():route.fulfill(body=p.read_bytes(),content_type={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}.get(p.suffix,'text/html'));return
        if url.hostname=='unpkg.com' and '/leaflet@1.9.4/dist/' in url.path:
            if url.path.endswith('leaflet.js'):route.fulfill(body=Path('/workspace/scratch/ur-leaflet.js').read_bytes(),content_type='text/javascript');return
            if url.path.endswith('leaflet.css'):route.fulfill(body=Path('/workspace/scratch/ur-leaflet.css').read_bytes(),content_type='text/css');return
            route.fulfill(body=PNG,content_type='image/png');return
        if url.hostname in (API,WORKER):
            headers=cors(req)
            if req.method=='OPTIONS':route.fulfill(status=204,headers=headers);return
            body=json.loads(req.post_data) if req.post_data else None
            state['posts'].append({'host':url.hostname,'path':url.path,'method':req.method,'body':body,'query':parse_qs(url.query)})
            if url.hostname==API:
                if url.path=='/auth/v1/user':route.fulfill(json=user(),headers=headers);return
                if url.path=='/auth/v1/logout':route.fulfill(status=204,headers=headers);return
                if url.path=='/rest/v1/fields':
                    if req.method=='GET':route.fulfill(json=state['fields'],headers=headers);return
                    assert req.method=='POST' and body['farm_id']==FARM
                    row={'id':NEW_FIELD,**body};state['fields'].append(row);route.fulfill(status=201,json=row,headers=headers);return
                if url.path=='/rest/v1/farms':route.fulfill(json=[{'id':FARM,'name':'مزرعة الاختبار'}],headers=headers);return
                if url.path=='/rest/v1/field_boundaries':
                    if req.method=='GET':
                        field=parse_qs(url.query)['field_id'][0].removeprefix('eq.');poly=state['boundaries'].get(field)
                        route.fulfill(json=[{'geometry':poly}] if poly else [],headers=headers);return
                    assert req.method=='POST' and body['owner_id']==OWNER
                    state['boundaries'][body['field_id']]=body['geometry'];route.fulfill(status=201,body='',headers=headers);return
                if url.path=='/rest/v1/terrain_reports' and req.method=='DELETE':
                    assert parse_qs(url.query)['user_id']==['eq.'+OWNER]
                    state['deletes'].append(parse_qs(url.query)['id'][0]);state['reports']=[]
                    route.fulfill(json={'id':REPORT},headers=headers);return
                raise AssertionError('Unexpected database request '+url.path)
            assert url.path=='/terrain' and req.method=='POST'
            assert req.headers.get('authorization','').startswith('Bearer ')
            if body['action']=='list':route.fulfill(json={'reports':copy.deepcopy(state['reports'])},headers=headers);return
            if body['action']=='get':route.fulfill(json={'report_id':REPORT,'field_id':FIELD,'created_at':STAMP,'analysis':state['analysis']},headers=headers);return
            assert body=={'action':'analyze','field_id':FIELD}
            if state['api_error']:route.fulfill(status=502,json={'message':'تعذر جلب بيانات الارتفاع من المصدر. لم تُنشأ نتائج بديلة.'},headers=headers);return
            state['saved_report']=True;state['reports']=[{'report_id':REPORT,'field_id':FIELD,'created_at':STAMP,'source_id':state['analysis']['source']['id']}]
            route.fulfill(json={'report_id':REPORT,'field_id':FIELD,'created_at':STAMP,'analysis':state['analysis']},headers=headers);return
        if url.hostname=='server.arcgisonline.com' or url.hostname.endswith('.tile.openstreetmap.org'):
            route.fulfill(body=PNG,content_type='image/png');return
        if url.hostname in ('fonts.googleapis.com','fonts.gstatic.com'):
            route.fulfill(body='',content_type='text/css');return
        route.abort('blockedbyclient')
    return handle

def start(browser,mobile,authenticated=True):
    state=fixture_state();context=browser.new_context(viewport={'width':390 if mobile else 1360,'height':844 if mobile else 980},is_mobile=mobile,has_touch=mobile,locale='ar-IQ',service_workers='block')
    context.route('**/*',routes(state))
    if authenticated:
        value=json.dumps(session());context.add_init_script("localStorage.setItem('sb-ynsmhtsktbubxfhsekjq-auth-token',"+json.dumps(value)+");")
    page=context.new_page();page.set_default_timeout(12000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(SITE+'/terrain.html?field='+FIELD,wait_until='networkidle')
    return context,page,state,errors

def click_map(page,dx,dy):
    page.locator('#terrainMap').scroll_into_view_if_needed();box=page.locator('#terrainMap').bounding_box()
    x=box['x']+box['width']/2+dx;y=box['y']+box['height']/2+dy
    if page.evaluate('()=>navigator.maxTouchPoints>0'):page.touchscreen.tap(x,y)
    else:page.mouse.click(x,y)

def scenario(browser,mobile):
    context,page,state,errors=start(browser,mobile)
    expect(page.locator('#analyzeTerrain')).to_be_enabled()
    expect(page.locator('#boundaryState')).to_contain_text('الحدود محفوظة')
    assert page.locator('#terrainField').input_value()==FIELD
    assert page.locator('#terrainReport').is_hidden()
    page.click('#analyzeTerrain')
    expect(page.locator('#terrainReport')).to_be_visible()
    expect(page.locator('#terrainStatus')).to_contain_text('حُفظ التقرير')
    assert state['saved_report']
    assert page.locator('.terrain-metric').count()==6
    assert page.locator('.terrain-raster').count()==1
    for name in ['Slope','Flow','Low','Drains']:page.locator('#layer'+name).check()
    assert page.locator('.terrain-raster').count()==3
    assert page.locator('#terrainLegend .legend-row').count()==5
    page.locator('#layerSatellite').uncheck()
    assert page.locator('#terrainReport').inner_text().find('ليس LiDAR')>=0
    # Actual raster values must match the report, not a successful-looking zero fixture.
    expected=state['analysis']['summary'];assert expected['max_elevation_m']!=expected['min_elevation_m']
    click_map(page,0,0)
    expect(page.locator('#terrainPixel')).to_contain_text('الارتفاع')
    assert 'غير متاح' not in page.locator('#terrainPixel').inner_text().split(' · ')[0]
    page.click('#drawTerrainProfile');click_map(page,-35,20);click_map(page,35,20)
    page.click('#finishTerrainProfile')
    expect(page.locator('#profileFigure')).to_be_visible()
    assert page.locator('#terrainProfileChart svg path').count()==1
    assert page.locator('#terrainProfileTable tr').count()==100
    # Profile must remain field-bound. A line outside fails without a fabricated chart.
    page.click('#drawTerrainProfile');click_map(page,0,0);click_map(page,0,190);page.click('#finishTerrainProfile')
    expect(page.locator('#terrainProfileStatus')).to_contain_text('تعذر إنشاء المقطع')
    assert page.locator('#profileFigure').is_hidden()
    page.locator('#terrainReportTitle').scroll_into_view_if_needed()
    page.screenshot(path=str(ART/('ur-smart-terrain-'+('mobile' if mobile else 'desktop')+'-report.png')))
    # Failed provider requests hide the previous successful report and overlays.
    state['api_error']=True;page.click('#analyzeTerrain')
    expect(page.locator('#terrainStatus')).to_contain_text('تعذر جلب بيانات الارتفاع')
    assert page.locator('#terrainReport').is_hidden()
    assert page.locator('.terrain-raster').count()==0
    page.click('#terrainHistory button:has-text("عرض")')
    expect(page.locator('#terrainReport')).to_be_visible()
    # Explicit owner deletion; no automatic deletion to free a slot.
    page.on('dialog',lambda dialog:dialog.accept())
    page.click('#terrainHistory button:has-text("حذف")')
    expect(page.locator('#terrainHistory')).to_contain_text('لا توجد تقارير')
    assert state['deletes']==['eq.'+REPORT]
    # Create a new field using actual map clicks and save its boundary before analysis.
    page.click('#newTerrainField')
    page.fill('#terrainFieldName','حقل جديد مرسوم للاختبار')
    page.fill('#terrainFieldCrop','شعير')
    click_map(page,-50,-40);click_map(page,50,-40);click_map(page,50,60);click_map(page,-50,60)
    page.click('#finishTerrainDrawing')
    expect(page.locator('#saveTerrainField')).to_be_enabled()
    assert page.locator('#analyzeTerrain').is_disabled()
    page.click('#saveTerrainField')
    expect(page.locator('#terrainStatus')).to_contain_text('تم الحفظ')
    assert NEW_FIELD in state['boundaries']
    assert page.locator('#terrainField').input_value()==NEW_FIELD
    expect(page.locator('#analyzeTerrain')).to_be_enabled()
    assert not page.evaluate('()=>document.documentElement.scrollWidth>innerWidth')
    assert not errors,errors
    assert not [u for u in state['requests'] if any(h in u for h in ('generativelanguage.googleapis.com','sh.dataspace.copernicus.eu','copernicus-dem-30m'))]
    result={'viewport':'mobile' if mobile else 'desktop','real_dem_fixture':True,'saved_field':True,'new_field_draw_and_save':True,'all_layers':True,'profile_and_outside_rejection':True,'history_and_owner_delete':True,'upstream_failure_has_no_result':True,'no_horizontal_overflow':True,'page_errors':errors,'production_mutations':False}
    context.close();return result

def unauthenticated(browser):
    context,page,state,errors=start(browser,True,False)
    expect(page.locator('#loginLink')).to_be_visible()
    assert page.locator('#analyzeTerrain').is_disabled()
    assert not state['posts']
    assert page.locator('#terrainReport').is_hidden()
    context.close();return {'unauthenticated_analysis_blocked':True,'production_requests':False}

def main():
    assert FIXTURE.is_file(),'Run the real DEM source integration first; no synthetic elevation fallback is used.'
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        result=[scenario(browser,False),scenario(browser,True),unauthenticated(browser)]
        browser.close()
    (ART/'ur-smart-terrain-browser-qa.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()
