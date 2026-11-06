"""Advertiser acceptance with actual pinned SDK and synthetic HTTP fixtures only.
No production user, payment, provider, public advertisement or database is touched.
"""
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from datetime import datetime,timedelta,timezone
import base64,copy,json,time
from playwright.sync_api import sync_playwright,expect

ROOT=Path(__file__).resolve().parent.parent
SITE='https://advertiser.test'
API='ynsmhtsktbubxfhsekjq.supabase.co'
KEY='sb_publishable_gvGYG-BLNBQbA8JsXy9lag_9c6QwSWc'
STORAGE='sb-ynsmhtsktbubxfhsekjq-auth-token'
OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
ORDER='11111111-1111-4111-8111-111111111111'
NEW='22222222-2222-4222-8222-222222222222'
FOREIGN='33333333-3333-4333-8333-333333333333'
STAMP=datetime.now(timezone.utc).isoformat()
URL='https://agri.example.com/products?campaign=ur'


def encode(v):return base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
def user(owner=OWNER):return {'id':owner,'aud':'authenticated','role':'authenticated','email':'advertiser-fixture@example.invalid','email_confirmed_at':STAMP,'created_at':STAMP,'app_metadata':{'provider':'email'},'user_metadata':{},'identities':[]}
def session(owner=OWNER):
 now=int(time.time());token='.'.join([encode({'alg':'HS256','typ':'JWT'}),encode({'sub':owner,'aud':'authenticated','role':'authenticated','aal':'aal1','iat':now,'exp':now+3600}),'synthetic-signature-not-for-a-server'])
 return {'access_token':token,'refresh_token':'synthetic-advertiser-refresh','expires_in':3600,'expires_at':now+3600,'token_type':'bearer','user':user(owner)}
SESSION=session();OTHER_SESSION=session(OTHER)


def order_fixture(order_id=ORDER,owner=OWNER):
 return {'id':order_id,'owner_id':owner,'company_name':'شركة اختبار زراعية','contact_name':'اسم تواصل خاص','contact_phone':'TEST-PHONE','request_note':'ORIGINAL_OWNER_PRIVATE_NOTE' if owner==OWNER else 'SECOND_OWNER_NOTE','placement':'home','duration_days':30,'ad_title':'ORIGINAL_OWNER_TITLE' if owner==OWNER else 'SECOND_OWNER_TITLE','ad_body':'نص إعلان اصطناعي واضح','target_url':URL,'status':'new','quote_iqd':None,'quote_scope':None,'quote_version':0,'quoted_at':None,'accepted_at':None,'payment_reference':None,'admin_note':None,'approved_at':None,'starts_at':None,'ends_at':None,'created_at':STAMP,'updated_at':STAMP}


def quote(row,version=1):
 row.update(status='quoted',quote_iqd=65000,quote_scope='<img src=x onerror="window.__adPwned=1"> موضع ومدة ونص متفق عليها',quote_version=version,quoted_at=STAMP,placement='services',duration_days=7,ad_title='عنوان الإدارة النهائي '+str(version),ad_body='<script>window.__adPwned=1</script> نص عرض آمن '+str(version),target_url='https://agri.example.com/final?version='+str(version))


