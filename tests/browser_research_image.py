"""Research imagery acceptance using real encoded pixels and intercepted APIs only.
No production account, field, payment, Gemini or Sentinel service is used.
"""
from pathlib import Path
from urllib.parse import urlparse
import base64
import json
import re
import struct
import zlib

from playwright.sync_api import sync_playwright
import browser_research_lab as lab

WIDTH, HEIGHT = 32, 24


def encoded_png(transparent=False, colored=False):
    """A tiny native-resolution NDVI raster: three values plus true nodata."""
    rows = []
    for y in range(HEIGHT):
        row = bytearray([0])  # PNG scanline filter None.
        for x in range(WIDTH):
            inside = ((x - 15.5) / 13) ** 2 + ((y - 11.5) / 10) ** 2 <= 1
            q = 51 if x < 12 else 153 if x < 21 else 230
            alpha = 255 if inside and (x, y) != (16, 12) and not transparent else 0
            row.extend((q, 90 if colored else q, 180 if colored else q, alpha))
        rows.append(bytes(row))

    def chunk(kind, value):
        return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value) & 0xffffffff)

    header = struct.pack('>IIBBBBB', WIDTH, HEIGHT, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')


PNG = 'data:image/png;base64,' + base64.b64encode(encoded_png()).decode()
IMAGE = {
    'image': PNG, 'field_id': lab.FIELD, 'index': 'NDVI', 'date': '2026-10-20',
    'source': 'Sentinel-2 L2A per-pixel NDVI raster via Copernicus Data Space',
    'resolution_m': 10, 'native_resolution_m': 10, 'width': WIDTH, 'height': HEIGHT,
    'image_width': WIDTH, 'image_height': HEIGHT, 'bounds': [[33, 44], [33.01, 44.01]],
    'display_range': [-0.2, 0.8], 'encoding': 'uint8-grayscale-clamped',
    'resolution_x_m': 9.3, 'resolution_y_m': 10, 'pixel_size_is_approximate': True,
}

OVERRIDE = r'''
const fixtureFetch=window.fetch;
window.fetch=async(resource,options={})=>{
 const url=new URL(typeof resource==='string'?resource:resource.url);
 if(url.hostname!=='ur-smart-satellite.alialbatekh111.workers.dev'||url.pathname!=='/')return fixtureFetch(resource,options);
 const s=window.__fixture,body=JSON.parse(options.body||'{}');s.calls.push({api:'/',body,headers:options.headers});
 if(body.action!=='imagery'||body.field_id!=='22222222-2222-4222-8222-222222222222'||body.map_index!=='NDVI')throw Error('Unexpected imagery request');
 if(s.holdImage)await new Promise(resolve=>s.releaseImage=resolve);
 if(s.imageMode==='http-error')return new Response(JSON.stringify({message:'Fixture image temporarily unavailable'}),{status:503});
 const result=IMAGE_PAYLOAD;
 if(s.imageMode==='invalid')result.image='data:image/png;base64,YmFk';
 if(s.imageMode==='wrong-range')result.display_range=[-1,1];
 if(s.imageMode==='wrong-index')result.index='NDMI';
 if(s.imageMode==='wrong-size')result.width=33;
 if(s.imageMode==='wrong-encoding')result.encoding='rgb';
 if(s.imageMode==='wrong-field')result.field_id='33333333-3333-4333-8333-333333333333';
 if(s.imageMode==='wrong-date')result.date='2026-10-21';
 if(s.imageMode==='colored')result.image=COLORED_PNG;
 if(s.imageMode==='nodata')result.image=NODATA_PNG;
 return new Response(JSON.stringify(result),{status:200});
};
'''.replace('IMAGE_PAYLOAD', json.dumps(IMAGE)).replace('COLORED_PNG',json.dumps('data:image/png;base64,'+base64.b64encode(encoded_png(colored=True)).decode())).replace('NODATA_PNG',json.dumps('data:image/png;base64,'+base64.b64encode(encoded_png(transparent=True)).decode()))


def route_request(route):
    url = urlparse(route.request.url)
    if url.hostname == 'ur-smart.test' and url.path == '/supabase-client.mjs':
        mock = lab.MOCK.replace('FIXTURE_MODE', '"ready"').replace('export {createClient};', OVERRIDE + '\nexport {createClient};')
        route.fulfill(body=mock, content_type='text/javascript')
    else:
        lab.route_request(route)


def open_report(browser, mobile):
    context = browser.new_context(
        viewport={'width': 390 if mobile else 1440, 'height': 844 if mobile else 1000},
        is_mobile=mobile, has_touch=mobile, accept_downloads=True,
    )
    context.route('**/*', route_request)
    page = context.new_page()
    page.set_default_timeout(10000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('https://ur-smart.test/research-lab.html')
    page.wait_for_selector('#labContent:not([hidden])')
    page.evaluate("Object.assign(window.__fixture.orders[0],{status:'completed',approved_at:'2026-10-29T09:30:00Z',result:window.__fixture.report})")
    page.locator('#refreshOrders').click()
    lab.select_order(page)
    page.wait_for_selector('#mapImagePanel:not([hidden])')
    return context, page, errors


def load_image(page):
    page.locator('#fetchMapImage').click()
    page.wait_for_selector('#mapFigure:not([hidden])')
    page.wait_for_function('document.querySelector("#mapImage").complete && document.querySelector("#mapImage").naturalWidth===32')
    page.locator('#mapFigure').scroll_into_view_if_needed()


def probe(page, x, y, mobile):
    box = page.locator('#mapImage').bounding_box()
    px, py = box['x'] + (x + 0.5) / WIDTH * box['width'], box['y'] + (y + 0.5) / HEIGHT * box['height']
    if mobile:
        page.touchscreen.tap(px, py)
    else:
        page.mouse.move(px, py)
    return page.locator('#mapPixelValue').inner_text()


def normalized(value):
    return value.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩٫−', '0123456789.-'))


def assert_value(page, x, y, expected, mobile):
    value = normalized(probe(page, x, y, mobile))
    match = re.search(r'NDVI[^\d+\-]*([+\-]?\d+(?:\.\d+)?)', value)
    assert match, (mobile, value)
    assert abs(float(match.group(1)) - expected) <= 0.005, value
    assert page.locator('#mapPixelValue').get_attribute('data-probe-state') == 'value'


def png_samples(page, uri):
    return page.evaluate('''async uri=>{
     const image=new Image();image.src=uri;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
     const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const at=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);
     return {width:canvas.width,height:canvas.height,low:at(8,12),middle:at(16,8),high:at(25,12),nodata:at(16,12),outside:at(0,0)};
    }''', uri)


def touch_gesture(context, page, *, pinch=False):
    """Dispatch real browser touch input, rather than JS-created pointer events."""
    area=page.locator('#mapViewport').bounding_box()
    x,y=area['x']+area['width']/2,area['y']+area['height']/2
    session=context.new_cdp_session(page)
    def point(pid,px,py):
        return {'id':pid,'x':px,'y':py,'radiusX':2,'radiusY':2,'force':1}
    try:
        points=[point(1,x-25,y),point(2,x+25,y)] if pinch else [point(1,x,y)]
        session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':points})
        for step in range(1,6):
            points=[point(1,x-25-step*7,y),point(2,x+25+step*7,y)] if pinch else [point(1,x-step*13,y)]
            session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':points})
        session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    finally:
        session.detach()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        for mobile in (False, True):
            context, page, errors = open_report(browser, mobile)
            load_image(page)
            viewport = page.locator('#mapViewport').bounding_box()
            image = page.locator('#mapImage').bounding_box()
            assert image['width'] >= (280 if mobile else 600), (mobile, viewport, image)
            assert image['height'] >= 200 and image['width'] <= viewport['width'] + 2, (viewport, image)
            assert '32' in normalized(page.locator('#mapNativeDetails').inner_text())
            assert page.locator('#mapLegend').is_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
            assert_value(page, 8, 12, 0.0, mobile)
            assert_value(page, 16, 8, 0.4, mobile)
            assert_value(page, 25, 12, 230 / 255 - 0.2, mobile)
            probe(page, 16, 12, mobile)
            assert page.locator('#mapPixelValue').get_attribute('data-probe-state') == 'nodata'
            initial = page.locator('#mapImage').bounding_box()
            if mobile:
                touch_gesture(context,page,pinch=True)
                assert float(page.locator('#mapViewport').get_attribute('data-zoom'))>1.5
                page.locator('#mapFit').click()
                assert abs(page.locator('#mapImage').bounding_box()['width']-initial['width'])<3
            page.locator('#mapZoomIn').click()
            zoomed = page.locator('#mapImage').bounding_box()
            assert zoomed['width'] > initial['width'] * 1.15, (initial, zoomed)
            assert page.locator('#mapImage').evaluate('(image)=>image.naturalWidth') == WIDTH
            # Zoom far enough to overflow both axes, then pan without moving the document.
            page.locator('#mapZoomIn').click()
            zoomed = page.locator('#mapImage').bounding_box()
            area = page.locator('#mapViewport').bounding_box()
            if mobile:
                touch_gesture(context,page)
            else:
                page.mouse.move(area['x'] + area['width'] / 2, area['y'] + area['height'] / 2)
                page.mouse.down(); page.mouse.move(area['x'] + area['width'] / 2 - 65, area['y'] + area['height'] / 2, steps=5); page.mouse.up()
            panned = page.locator('#mapImage').bounding_box()
            assert abs(panned['x'] - zoomed['x']) > 10, (zoomed, panned)
            page.locator('#mapFit').click()
            fitted = page.locator('#mapImage').bounding_box()
            assert abs(fitted['width'] - initial['width']) < 3
            page.locator('#mapExpand').click()
            page.wait_for_selector('#mapFigure[data-expanded="true"]')
            assert page.locator('#mapFigure').get_attribute('role') == 'dialog'
            assert page.locator('#mapFigure').get_attribute('aria-modal') == 'true'
            assert page.locator('#mapCloseExpanded').is_visible()
            # Keyboard focus wraps inside the CSS dialog on both viewport sizes.
            page.locator('#mapViewport').focus();page.keyboard.press('Tab')
            assert page.evaluate('document.activeElement.id')=='mapZoomIn'
            page.keyboard.press('Shift+Tab')
            assert page.evaluate('document.activeElement.id')=='mapViewport'
            page.keyboard.press('Escape')
            page.wait_for_function('document.querySelector("#mapFigure").dataset.expanded!=="true"')
            assert page.evaluate('document.activeElement.id') == 'mapExpand'
            page.locator('#mapExpand').click()
            page.locator('#mapCloseExpanded').click()
            page.wait_for_function('document.querySelector("#mapFigure").dataset.expanded!=="true"')
            page.locator('#mapFit').click()
            screenshot = '/tmp/ur-image-after-mobile.png' if mobile else '/tmp/ur-image-after-desktop.png'
            page.locator('#mapFigure').screenshot(path=screenshot)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
            with page.expect_download() as download_info:
                page.locator('#downloadImage').click()
            downloaded = Path(download_info.value.path()).read_bytes()
            samples = png_samples(page, 'data:image/png;base64,' + base64.b64encode(downloaded).decode())
            assert (samples['width'], samples['height']) == (WIDTH, HEIGHT)
            assert samples['nodata'][3] == 0 and samples['outside'][3] == 0
            assert samples['low'][3] == 255 and len(set(samples['middle'][:3])) > 1, samples
            # A changed report clears stale images and an expanded private viewer.
            page.locator('#mapExpand').click()
            page.evaluate("window.__fixture.orders[0].result={...window.__fixture.report,summary:'Changed report'};document.querySelector('#refreshOrders').click()")
            page.wait_for_function('document.querySelector("#mapImage").getAttribute("src")===null')
            assert page.locator('#mapFigure').is_hidden()
            assert page.locator('#mapFigure').get_attribute('data-expanded') != 'true'
            # Failures are visible and cannot leave an image/export that pretends to be new data.
            for mode in ('http-error','invalid','wrong-range','wrong-index','wrong-size','wrong-encoding','wrong-field','wrong-date','colored','nodata'):
                page.evaluate('(mode)=>window.__fixture.imageMode=mode', mode)
                page.locator('#fetchMapImage').click()
                lab.wait_text(page, '#mapImageStatus', 'تعذر')
                assert page.locator('#mapFigure').is_hidden()
                assert page.locator('#downloadImage').is_hidden()
                assert page.locator('#fetchMapImage').is_enabled()
            page.evaluate("window.__fixture.imageMode='ready'")
            load_image(page)
            page.locator('#mapExpand').click()
            page.evaluate("window.__fixture.owner='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';for(const cb of window.__fixture.listeners)cb('SIGNED_IN',{user:{id:window.__fixture.owner}})")
            assert page.locator('#labContent').is_hidden() and page.locator('#mapFigure').is_hidden()
            assert page.locator('#mapImage').get_attribute('src') is None
            assert page.locator('#mapFigure').get_attribute('data-expanded') != 'true'
            assert not errors, errors
            context.close()

        # An image response arriving after account loss cannot reopen the viewer.
        context, page, errors = open_report(browser, False)
        page.evaluate('window.__fixture.holdImage=true')
        page.locator('#fetchMapImage').click()
        page.wait_for_function('typeof window.__fixture.releaseImage==="function"')
        page.evaluate("window.__fixture.owner='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';for(const cb of window.__fixture.listeners)cb('SIGNED_IN',{user:{id:window.__fixture.owner}});window.__fixture.releaseImage()")
        page.wait_for_timeout(150)
        assert page.locator('#labContent').is_hidden() and page.locator('#mapFigure').is_hidden()
        assert page.locator('#mapImage').get_attribute('src') is None
        assert not errors, errors
        context.close()
        browser.close()
    print('Research imagery: native32x24 raster enlarged on phone/desktop, true-pixel NDVI/tap/nodata, real touch pinch/pan, zoom/fit/expanded/Escape/focustrap, transparent color PNG export, HTTP/decode/metadata/RGB/nodata failures, changed-report and stale-account cleanup passed; all APIs intercepted.')


if __name__ == '__main__':
    main()
