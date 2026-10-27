"""Core management acceptance with synthetic Supabase and browser-local data only.
Requires Python Playwright and /usr/bin/chromium. Every request is intercepted;
this never signs in, reads, or changes production data.
"""
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
MOCK = r"""
window.__fixture={failMutation:false,fields:[{id:'field-one',farm_id:'farm-one',name:'حقل اختبار',crop:'حنطة',area_donum:4,soil:'طينية',irrigation:'الري بالتنقيط',location:'موقع اختباري'}],calls:[]};
function createClient(){return {
 auth:{getSession:async()=>({data:{session:{access_token:'synthetic-only',user:{id:'test-user',email:'fixture@example.test'}}},error:null}),getUser:async()=>({data:{user:{id:'test-user'}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},
 from(table){let action='select',payload,single=false,filters=[];const q={};
 q.select=()=>q;q.eq=(key,value)=>{filters.push([key,value]);return q;};q.order=q.limit=()=>q;q.single=()=>{single=true;return q;};
 for(const name of ['insert','update','delete'])q[name]=value=>{action=name;payload=value;return q;};
 q.then=(ok,fail)=>Promise.resolve().then(()=>{
  const s=window.__fixture;s.calls.push({table,action,payload,filters});
  if(table==='farms')return {data:[{id:'farm-one',name:'مزرعة اختبار'}],error:null};
  if(table==='fields'){
   if(action!=='select'&&s.failMutation)return {data:null,error:{message:'fixture no matching row'}};
   const matches=row=>filters.every(([key,value])=>key.includes('.')||row[key]===value);
   let rows=s.fields.filter(matches);
   if(action==='insert'){const row={...payload,id:'field-added'};s.fields.push(row);rows=[row];}
   if(action==='update')rows.forEach(row=>Object.assign(row,payload));
   if(action==='delete')s.fields=s.fields.filter(row=>!rows.includes(row));
   return {data:single?(rows[0]||null):rows,error:single&&!rows.length?{message:'fixture no matching row'}:null};
  }
  if(table==='sensor_readings')return {data:[{soil_moisture:24,air_temperature:31,irrigation_state:'off',is_simulated:false,recorded_at:'2026-10-25T10:00:00Z'},{soil_moisture:28,air_temperature:30,irrigation_state:'unknown',is_simulated:true,recorded_at:'2026-10-25T09:00:00Z'}],error:null};
  if(table==='field_irrigation_logs')return {data:[{irrigated_at:'2026-10-25T08:00:00Z',water_depth_mm:null,duration_minutes:20,method:'تنقيط',notes:'سجل اختباري'}],error:null};
  return {data:[],error:null};
 }).then(ok,fail);return q;}
};}
export {createClient};
"""

def route_request(route):
    url = urlparse(route.request.url)
    if url.path.endswith('/supabase-client.mjs'):
        route.fulfill(body=MOCK, content_type='text/javascript')
        return
    if url.hostname == 'ur-smart.test':
        path = ROOT / url.path.lstrip('/')
        if path.is_file():
            content_type = {'.mjs':'text/javascript', '.js':'text/javascript', '.css':'text/css'}.get(path.suffix, 'text/html')
            route.fulfill(body=path.read_bytes(), content_type=content_type)
            return
    if '@supabase/supabase-js' in url.path:
        route.fulfill(body=MOCK, content_type='text/javascript')
        return
    route.abort()

def wait_text(page, selector, text):
    page.wait_for_function('([selector,text])=>document.querySelector(selector).textContent.includes(text)', arg=[selector,text])

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    for mobile in (False, True):
        context = browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 900}, is_mobile=mobile, has_touch=mobile)
        context.route('**/*', route_request)
        # A malformed legacy value must not stop cloud account initialization.
        context.add_init_script("localStorage.setItem('ur-smart-fields',JSON.stringify('invalid legacy value'))")
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda dialog: dialog.accept())
        page.goto('https://ur-smart.test/dashboard.html')
        wait_text(page, '#cloudFields', 'حقل اختبار')
        assert 'تعذر قراءة' in page.locator('#localFields').inner_text()
        assert page.evaluate("localStorage.getItem('ur-smart-fields')") == '"invalid legacy value"'
        page.fill('#fieldName', 'حقل جديد')
        page.fill('#area', '6.5')
        page.locator('input.crop-choice[value="طماطم"]').check()
        page.click('#saveButton')
        wait_text(page, '#cloudFields', 'حقل جديد')
        assert page.locator('#cloudFields .field').count() == 2
        added = page.locator('#cloudFields .field').filter(has_text='حقل جديد')
        added.get_by_role('button', name='تعديل', exact=True).click()
        page.fill('#area', '7')
        page.click('#saveButton')
        page.wait_for_function("document.querySelector('#cloudFields').textContent.includes('حقل جديد — 7 دونم')")
        # A rejected update must retain the saved row and report failure.
        page.evaluate('window.__fixture.failMutation=true')
        added.get_by_role('button', name='تعديل', exact=True).click()
        page.fill('#fieldName', 'تعديل مرفوض')
        page.click('#saveButton')
        wait_text(page, '#status', 'لم يتم حفظ الحقل')
        assert 'تعديل مرفوض' not in page.locator('#cloudFields').inner_text()
        page.evaluate('window.__fixture.failMutation=false')
        page.click('#cancelEdit')
        added.get_by_role('button', name='حذف', exact=True).click()
        page.wait_for_function("document.querySelectorAll('#cloudFields .field').length===1")
        assert 'حقل جديد' not in page.locator('#cloudFields').inner_text()
        # A rejected delete must not claim success or remove the visible row.
        page.evaluate('window.__fixture.failMutation=true')
        page.locator('#cloudFields .field').get_by_role('button', name='حذف', exact=True).click()
        wait_text(page, '#status', 'تعذر حذف الحقل')
        assert page.locator('#cloudFields .field').count() == 1
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')

        page.goto('https://ur-smart.test/operations.html')
        page.wait_for_function("document.querySelector('#field').options.length>1")
        page.select_option('#field', 'field-one')
        wait_text(page, '#readings', 'قراءة جهاز مسجلة')
        assert 'قراءة افتراضية' in page.locator('#readings').inner_text()
        assert 'غير مسجل' in page.locator('#irrigation').inner_text()
        page.select_option('#type', 'تسميد')
        page.fill('#notes', 'عملية اختبارية محلية دون تنفيذ ميداني')
        page.click('#save')
        wait_text(page, '#operations', 'عملية اختبارية')
        assert 'محليًا' in page.locator('#status').inner_text()
        saved = page.evaluate("JSON.parse(localStorage.getItem('ur-smart-operations-v1:test-user:field-one'))")
        assert saved['field_id'] == 'field-one' and len(saved['operations']) == 1
        before = page.evaluate('window.__fixture.calls.length')
        page.click('#simulate')
        assert 'محاكاة تعليمية' in page.locator('#simulation').inner_text()
        assert 'لم تُحفظ في Supabase ولا تتحكم في جهاز' in page.locator('#simulation').inner_text()
        assert page.evaluate('window.__fixture.calls.length') == before
        assert page.evaluate("window.__fixture.calls.every(call=>call.action==='select')")
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert not errors, errors
        print(('Mobile' if mobile else 'Desktop') + ': dashboard add/edit/delete and rejected mutations pass; malformed legacy data is preserved; operations save locally and virtual sensors perform no cloud writes.')
        context.close()
    browser.close()