def handler_for(state):
 def handler(route):
  req=route.request;url=urlparse(req.url);state['urls'].append(req.url)
  if url.hostname=='advertiser.test':
   if url.path=='/fixture.html':route.fulfill(body='<!doctype html><title>SDK fixture</title>',content_type='text/html');return
   path=ROOT/url.path.lstrip('/')
   if path.is_file():route.fulfill(body=path.read_bytes(),content_type={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'}.get(path.suffix,'text/html'));return
  if url.hostname!=API:route.abort('blockedbyclient');return
  cors={'access-control-allow-origin':SITE,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':req.headers.get('access-control-request-headers','apikey,authorization,content-type,x-client-info,x-supabase-api-version')}
  if req.method=='OPTIONS':route.fulfill(status=204,headers=cors);return
  if url.path=='/auth/v1/logout':route.fulfill(status=204,headers=cors);return
  if url.path=='/auth/v1/user':route.fulfill(json=user(state['owner']),headers=cors);return
  token=SESSION['access_token'] if state['owner']==OWNER else OTHER_SESSION['access_token']
  if state['owner'] is None or req.headers.get('authorization')=='Bearer '+KEY:route.fulfill(status=401,json={'message':'Login required'},headers=cors);return
  assert req.headers.get('authorization')=='Bearer '+token
  query=parse_qs(url.query);body=json.loads(req.post_data) if req.post_data else None
  state['api'].append({'path':url.path,'query':query,'body':body})
  if url.path=='/rest/v1/advertising_orders':
   assert query.get('owner_id')==['eq.'+state['owner']] and query.get('limit')==['50']
   assert all(name not in query['select'][0] for name in ['quoted_by','approved_by','accepted_quote_version'])
   rows=copy.deepcopy(state['orders'])
   if state['hold_once']:state['hold_once']=False;state['held'].append((route,rows,cors));return
   route.fulfill(json=rows,headers=cors);return
  if url.path=='/rest/v1/rpc/create_advertising_order':
   assert set(body)=={'p_company_name','p_placement','p_duration_days','p_ad_title','p_ad_body','p_target_url','p_contact_name','p_contact_phone','p_request_note'}
   assert body['p_company_name']=='شركة التنقيط الاختبارية' and body['p_placement']=='home' and body['p_duration_days']==14 and body['p_target_url']==URL
   state['rpc'].append(('create',body));row=order_fixture(NEW)
   for arg,column in [('p_company_name','company_name'),('p_placement','placement'),('p_duration_days','duration_days'),('p_ad_title','ad_title'),('p_ad_body','ad_body'),('p_target_url','target_url'),('p_contact_name','contact_name'),('p_contact_phone','contact_phone'),('p_request_note','request_note')]:row[column]=body[arg]
   state['orders'].insert(0,row);route.fulfill(json={'id':NEW,'status':'new'},headers=cors);return
  if url.path=='/rest/v1/rpc/accept_advertising_quote':
   assert set(body)=={'p_order_id','p_quote_version','p_payment_reference'}
   state['rpc'].append(('accept',body));row=next(r for r in state['orders'] if r['id']==body['p_order_id'])
   if row['status']!='quoted' or row['quote_version']!=body['p_quote_version']:route.fulfill(status=409,json={'code':'55000','message':'Current quote changed'},headers=cors);return
   row.update(status='awaiting_payment',accepted_at=STAMP,payment_reference=body['p_payment_reference']);route.fulfill(json={'id':row['id'],'status':'awaiting_payment','quote_version':row['quote_version']},headers=cors);return
  if url.path=='/rest/v1/rpc/cancel_advertising_order':
   assert set(body)=={'p_order_id'};state['rpc'].append(('cancel',body));row=next(r for r in state['orders'] if r['id']==body['p_order_id'])
   assert row['status'] in ['new','quoted','awaiting_payment'] and not row['approved_at']
   row['status']='cancelled';route.fulfill(json={'id':row['id'],'status':'cancelled'},headers=cors);return
  raise AssertionError('Unexpected API route '+url.path)
 return handler


def setup(browser,mobile,signed=True):
 ctx=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 960},is_mobile=mobile,has_touch=mobile)
 if signed:ctx.add_init_script('if(!localStorage.getItem('+json.dumps(STORAGE)+'))localStorage.setItem('+json.dumps(STORAGE)+','+json.dumps(json.dumps(SESSION))+');')
 state={'owner':OWNER,'orders':[order_fixture(),order_fixture(FOREIGN,OTHER)],'hold_once':False,'held':[],'urls':[],'api':[],'rpc':[]}
 ctx.route('**/*',handler_for(state));page=ctx.new_page();page.set_default_timeout(10000);errors=[];logs=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda e:logs.append(e.text));return ctx,page,state,errors,logs


def ready(page,signed=True):
 page.goto(SITE+'/advertise.html',wait_until='domcontentloaded')
 if signed:expect(page.locator('#privateContent')).to_be_visible();expect(page.locator('#refreshOrders')).to_be_enabled()
 else:expect(page.locator('#accountStatus')).to_contain_text('سجّل الدخول');expect(page.locator('#privateContent')).to_be_hidden()
 expect(page.locator('#retryAccount')).to_be_enabled()


def refresh(page):page.click('#refreshOrders');expect(page.locator('#refreshOrders')).to_be_enabled()
def choose(page,id=ORDER):page.locator('[data-order-id="'+id+'"]').click();expect(page.locator('#selectedPanel')).to_be_visible()
def held(state,page):
 for _ in range(100):
  if state['held']:return state['held'].pop(0)
  page.wait_for_timeout(30)
 raise AssertionError('Expected held request')


def clean(page,errors,logs):
 assert not errors,errors
 assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1')
 assert page.evaluate('()=>window.__adPwned') is None
 for secret in [SESSION['access_token'],OTHER_SESSION['access_token'],SESSION['refresh_token']]:assert secret not in page.content() and not any(secret in log for log in logs)


