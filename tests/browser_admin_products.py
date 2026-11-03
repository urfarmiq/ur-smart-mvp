"""Product inquiry administration with local auth/HTTP fixtures only.

No real customer, product inventory, account, database, payment or API is used.
"""
from pathlib import Path
from urllib.parse import urlparse
import ast
import json
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
TREE=ast.parse((ROOT/'tests/browser_admin.py').read_text())
BASE=next(ast.literal_eval(n.value) for n in TREE.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='MOCK' for t in n.targets))
FIRST='10000000-0000-4000-8000-000000000011'
SECOND='10000000-0000-4000-8000-000000000012'
THIRD='10000000-0000-4000-8000-000000000013'
SETUP=r"""
Object.assign(window.__fixture,{holdProductReads:false,pendingProductReads:[],holdProductReview:false,pendingProductReviews:[],failProductReview:false,productRows:[
 {id:FIRST,owner_id:'customer-one',item_code:'drip_installation',quantity:1,province:'wasit',district:'الكوت',area_donum:8,contact_phone:'07700000000',customer_note:'<img src=x onerror=window.__productXss=true> شبكة للحقل',status:'new',quote_iqd:null,admin_reply:null,created_at:'2026-11-03T10:00:00Z',updated_at:'2026-11-03T10:00:00Z',reviewed_by:'PRIVATE_REVIEWER',access_token:'PRIVATE_TOKEN'},
 {id:SECOND,owner_id:'customer-two',item_code:'weather_station',quantity:2,province:'basra',district:null,area_donum:null,contact_phone:null,customer_note:'مواصفات محطة الطقس',status:'reviewing',quote_iqd:null,admin_reply:'قيد تدقيق تفاصيل الموديل',created_at:'2026-11-03T09:00:00Z',updated_at:'2026-11-03T09:30:00Z'},
 {id:THIRD,owner_id:'customer-three',item_code:'pest_station',quantity:1,province:'baghdad',district:null,area_donum:null,contact_phone:null,customer_note:'استفسار عن المحطة',status:'quoted',quote_iqd:95000,admin_reply:'<script>window.__replyXss=true</script> عرض تجريبي لا يمثل سعر منتج حقيقي',created_at:'2026-11-03T08:00:00Z',updated_at:'2026-11-03T08:30:00Z'}
]});
""".replace('FIRST',json.dumps(FIRST)).replace('SECOND',json.dumps(SECOND)).replace('THIRD',json.dumps(THIRD))
RPC=r"""
  if(name==='review_product_inquiry'){
   if(!s.signedIn||!s.role||s.aal!=='aal2')throw Error('Product review before MFA');
   if(s.failProductReview)return {data:null,error:{message:'PRIVATE_PRODUCT_PROVIDER_SECRET'}};
   if(Object.keys(input).sort().join(',')!=='p_admin_reply,p_inquiry_id,p_quote_iqd,p_status')throw Error('Unexpected product payload');
   const row=s.productRows.find(r=>r.id===input.p_inquiry_id);if(!row||!['new','reviewing','quoted'].includes(row.status))return {data:null,error:{message:'terminal'}};
   if(!['reviewing','quoted','closed'].includes(input.p_status))throw Error('Unexpected product decision');
   if(input.p_status==='quoted'&&(!Number.isSafeInteger(input.p_quote_iqd)||!input.p_admin_reply))throw Error('Invalid quote');
   if(row.item_code==='drip_installation'&&(row.province!=='wasit'||row.quantity!==1)&&input.p_status!=='closed')throw Error('Wasit restriction violated');
   row.status=input.p_status;row.quote_iqd=input.p_quote_iqd;row.admin_reply=input.p_admin_reply;
   const response={data:{id:row.id,status:row.status,quote_iqd:row.quote_iqd,admin_reply:row.admin_reply},error:null};
   if(s.holdProductReview)return new Promise(resolve=>s.pendingProductReviews.push(()=>resolve(response)));
   return response;
  }
"""
QUERY=r"""
   if(table==='product_inquiries'){
    if(action!=='select'||!s.signedIn||!s.role||s.aal!=='aal2')throw Error('Product read before MFA');
    if(columns.split(',').includes('*')||/reviewed_by|access_token|password|result/.test(columns))throw Error('Unsafe product columns');
    const match=row=>filters.every(f=>f.op==='in'?f.value.includes(row[f.key]):row[f.key]===f.value);
    const data=s.productRows.filter(match).slice(start,start+limit).map(row=>Object.fromEntries(columns.split(',').map(k=>[k,row[k]])));
    const response={data,error:null};if(s.holdProductReads)return new Promise(resolve=>s.pendingProductReads.push(()=>resolve(response)));return response;
   }
"""
MOCK=BASE.replace("id:'fixture-admin'","id:window.__fixture.actorId||'fixture-admin'").replace('const user=()=>',SETUP+'\nconst user=()=>').replace("  if(name!=='admin_site_visits')throw Error('Unexpected RPC');",RPC+"  if(name!=='admin_site_visits')throw Error('Unexpected RPC');").replace("   if(!['signup_notifications','research_orders'].includes(table))",QUERY+"   if(!['signup_notifications','research_orders'].includes(table))")

