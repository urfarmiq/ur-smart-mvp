"""Iraqi monthly planting UI with actual checked data and no account/API calls.

All HTTP is intercepted and fulfilled from repository files. The time fixture
crosses the UTC month boundary to verify that the initial month follows Baghdad.
No real field, model provider, weather request, database write or login is used.
"""
from pathlib import Path
from urllib.parse import urlparse, unquote
import json
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
SITE='https://planting-calendar.test'
ARTIFACTS=Path('/workspace/artifacts')
ARTIFACTS.mkdir(parents=True,exist_ok=True)

MIME={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
      '.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
      '.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'}

def context_for(browser,mobile):
    context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 960},
                                locale='ar-IQ',is_mobile=mobile,has_touch=mobile)
    # 22:30 UTC on November 30 is December 1 in Iraq.
    context.add_init_script("""(()=>{const NativeDate=Date;const stamp=NativeDate.parse('2026-11-30T22:30:00Z');
      class CalendarTestDate extends NativeDate {constructor(...args){super(...(args.length?args:[stamp]));}static now(){return stamp;}}
      window.Date=CalendarTestDate;})();""")
    requests=[]
    def route_request(route):
        request=route.request;url=urlparse(request.url);requests.append({'url':request.url,'method':request.method})
        if url.netloc!=urlparse(SITE).netloc or request.method!='GET':
            route.abort('blockedbyclient');return
        relative=unquote(url.path).lstrip('/') or 'index.html'
        file=(ROOT/relative).resolve()
        if not file.is_relative_to(ROOT) or not file.is_file():
            route.fulfill(status=404,body='missing fixture',content_type='text/plain');return
        route.fulfill(body=file.read_bytes(),content_type=MIME.get(file.suffix,'application/octet-stream'))
    context.route('**/*',route_request)
    page=context.new_page();page.set_default_timeout(10000);errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    return context,page,requests,errors

def choose(page,**values):
    for field,value in values.items():
        if field=='cropSearch':page.locator('#cropSearch').fill(value)
        else:page.locator('#'+field).select_option(str(value))

def names(page):return page.locator('.cal-crop-name').all_text_contents()

def clear_types(page):
    choose(page,category='all',method='all',season='all',cropSearch='')