def close(ctx,state):
 for route,_,_ in state['held']:
  try:route.abort('blockedbyclient')
  except Exception:pass
 ctx.close()


def public_scenario(browser,mobile):
 ctx,page,state,errors,logs=setup(browser,mobile,False);ready(page,False)
 expect(page.locator('.media-card')).to_have_count(4);assert not state['api'] and not state['rpc'];assert 'رقم' not in page.locator('.media-note').inner_text() or 'لا' in page.locator('.media-note').inner_text()
 clean(page,errors,logs);close(ctx,state)
 ctx=browser.new_context(java_script_enabled=False,viewport={'width':390 if mobile else 1280,'height':844 if mobile else 960});ctx.route('**/*',lambda route:route.fulfill(body=(ROOT/'advertise.html').read_bytes(),content_type='text/html') if urlparse(route.request.url).path=='/advertise.html' else route.abort('blockedbyclient'));p=ctx.new_page();p.goto(SITE+'/advertise.html');expect(p.locator('.media-card')).to_have_count(4);ctx.close()


def quote_flow(browser,mobile):
 ctx,page,state,errors,logs=setup(browser,mobile);ready(page)
 assert 'SECOND_OWNER_TITLE' not in page.locator('#ordersList').inner_text()
 assert any(url.endswith('/vendor/supabase-js-2.57.4.js') for url in state['urls'])
 page.fill('#companyName','شركة التنقيط الاختبارية');page.fill('#durationDays','14');page.fill('#adTitle','عنوان أولي');page.fill('#adBody','وصف أولي للمنتج الزراعي')
 for invalid in ['https://127.0.0.1/private','http://agri.example.com/','https://user:password@agri.example.com/','https://agri.local/','https://agri.example.com:8443/']:
  page.fill('#targetUrl',invalid);page.click('#createOrder');assert not state['rpc']
 page.fill('#targetUrl',URL);page.fill('#contactName','اسم للرد');page.fill('#contactPhone','TEST-PHONE');page.fill('#requestNote','ملاحظة خاصة للمراجعة');page.click('#createOrder');expect(page.locator('#createStatus')).to_contain_text('أُرسل طلبك');expect(page.locator('#selectedMeta')).to_contain_text(NEW)
 row=next(r for r in state['orders'] if r['id']==NEW);quote(row,2);refresh(page)
 expect(page.locator('#quoteMeta')).to_contain_text('٧ يومًا');expect(page.locator('#quoteMeta')).to_contain_text('مركز الخدمات');expect(page.locator('#quoteAmount')).to_contain_text('٦٥٬٠٠٠');expect(page.locator('#creativeTitle')).to_contain_text('النهائي 2')
 assert page.locator('#creativeLink').get_attribute('href').endswith('version=2') and page.locator('#creativeLink').get_attribute('rel')=='sponsored noopener noreferrer'
 assert page.locator('#creativeBody script,#quoteScope img').count()==0
 assert page.locator('#acceptQuote').is_disabled()
 page.check('#acceptConsent');quote(row,3);page.click('#acceptQuote')
 expect(page.locator('#quoteStatus')).to_contain_text('تغيّرت حالة');expect(page.locator('#creativeTitle')).to_contain_text('النهائي 3');assert not page.locator('#acceptConsent').is_checked();assert row['status']=='quoted' and not row['approved_at']
 page.fill('#paymentReference','TEST-REFERENCE');page.check('#acceptConsent');page.click('#acceptQuote');expect(page.locator('#paymentStatus')).to_contain_text('تنتظر الإدارة تأكيد استلام الدفع');expect(page.locator('#quoteAcceptance')).to_be_hidden()
 assert row['status']=='awaiting_payment' and not row['approved_at'] and not row['starts_at']
 accepted=[body for kind,body in state['rpc'] if kind=='accept'];assert accepted[-1]=={'p_order_id':NEW,'p_quote_version':3,'p_payment_reference':'TEST-REFERENCE'}
 row.update(status='approved',approved_at=STAMP);refresh(page);expect(page.locator('#paymentStatus')).to_contain_text('الإعلان لم يُنشر بعد');assert page.locator('#cancelOrder').is_hidden()
 start=datetime.now(timezone.utc)-timedelta(minutes=1);end=start+timedelta(days=7);row.update(status='active',starts_at=start.isoformat(),ends_at=end.isoformat());refresh(page);expect(page.locator('#selectedStatus')).to_have_text('منشور');expect(page.locator('#publicationStatus')).to_contain_text('بداية النشر')
 row['status']='paused';refresh(page);expect(page.locator('#selectedStatus')).to_have_text('متوقف مؤقتًا');expect(page.locator('#paymentStatus')).to_contain_text('دون تمديد تلقائي')
 row.update(status='active',ends_at=(datetime.now(timezone.utc)-timedelta(seconds=10)).isoformat());refresh(page);expect(page.locator('#selectedStatus')).to_have_text('انتهت مدة الإعلان')
 assert all(kind in ['create','accept','cancel'] for kind,_ in state['rpc'])
 Path('/workspace/artifacts').mkdir(exist_ok=True)
 page.locator('#selectedPanel').scroll_into_view_if_needed();page.screenshot(path='/workspace/artifacts/ur-smart-advertise-'+('mobile' if mobile else 'desktop')+'-quote-test.png')
 page.locator('.hero').scroll_into_view_if_needed();page.screenshot(path='/workspace/artifacts/ur-smart-advertise-'+('mobile' if mobile else 'desktop')+'-hero-test.png')
 clean(page,errors,logs);close(ctx,state)


