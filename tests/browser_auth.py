"""Authentication/CSP smoke check using synthetic SDK responses; no real signup/email."""
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
SDK="""window.fixtureCalls=[];export function createClient(){return {auth:{
getSession:async()=>({data:{session:null},error:null}),
signInWithPassword:async()=>{window.fixtureCalls.push('login');return {data:{},error:{message:'private provider detail'}};},
signUp:async()=>{window.fixtureCalls.push('signup');return {data:{session:null},error:null};},
signOut:async()=>({error:null})}};}"""
def route_request(route):
    url=urlparse(route.request.url)
    if url.hostname=='auth.test':
        path=ROOT/url.path.lstrip('/')
        if path.is_file():
            route.fulfill(body=path.read_bytes(),content_type='text/javascript' if path.suffix=='.mjs' else 'text/html');return
    if '@supabase/supabase-js' in url.path:
        route.fulfill(body=SDK,content_type='text/javascript');return
    route.abort()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for mobile in (False,True):
        context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 900},is_mobile=mobile,has_touch=mobile)
        context.route('**/*',route_request);page=context.new_page();errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto('https://auth.test/auth.html')
        page.wait_for_function("document.querySelector('#msg').textContent.includes('أدخل بياناتك')")
        page.fill('#email','fixture@example.invalid');page.fill('#password','legacy6')
        page.get_by_role('button',name='تسجيل الدخول',exact=True).click()
        page.wait_for_function("document.querySelector('#msg').textContent.includes('تعذر تسجيل الدخول')")
        assert page.locator('#password').input_value()==''
        assert 'private provider detail' not in page.locator('#msg').inner_text()
        page.fill('#password','a synthetic long passphrase')
        page.get_by_role('button',name='إنشاء حساب جديد',exact=True).click()
        page.wait_for_function("document.querySelector('#msg').textContent.includes('إذا كان التسجيل متاحًا')")
        assert page.locator('#password').input_value()==''
        assert page.evaluate('window.fixtureCalls')==['login','signup']
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert not errors,errors
        print(('Mobile' if mobile else 'Desktop')+': auth module loads under CSP, existing-password login remains valid, signup handles confirmation, passwords clear and private errors stay hidden; synthetic responses only.')
        context.close()
    browser.close()