def run_scenario(browser,mobile):
    context,page,requests,errors=context_for(browser,mobile)
    page.goto(SITE+'/planting-calendar.html',wait_until='domcontentloaded')
    expect(page.locator('#filterFields')).to_be_enabled()
    assert page.url==SITE+'/planting-calendar.html'
    assert page.locator('input[type=password]').count()==0
    assert page.locator('#month').input_value()=='12','Baghdad month must advance before UTC December begins'
    expect(page.locator('#heroMonth')).to_have_text('كانون الأول')
    assert page.locator('#month option').count()==12
    assert page.locator('#province option').count()==20,'All Iraq and 19 governorates including Halabja'
    assert page.locator('#yearMonths button').count()==12
    assert page.locator('[data-crop-id="wheat"]').count()==1
    assert page.locator('[data-crop-id="barley"]').count()==1
    expect(page.locator('#resultScope')).to_contain_text('منتصفه')
    assert page.locator('.cal-crop-card').count()==len(set(page.locator('.cal-crop-card').evaluate_all('(items)=>items.map(item=>item.dataset.cropId)')))

    # Real source distinction: central zucchini spring sowing is March, northern
    # spring sowing is April. No blanket +one-month transformation is used.
    choose(page,month=3,province='baghdad',cropSearch='كوسة',method='open')
    assert page.locator('[data-crop-id="zucchini"]').count()==1
    choose(page,province='erbil')
    expect(page.locator('#emptyResults')).to_be_visible()
    page.locator('#yearMonths [data-month="4"]').click()
    assert page.locator('#month').input_value()=='4'
    assert page.locator('[data-crop-id="zucchini"]').count()==1
    expect(page.locator('[data-applicability="regional"]').first).to_contain_text('شمال العراق')

    # Source does not identify cover for Samarra turnip: do not silently label
    # that reference as open-field cultivation when filtering the page.
    clear_types(page);choose(page,month=12,province='wasit',cropSearch='لفت')
    expect(page.locator('[data-crop-id="turnip"]')).to_be_visible()
    expect(page.locator('.cal-badge-reference').first).to_contain_text('غير مخصص لهذه المحافظة')
    expect(page.locator('#cropResults')).to_contain_text('نوع التغطية غير محدد في المرجع')
    choose(page,method='open');expect(page.locator('#emptyResults')).to_be_visible()
    choose(page,method='unspecified');expect(page.locator('[data-crop-id="turnip"]')).to_be_visible()

    # Iraqi aliases, diacritics and crop-specific annual information are useful
    # without exposing or storing account/field information.
    clear_types(page);choose(page,month=7,province='all',cropSearch='ذُرّة')
    expect(page.locator('[data-crop-id="maize"]')).to_be_visible()
    expect(page.locator('#cropResults')).to_contain_text('النصف الأول من تموز')
    assert page.locator('.cal-crop-card').count()==1
    assert page.locator('#yearMonths button[data-month="7"]').get_attribute('aria-pressed')=='true'
    choose(page,category='herb');expect(page.locator('#emptyResults')).to_be_visible()
    page.click('#clearSearch')
    assert page.locator('#month').input_value()=='7'
    assert page.locator('#cropSearch').input_value()==''
    assert page.locator('.cal-crop-card').count()>0

    # Stage and cover remain separate, with named sources for each window.
    choose(page,month=1,method='nursery',province='all',cropSearch='طماطة')
    expect(page.locator('[data-crop-id="tomato"]')).to_be_visible()
    expect(page.locator('#cropResults')).to_contain_text('بذر في المشتل')
    assert page.locator('.cal-window-sources').count()>0
    page.locator('.cal-window-sources').first.locator('summary').click()
    source=page.locator('.cal-window-sources').first.locator('a').first
    assert source.get_attribute('href').startswith('https://')
    assert source.get_attribute('target')=='_blank'
    assert 'noopener' in source.get_attribute('rel')
    choose(page,method='open');expect(page.locator('#emptyResults')).to_be_visible()
    choose(page,method='all',cropSearch='<img src=x onerror="window.__calendarPwned=1">')
    expect(page.locator('#emptyResults')).to_be_visible()
    assert page.locator('#cropResults img,#cropResults script').count()==0
    assert page.evaluate('()=>window.__calendarPwned') is None

    page.click('#resetFilters')
    assert page.locator('#month').input_value()=='12'
    assert page.locator('#province').input_value()=='all'
    assert page.locator('#method').input_value()=='all'
    assert page.locator('#cropSearch').input_value()==''
    assert page.locator('.cal-crop-card').count()>0
    page.locator('#sourceDetails summary').click()
    assert page.locator('#sourceList .cal-source').count()>=4
    expect(page.locator('#reviewedAt')).to_contain_text('٢٠٢٦')
    assert page.locator('#sourceList a[href^="https://"]').count()>=4
    assert page.locator('#sourceList a[href^="https://www.fao.org/"]').count()>=1

    # The UI only reads public bundled data; it does not change URL, session or
    # local storage or contact a database, weather service or model.
    assert page.url==SITE+'/planting-calendar.html'
    assert page.evaluate('()=>localStorage.length')==0
    assert page.evaluate('()=>sessionStorage.length')==0
    assert all(urlparse(item['url']).netloc==urlparse(SITE).netloc and item['method']=='GET' for item in requests),requests
    overflow=page.evaluate('()=>document.documentElement.scrollWidth>innerWidth')
    assert not overflow,'Calendar must fit the viewport'
    assert not errors,errors
    page.locator('h1').scroll_into_view_if_needed()
    page.screenshot(path=str(ARTIFACTS/('ur-smart-planting-calendar-'+('mobile' if mobile else 'desktop')+'-hero-test.png')))
    choose(page,month=3,province='baghdad',method='all',cropSearch='')
    page.locator('#resultsTitle').scroll_into_view_if_needed()
    page.screenshot(path=str(ARTIFACTS/('ur-smart-planting-calendar-'+('mobile' if mobile else 'desktop')+'-results-test.png')))
    result={'viewport':'mobile' if mobile else 'desktop','baghdad_month_boundary':True,'province_and_methods':True,'stages_and_sources':True,'unknown_cover_preserved':True,'empty_search_and_reset':True,'safe_text':True,'no_account_api_or_storage':True,'horizontal_overflow':False,'javascript_errors':errors}
    context.close();return result

def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        output=[run_scenario(browser,mobile) for mobile in (False,True)]
        browser.close()
    (ARTIFACTS/'ur-smart-planting-calendar-browser-qa.json').write_text(json.dumps(output,ensure_ascii=False,indent=2))
    for item in output:print(item['viewport']+': current Baghdad month, real seasonal/regional windows, crop aliases, stages/cover, annual navigation, public sources, empty/reset/safe text/no account or API calls passed; source-file fixtures only.')

if __name__=='__main__':main()