def cancel_and_retry(browser,mobile):
 ctx,page,state,errors,logs=setup(browser,mobile);ready(page);choose(page);page.click('#cancelOrder');expect(page.locator('#cancelStatus')).to_contain_text('أُلغي');assert state['rpc'][-1]==('cancel',{'p_order_id':ORDER});assert page.locator('#cancelOrder').is_hidden()
 state['hold_once']=True;page.click('#refreshOrders');route,old,cors=held(state,page);state['orders'][0]['ad_title']='NEW_RETRY_TITLE';page.click('#retryAccount');expect(page.locator('#ordersList')).to_contain_text('NEW_RETRY_TITLE');expect(page.locator('#refreshOrders')).to_be_enabled();route.fulfill(json=old,headers=cors);page.wait_for_timeout(150);expect(page.locator('#ordersList')).to_contain_text('NEW_RETRY_TITLE')
 clean(page,errors,logs);close(ctx,state)


def switch_and_logout(browser,mobile):
 ctx,page,state,errors,logs=setup(browser,mobile);ready(page);choose(page);page.fill('#contactPhone','PRIVATE_DRAFT_PHONE');page.fill('#requestNote','PRIVATE_DRAFT_NOTE');state['hold_once']=True;page.click('#refreshOrders');route,old,cors=held(state,page);state['owner']=OTHER
 page.evaluate("async value=>{const {createClient}=await import('./supabase-client.mjs');const sdk=createClient('https://"+API+"','"+KEY+"');await sdk.auth.setSession({access_token:value.access_token,refresh_token:value.refresh_token});}",OTHER_SESSION)
 expect(page.locator('#ordersList')).to_contain_text('SECOND_OWNER_TITLE');route.fulfill(json=old,headers=cors);page.wait_for_timeout(150)
 assert 'ORIGINAL_OWNER_TITLE' not in page.locator('#ordersList').inner_text() and 'ORIGINAL_OWNER_PRIVATE_NOTE' not in page.content();assert not page.locator('#contactPhone').input_value() and not page.locator('#requestNote').input_value()
 state['hold_once']=True;page.click('#refreshOrders');route,old,cors=held(state,page);state['owner']=None
 other=ctx.new_page();other.goto(SITE+'/fixture.html');other.evaluate("async()=>{const {createClient}=await import('./supabase-client.mjs');const sdk=createClient('https://"+API+"','"+KEY+"');await sdk.auth.signOut({scope:'local'});}")
 expect(page.locator('#privateContent')).to_be_hidden();expect(page.locator('#accountStatus')).to_contain_text('سجّل الدخول');other.close();route.fulfill(json=old,headers=cors);page.wait_for_timeout(150);assert not page.locator('#ordersList').inner_text() and not page.locator('#creativeTitle').inner_text()
 clean(page,errors,logs);close(ctx,state)


def main():
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  for mobile in [False,True]:
   public_scenario(browser,mobile);quote_flow(browser,mobile);cancel_and_retry(browser,mobile);switch_and_logout(browser,mobile)
   print(('Mobile' if mobile else 'Desktop')+': actual pinned SDK; public media, owned orders, safe URLs/text, exact creative/versioned quote consent, manual payment/publication separation, expiry, cancel, retry/late reply and account/signout cleanup PASS; HTTP fixtures only.',flush=True)
  browser.close()

if __name__=='__main__':main()