def context_for(browser,mobile,mode='admin'):
 context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 900},is_mobile=mobile,has_touch=mobile)
 def route_request(route):
  url=urlparse(route.request.url)
  if url.hostname=='ur-smart.test':
   path=ROOT/url.path.lstrip('/')
   if path.is_file():route.fulfill(body=path.read_bytes(),content_type={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'}.get(path.suffix,'text/html'));return
  if url.hostname=='cdn.jsdelivr.net' and '@supabase/supabase-js@2.57.4/' in url.path:
   route.fulfill(body=MOCK.replace('FIXTURE_MODE',json.dumps(mode)).replace('FIXTURE_SECRET',json.dumps('JBSWY3DPEHPK3PXP')),content_type='text/javascript');return
  route.abort('blockedbyclient')
 context.route('**/*',route_request);page=context.new_page();page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('https://ur-smart.test/admin.html');return context,page,errors

def card(page,inquiry):return page.locator('.product-inquiry[data-inquiry-id="'+inquiry+'"]')
def wait_rows(page,count=3):expect(page.locator('#productInquiryList .product-inquiry')).to_have_count(count)
def signout(page):page.evaluate("()=>{window.__fixture.signedIn=false;for(const f of [...window.__fixture.listeners])f('SIGNED_OUT',null)}")
def fill_quote(page):
 first=card(page,FIRST);first.locator('[name=quote_amount]').fill('125000');first.locator('[name=admin_reply]').fill('عرض تجريبي لشبكة داخل واسط؛ تحدد المواصفات والتوفر وموعد التنفيذ بالاتفاق');return first

def scenario(browser,mobile):
 for mode in ('anon','ordinary','challenge'):
  ctx,page,errors=context_for(browser,mobile,mode);page.wait_for_function('()=>!!window.__fixture');expect(page.locator('#productAdminPanel')).to_be_hidden()
  assert page.evaluate("()=>window.__fixture.calls.filter(c=>c.table==='product_inquiries'||c.rpc==='review_product_inquiry').length")==0
  assert not errors,errors;ctx.close()
 ctx,page,errors=context_for(browser,mobile);wait_rows(page);expect(page.locator('#productAdminPanel')).to_be_visible()
 visible=page.locator('#productInquiryList').inner_text();assert 'واسط فقط' in visible and 'البصرة' in visible and 'بغداد' in visible
 assert '<img src=x' in visible and '<script>' in visible and page.locator('#productInquiryList img,#productInquiryList script').count()==0
 assert page.evaluate('()=>window.__productXss') is None and page.evaluate('()=>window.__replyXss') is None
 assert 'PRIVATE_REVIEWER' not in page.content() and 'PRIVATE_TOKEN' not in page.content()
 first=card(page,FIRST);first.get_by_role('button',name='إرسال عرض السعر للعميل',exact=True).click();page.wait_for_timeout(70)
 assert page.evaluate("()=>window.__fixture.calls.filter(c=>c.rpc==='review_product_inquiry').length")==0
 first=fill_quote(page);page.select_option('#productInquiryFilter','all');assert page.locator('#productInquiryFilter').input_value()=='open'
 page.click('#refreshProductInquiries');assert first.locator('[name=quote_amount]').input_value()=='125000'
 first.get_by_role('button',name='إرسال عرض السعر للعميل',exact=True).click();expect(page.locator('#productAdminStatus')).to_contain_text('أُرسل عرض السعر')
 payload=page.evaluate("()=>window.__fixture.calls.find(c=>c.rpc==='review_product_inquiry').input")
 assert payload=={'p_inquiry_id':FIRST,'p_status':'quoted','p_admin_reply':'عرض تجريبي لشبكة داخل واسط؛ تحدد المواصفات والتوفر وموعد التنفيذ بالاتفاق','p_quote_iqd':125000}
 expect(card(page,FIRST)).to_contain_text('١٢٥٬٠٠٠ دينار عراقي')
 second=card(page,SECOND);second.get_by_role('button',name='إغلاق الطلب',exact=True).click();expect(page.locator('#productAdminStatus')).to_contain_text('أُغلق الطلب');assert card(page,SECOND).count()==0
 assert page.evaluate("()=>window.__fixture.calls.filter(c=>c.rpc==='review_product_inquiry').at(-1).input")=={'p_inquiry_id':SECOND,'p_status':'closed','p_admin_reply':'قيد تدقيق تفاصيل الموديل','p_quote_iqd':None}
 page.select_option('#productInquiryFilter','closed');expect(card(page,SECOND)).to_be_visible();assert card(page,SECOND).locator('form,input,textarea,button').count()==0
 assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1')
 assert not errors,errors;ctx.close()
 # Readonly customer cancellation and invalid outside-Wasit requests cannot
 # expose an execution quote path even if a malformed fixture is returned.
 ctx,page,errors=context_for(browser,mobile);wait_rows(page)
 page.evaluate("()=>{const s=window.__fixture;s.productRows.push({...s.productRows[0],id:'outside-wasit',province:'basra'});s.productRows.push({...s.productRows[1],id:'cancelled',status:'cancelled'})}")
 page.select_option('#productInquiryFilter','all');wait_rows(page,5)
 outside=card(page,'outside-wasit');expect(outside).to_contain_text('خارج نطاق تنفيذ الري');assert outside.get_by_role('button',name='إرسال عرض السعر للعميل',exact=True).count()==0
 assert card(page,'cancelled').locator('form,input,textarea,button').count()==0
 outside.get_by_role('button',name='إغلاق الطلب',exact=True).click();expect(page.locator('#productAdminStatus')).to_contain_text('أُغلق الطلب')
 assert not errors,errors;ctx.close()
 # Explicit pagination retains older rows and does not overwrite open drafts.
 ctx,page,errors=context_for(browser,mobile);wait_rows(page)
 page.evaluate("()=>{const s=window.__fixture;for(let i=0;i<60;i++)s.productRows.push({...s.productRows[1],id:'older-product-'+i})}")
 page.select_option('#productInquiryFilter','all');wait_rows(page,50)
 expect(page.locator('#olderProductInquiries')).to_be_visible();page.click('#olderProductInquiries');wait_rows(page,63)
 assert page.locator('#olderProductInquiries').is_hidden();assert not errors,errors;ctx.close()
 # Every customer row read is rechecked after its response, including role,
 # assurance and actor changes; late data never restores the prior panel.
 for access_change in ('signout','stepdown','revoked','actorchange'):
  ctx,page,errors=context_for(browser,mobile);wait_rows(page)
  page.evaluate('()=>window.__fixture.holdProductReads=true');page.click('#refreshProductInquiries');page.wait_for_function('()=>window.__fixture.pendingProductReads.length>0')
  if access_change=='signout':signout(page)
  elif access_change=='stepdown':page.evaluate("()=>window.__fixture.aal='aal1'")
  elif access_change=='revoked':page.evaluate('()=>window.__fixture.role=false')
  else:page.evaluate("()=>window.__fixture.actorId='another-admin'")
  page.evaluate('()=>{for(const release of window.__fixture.pendingProductReads.splice(0))release()}')
  expect(page.locator('#productAdminPanel')).to_be_hidden();assert page.locator('#productInquiryList').inner_text()=='';assert not errors,errors;ctx.close()
 for access_change in ('signout','stepdown','revoked','actorchange'):
  ctx,page,errors=context_for(browser,mobile);wait_rows(page);first=fill_quote(page)
  page.evaluate('()=>window.__fixture.holdProductReview=true');first.get_by_role('button',name='إرسال عرض السعر للعميل',exact=True).click();page.wait_for_function('()=>window.__fixture.pendingProductReviews.length>0')
  if access_change=='signout':signout(page)
  elif access_change=='stepdown':page.evaluate("()=>window.__fixture.aal='aal1'")
  elif access_change=='revoked':page.evaluate('()=>window.__fixture.role=false')
  else:page.evaluate("()=>window.__fixture.actorId='another-admin'")
  page.evaluate('()=>{for(const release of window.__fixture.pendingProductReviews.splice(0))release()}')
  expect(page.locator('#productAdminPanel')).to_be_hidden();assert page.locator('#productInquiryList').inner_text()=='';assert 'عرض تجريبي لشبكة داخل واسط' not in page.content();assert not errors,errors;ctx.close()
 # A downgrade before submission blocks even the RPC attempt.
 ctx,page,errors=context_for(browser,mobile);wait_rows(page);first=fill_quote(page);page.evaluate("()=>window.__fixture.aal='aal1'");first.get_by_role('button',name='إرسال عرض السعر للعميل',exact=True).click();expect(page.locator('#productAdminPanel')).to_be_hidden()
 assert page.evaluate("()=>window.__fixture.calls.filter(c=>c.rpc==='review_product_inquiry').length")==0;assert not errors,errors;ctx.close()
 # Provider failures do not leak the response or erase the administrator draft.
 ctx,page,errors=context_for(browser,mobile);wait_rows(page);first=fill_quote(page);page.evaluate('()=>window.__fixture.failProductReview=true');first.get_by_role('button',name='إرسال عرض السعر للعميل',exact=True).click();expect(page.locator('#productAdminStatus')).to_contain_text('تعذر حفظ الرد')
 assert 'PRIVATE_PRODUCT_PROVIDER_SECRET' not in page.content();assert first.locator('[name=quote_amount]').input_value()=='125000';assert not errors,errors;ctx.close()

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for mobile in (False,True):
  scenario(browser,mobile)
  print(('Mobile' if mobile else 'Desktop')+': product quotations, Wasit-only execution, optional contact, safe text, terminal records, exact RPC, draft preservation and before/after MFA/role/actor cleanup pass; fixtures only.')
 browser.close()
