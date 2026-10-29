"""Research workbench acceptance with synthetic account/payment/API data.
All network traffic is intercepted. No production account, payment or API is used.
"""
from pathlib import Path
from urllib.parse import urlparse
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
ORDER = '11111111-1111-4111-8111-111111111111'
FIELD = '22222222-2222-4222-8222-222222222222'
STATE = {'mode': 'ready'}
MOCK = r'''
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',order='11111111-1111-4111-8111-111111111111',field='22222222-2222-4222-8222-222222222222';
const now='2026-10-29T09:00:00Z';
const result={schema_version:1,created_at:now,task_type:'combined',summary:'<img src=x onerror=window.__xss=true> مسودة تفسيرية',methodology:['حساب فعلي للاختبار'],interpretation:['المتوسطات تختلف وصفياً'],limitations:['تحتاج مراجعة الباحث'],next_steps:['التحقق من تصميم التجربة'],analysis:{schema_version:1,method:'oneway',rows_total:4,rows_used:4,rows_excluded:0,columns:{value:'yield',group:'treatment',predictor:null},descriptive:{n:4,mean:4,median:4,sd:2.581988897471611,min:1,max:7},groups:[{label:'=1+1',n:2,mean:2,sd:1.4142135623730951},{label:'B',n:2,mean:6,sd:1.4142135623730951}],anova:{f:8,p:0.10557280900008413,df_between:1,df_within:2,ss_between:16,ss_within:4,assumptions:['قياسات مستقلة']},warnings:[]},maps:{field_id:field,source:'Sentinel-2 L2A',date:'2026-10-20',indices:{NDVI:0.65},valid_pixels:180,geometry_pixels:200,coverage_percent:90,resolution_m:10,geometry:{type:'Polygon',coordinates:[[[44,33],[44.01,33],[44.01,33.01],[44,33.01],[44,33]]]}},references:[{title:'Verified metadata',doi:'10.1234/test.2026',url:'https://evil.example.test/fake',year:2026,authors:['Author Test']},{title:'Unsafe reference',url:'javascript:alert(1)'},{title:'Arbitrary website',url:'https://evil.example.test/'}],provider:{name:'Google Gemini',model:'fixture-only'},notes:[]};
window.__fixture={mode:FIXTURE_MODE,signedIn:FIXTURE_MODE!=='anon',owner,calls:[],listeners:[],holdExecution:false,releaseExecution:null,report:result,orders:[{id:order,owner_id:owner,topic:'دراسة مقارنة إنتاجية القمح',task_type:'combined',fee_iqd:25000,status:'waiting_payment',approved_at:null,attempt_count:0,payment_reference:null,created_at:now,updated_at:now,result:null},{id:'foreign-order',owner_id:'foreign',topic:'FOREIGN_PRIVATE_ORDER',fee_iqd:25000,status:'approved'}]};
const s=window.__fixture,user=()=>({id:s.owner,email:'fixture@example.test'});
function createClient(){return {
 auth:{getUser:async()=>({data:{user:s.signedIn?user():null},error:null}),getSession:async()=>({data:{session:s.signedIn?{access_token:'synthetic-private-token',user:user()}:null},error:null}),onAuthStateChange(cb){s.listeners.push(cb);return {data:{subscription:{unsubscribe(){}}}};},async signOut(){s.signedIn=false;for(const cb of s.listeners)cb('SIGNED_OUT',null);return {error:null};}},
 async rpc(name,input){s.calls.push({rpc:name,input});if(name!=='create_research_order')throw Error('Unexpected RPC');if(Object.keys(input).sort().join(',')!=='p_payment_reference,p_task_type,p_topic')throw Error('Unexpected create order payload');const row={id:'33333333-3333-4333-8333-333333333333',owner_id:s.owner,topic:input.p_topic,task_type:input.p_task_type,fee_iqd:25000,status:'waiting_payment',approved_at:null,attempt_count:0,payment_reference:input.p_payment_reference,created_at:now,updated_at:now,result:null};s.orders.unshift(row);return {data:{id:row.id,status:row.status,fee_iqd:25000},error:null};},
 from(table){let columns='',filters=[];const q={};q.select=value=>{columns=value;return q;};q.eq=(key,value)=>{filters.push([key,value]);return q;};q.order=q.limit=()=>q;q.then=(ok,fail)=>Promise.resolve().then(()=>{s.calls.push({table,columns,filters});if(!s.signedIn)throw Error('Read before account auth');if(table==='research_orders')return {data:s.orders.map(row=>({...row})),error:null};if(table==='fields')return {data:[{id:field,name:'حقل الباحث',farms:{owner_id:s.owner}},{id:'foreign-field',name:'FOREIGN_PRIVATE_FIELD',farms:{owner_id:'foreign'}}],error:null};throw Error('Unexpected table');}).then(ok,fail);return q;}
};}
const originalFetch=window.fetch.bind(window);
window.fetch=async(resource,options={})=>{const url=new URL(typeof resource==='string'?resource:resource.url);if(url.hostname!=='ur-smart-satellite.alialbatekh111.workers.dev')return originalFetch(resource,options);const body=options.body?JSON.parse(options.body):null;s.calls.push({api:url.pathname,body,headers:options.headers});if(url.pathname==='/research/status')return new Response(JSON.stringify({available:true,free_tier_confirmed:true}),{status:200});if(url.pathname==='/research'){if(options.headers.Authorization!=='Bearer synthetic-private-token')throw Error('Missing authenticated request');const row=s.orders.find(row=>row.id===body.order_id);if(!row||!row.approved_at||row.status!=='approved')return new Response(JSON.stringify({message:'Payment not approved'}),{status:403});if(!body.consent)throw Error('Missing consent');if(s.holdExecution)await new Promise(resolve=>s.releaseExecution=resolve);row.status='completed';row.result=s.report;row.attempt_count++;return new Response(JSON.stringify({order_id:row.id,status:'completed',result:s.report}),{status:200});}if(url.pathname==='/'){if(body.action!=='imagery'||body.field_id!==field||body.map_date!=='2026-10-20'||body.map_index!=='NDVI')throw Error('Wrong imagery request');return new Response(JSON.stringify({image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',source:'Sentinel-2 L2A',resolution_m:10}),{status:200});}throw Error('Unexpected API route');};
export {createClient};
'''


def route_request(route):
    url = urlparse(route.request.url)
    if url.hostname == 'ur-smart.test':
        if url.path == '/supabase-client.mjs':
            route.fulfill(body=MOCK.replace('FIXTURE_MODE', json.dumps(STATE['mode'])), content_type='text/javascript')
            return
        path = ROOT / url.path.lstrip('/')
        if path.is_file():
            route.fulfill(body=path.read_bytes(), content_type={'.mjs':'text/javascript','.css':'text/css'}.get(path.suffix,'text/html'))
            return
    route.abort()


def wait_text(page, selector, text):
    page.wait_for_function('([selector,text])=>document.querySelector(selector).textContent.includes(text)', arg=[selector,text])


def select_order(page, order=ORDER):
    page.locator('[data-order-id="'+order+'"]').click()
    page.wait_for_selector('#executionPanel:not([hidden])')


def prepare(page):
    select_order(page)
    page.evaluate("Object.assign(window.__fixture.orders.find(row=>row.id===window.__fixture.report.maps.field_id.replace('22222222','11111111').replace('4222','4111').replace('8222','8111').replace(/2/g,'1'))||window.__fixture.orders[0],{})") if False else None
    page.evaluate("Object.assign(window.__fixture.orders.find(row=>row.id==='11111111-1111-4111-8111-111111111111'),{status:'approved',approved_at:'2026-10-29T09:30:00Z'})")
    page.locator('#refreshOrders').click()
    wait_text(page, '#approvalNotice', 'متاح للتنفيذ')
    page.locator('#csvFile').set_input_files({'name':'experiment.csv','mimeType':'text/csv','buffer':b'treatment,yield,x\n=1+1,1,1\n=1+1,3,2\nB,5,3\nB,7,4\n'})
    wait_text(page, '#fileStatus', 'لم يُرفع الملف')
    page.locator('#valueColumn').select_option('yield')
    page.locator('#method').select_option('oneway')
    page.locator('#groupColumn').select_option('treatment')
    page.locator('#researchField').select_option(FIELD)
    page.locator('#bibliographyQuery').fill('wheat irrigation')
    page.locator('#researchConsent').check()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    STATE['mode'] = 'anon'
    context = browser.new_context()
    context.route('**/*', route_request)
    page = context.new_page()
    page.goto('https://ur-smart.test/research-lab.html')
    wait_text(page, '#accountStatus', 'سجّل الدخول')
    assert page.locator('#labContent').is_hidden()
    assert page.evaluate('window.__fixture.calls.length') == 0
    context.close()

    for mobile in (False, True):
        STATE['mode'] = 'ready'
        context = browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 900}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
        context.route('**/*', route_request)
        page = context.new_page()
        page.set_default_timeout(10000)
        errors=[]
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto('https://ur-smart.test/research-lab.html')
        page.wait_for_selector('#labContent:not([hidden])')
        page.wait_for_function("document.querySelectorAll('#ordersList article').length===1")
        assert 'FOREIGN_PRIVATE_ORDER' not in page.locator('body').inner_text()
        assert 'FOREIGN_PRIVATE_FIELD' not in page.locator('#researchField').inner_text()
        for call in page.evaluate("window.__fixture.calls.filter(row=>row.table==='research_orders')"):
            assert ['owner_id',OWNER] in call['filters']
            assert 'run_token' not in call['columns'] and 'approved_by' not in call['columns']
        field_call=page.evaluate("window.__fixture.calls.find(row=>row.table==='fields')")
        assert ['farms.owner_id',OWNER] in field_call['filters']
        select_order(page)
        assert page.locator('#runResearch').is_disabled()
        assert 'بانتظار تأكيد الدفع' in page.locator('#approvalNotice').inner_text()
        assert page.evaluate("window.__fixture.calls.filter(row=>row.api==='/research').length") == 0
        page.locator('#topic').fill('دراسة اختبار إنشاء طلب بحث جديد')
        page.locator('#taskType').select_option('data')
        page.locator('#paymentReference').fill('FIXTURE-25000')
        page.locator('#createOrder').click()
        wait_text(page, '#createStatus', 'أُنشئ الطلب')
        assert page.locator('#runResearch').is_disabled()
        request=page.evaluate("window.__fixture.calls.find(row=>row.rpc==='create_research_order').input")
        assert request == {'p_topic':'دراسة اختبار إنشاء طلب بحث جديد','p_task_type':'data','p_payment_reference':'FIXTURE-25000'}
        prepare(page)
        page.locator('#previewData').click()
        page.wait_for_selector('#localPreview:not([hidden]) svg')
        assert 'إجمالي الصفوف' in page.locator('#localPreview').inner_text()
        assert page.evaluate("window.__fixture.calls.filter(row=>row.api==='/research').length") == 0
        # A previously selected hidden group column must not affect regression.
        page.locator('#method').select_option('regression')
        page.locator('#predictorColumn').select_option('x')
        page.locator('#previewData').click()
        assert page.locator('#localPreview svg circle').count() == 4
        page.locator('#method').select_option('oneway')
        page.locator('#previewData').click()
        page.locator('#runResearch').click()
        wait_text(page, '#runStatus', 'انتهى التنفيذ')
        page.wait_for_selector('#reportPanel:not([hidden])')
        assert page.locator('#reportContent img').count() == 0 and page.evaluate('window.__xss') is None
        assert '<img src=x' in page.locator('#reportContent').inner_text()
        assert page.locator('#reportContent a').count() == 1
        assert page.locator('#reportContent a').get_attribute('href') == 'https://doi.org/10.1234/test.2026'
        assert page.locator('#runResearch').is_disabled()
        request=page.evaluate("window.__fixture.calls.find(row=>row.api==='/research')")
        assert request['body']['csv'].startswith('treatment,yield,x')
        assert request['body']['consent'] is True and request['body']['field_id'] == FIELD
        assert request['body']['order_id'] == ORDER and request['body']['group_column'] == 'treatment'
        assert 'fee_iqd' not in request['body'] and 'approved_at' not in request['body']
        assert request['headers']['Authorization'] == 'Bearer synthetic-private-token'
        assert page.locator('#reportContent svg.chart').count() == 1
        with page.expect_download() as download_info:
            page.locator('#downloadCsv').click()
        csv=Path(download_info.value.path()).read_text(encoding='utf-8-sig')
        assert '"\'=1+1"' in csv
        with page.expect_download() as download_info:
            page.locator('#downloadChart').click()
        svg=Path(download_info.value.path()).read_text()
        assert '<svg' in svg and '=1+1' in svg
        page.locator('#fetchMapImage').click()
        page.wait_for_selector('#mapFigure:not([hidden])')
        assert page.locator('#mapImage').get_attribute('src').startswith('data:image/png;base64,')
        image_request=page.evaluate("window.__fixture.calls.find(row=>row.api==='/')")
        assert image_request['body'] == {'action':'imagery','field_id':FIELD,'map_date':'2026-10-20','map_index':'NDVI'}
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        # Session changes clear reports, raw files and all private form state.
        page.evaluate("window.__fixture.owner='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';for(const cb of window.__fixture.listeners)cb('SIGNED_IN',{user:{id:window.__fixture.owner}})")
        assert page.locator('#labContent').is_hidden() and page.locator('#reportPanel').is_hidden()
        assert page.locator('#csvFile').input_value() == '' and page.locator('#localPreview').inner_text() == ''
        assert page.locator('#reportContent').inner_text() == '' and page.locator('#mapImage').get_attribute('src') is None
        assert page.locator('#bibliographyQuery').input_value() == '' and not page.locator('#researchConsent').is_checked()
        assert page.evaluate('localStorage.length===0&&sessionStorage.length===0')
        assert not errors, errors
        context.close()
    browser.close()
print('Research lab: anonymous gate, fixed-price order, payment gate, CSV preview/ANOVA/regression, safe report/DOI/CSV/SVG, actual imagery, account cleanup and mobile layout passed.')
