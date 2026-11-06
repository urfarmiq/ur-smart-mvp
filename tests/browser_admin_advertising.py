"""Advertising administration; every auth, order and payment is an isolated fixture.

No actual advertiser, account, database, ad network or payment is contacted.
"""
from pathlib import Path
from urllib.parse import urlparse
import ast
import json
import time
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
TREE=ast.parse((ROOT/'tests/browser_admin.py').read_text())
BASE=next(ast.literal_eval(n.value) for n in TREE.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='MOCK' for t in n.targets))
FIRST='10000000-0000-4000-8000-00000000ad01'
SECOND='10000000-0000-4000-8000-00000000ad02'
THIRD='10000000-0000-4000-8000-00000000ad03'
SETUP=r"""
const baseAd={id:FIRST,owner_id:'advertiser-one',company_name:'شركة زراعية تجريبية',contact_name:'اسم تجريبي',contact_phone:'07700000000',request_note:'<img src=x onerror=window.__adXss=true> تفاصيل العميل',placement:'home',duration_days:14,ad_title:'<script>window.__adXss=true</script> عنوان تجريبي',ad_body:'نص إعلان اختباري دون شركة حقيقية',target_url:'https://example.org/farm',status:'new',quote_iqd:null,quote_scope:null,quote_version:0,quoted_at:null,accepted_at:null,payment_reference:null,admin_note:null,approved_at:null,starts_at:null,ends_at:null,created_at:'2026-11-05T10:00:00Z',updated_at:'2026-11-05T10:00:00Z',approved_by:'PRIVATE_APPROVER',access_token:'PRIVATE_AD_TOKEN'};
const start=new Date(Date.now()-86400000).toISOString(),end=new Date(Date.now()+13*86400000).toISOString();
Object.assign(window.__fixture,{holdAdReads:false,pendingAdReads:[],holdAdMutation:false,pendingAdMutations:[],failAdMutation:false,adRows:[
 {...baseAd},
 {...baseAd,id:SECOND,status:'awaiting_payment',quote_iqd:97000,quote_scope:'حملة متفق عليها',quote_version:1,quoted_at:start,accepted_at:start},
 {...baseAd,id:THIRD,status:'approved',quote_iqd:97000,quote_scope:'حملة متفق عليها',quote_version:1,quoted_at:start,accepted_at:start,approved_at:start},
 {...baseAd,id:'active-ad',status:'active',quote_iqd:97000,quote_scope:'حملة متفق عليها',quote_version:1,quoted_at:start,accepted_at:start,approved_at:start,starts_at:start,ends_at:end},
 {...baseAd,id:'paused-ad',status:'paused',quote_iqd:97000,quote_scope:'حملة متفق عليها',quote_version:1,quoted_at:start,accepted_at:start,approved_at:start,starts_at:start,ends_at:end},
 {...baseAd,id:'expired-ad',status:'active',quote_iqd:97000,quote_scope:'حملة متفق عليها',quote_version:1,quoted_at:start,accepted_at:start,approved_at:start,starts_at:new Date(Date.now()-20*86400000).toISOString(),ends_at:new Date(Date.now()-6*86400000).toISOString()},
 {...baseAd,id:'closed-ad',status:'closed'}, {...baseAd,id:'cancelled-ad',status:'cancelled'}, {...baseAd,id:'rejected-ad',status:'rejected'}
]});
""".replace('FIRST',json.dumps(FIRST)).replace('SECOND',json.dumps(SECOND)).replace('THIRD',json.dumps(THIRD))
RPC=r"""
  if(['quote_advertising_order','review_advertising_payment','publish_advertising_order'].includes(name)){
   if(!s.signedIn||!s.role||s.aal!=='aal2')throw Error('Advertising mutation before MFA');
   if(s.failAdMutation)return {data:null,error:{message:'PRIVATE_AD_PROVIDER_SECRET'}};
   const row=s.adRows.find(r=>r.id===input.p_order_id);if(!row)return {data:null,error:{message:'unavailable'}};
   let saved;
   if(name==='quote_advertising_order'){
    if(Object.keys(input).sort().join(',')!=='p_ad_body,p_ad_title,p_amount_iqd,p_duration_days,p_order_id,p_placement,p_scope,p_target_url')throw Error('Wrong quote payload');
    if(!['new','quoted'].includes(row.status)||row.accepted_at||row.approved_at)throw Error('Accepted creative modified');
    Object.assign(row,{status:'quoted',quote_iqd:input.p_amount_iqd,quote_scope:input.p_scope,quote_version:row.quote_version+1,duration_days:input.p_duration_days,ad_title:input.p_ad_title,ad_body:input.p_ad_body,target_url:input.p_target_url,placement:input.p_placement,quoted_at:new Date().toISOString()});
    saved={id:row.id,status:row.status,quote_iqd:row.quote_iqd,quote_scope:row.quote_scope,quote_version:row.quote_version,duration_days:row.duration_days,ad_title:row.ad_title,ad_body:row.ad_body,target_url:row.target_url,placement:row.placement};
   }else if(name==='review_advertising_payment'){
    if(Object.keys(input).sort().join(',')!=='p_decision,p_note,p_order_id')throw Error('Wrong payment payload');
    if(!['new','quoted','awaiting_payment'].includes(row.status)||row.approved_at)throw Error('Paid order reviewed again');
    if(input.p_decision==='approve'&&(row.status!=='awaiting_payment'||!row.accepted_at))throw Error('Payment before acceptance');
    row.status=input.p_decision==='approve'?'approved':'rejected';row.approved_at=input.p_decision==='approve'?new Date().toISOString():null;row.admin_note=input.p_note;
    saved={id:row.id,status:row.status,approved_at:row.approved_at};
   }else{
    if(Object.keys(input).sort().join(',')!=='p_action,p_order_id')throw Error('Wrong publication payload');
    if(!row.approved_at)throw Error('Unpaid publication');
    if(input.p_action==='publish'){if(row.status!=='approved')throw Error('Repeated publication');if(s.adRows.filter(r=>r.placement===row.placement&&['active','paused'].includes(r.status)&&Date.parse(r.ends_at)>Date.now()).length>=3)return {data:null,error:{code:'55000',message:'PRIVATE_CAPACITY_SERVER_DETAIL'}};row.status='active';row.starts_at=new Date().toISOString();row.ends_at=new Date(Date.parse(row.starts_at)+row.duration_days*86400000).toISOString();}
    else if(input.p_action==='pause'){if(row.status!=='active'||Date.parse(row.ends_at)<=Date.now())throw Error('Invalid pause');row.status='paused';}
    else if(input.p_action==='resume'){if(row.status!=='paused'||Date.parse(row.ends_at)<=Date.now())throw Error('Expired resume');row.status='active';}
    else if(input.p_action==='close'){if(!['approved','active','paused'].includes(row.status))throw Error('Terminal reopened');row.status='closed';}
    else throw Error('Unknown publication');
    saved={id:row.id,status:row.status,starts_at:typeof row.starts_at==='string'?row.starts_at.replace(/Z$/,'+00:00'):row.starts_at,ends_at:typeof row.ends_at==='string'?row.ends_at.replace(/Z$/,'+00:00'):row.ends_at};
   }
   const response={data:saved,error:null};if(s.holdAdMutation)return new Promise(resolve=>s.pendingAdMutations.push(()=>resolve(response)));return response;
  }
"""
QUERY=r"""
   if(table==='advertising_orders'){
    if(action!=='select'||!s.signedIn||!s.role||s.aal!=='aal2')throw Error('Advertising read before MFA');
    if(columns.split(',').includes('*')||/approved_by|quoted_by|reviewed_by|accepted_quote_version|access_token|password|result/.test(columns))throw Error('Private advertising columns');
    const matches=row=>filters.every(f=>f.op==='in'?f.value.includes(row[f.key]):row[f.key]===f.value);
    const data=s.adRows.filter(matches).slice(start,start+limit).map(row=>Object.fromEntries(columns.split(',').map(k=>[k,row[k]])));
    const response={data,error:null};if(s.holdAdReads)return new Promise(resolve=>s.pendingAdReads.push(()=>resolve(response)));return response;
   }
"""
MOCK=BASE.replace("id:'fixture-admin'","id:window.__fixture.actorId||'fixture-admin'").replace('const user=()=>',SETUP+'\nconst user=()=>').replace("  if(name!=='admin_site_visits')throw Error('Unexpected RPC');",RPC+"  if(name!=='admin_site_visits')throw Error('Unexpected RPC');").replace("   if(!['signup_notifications','research_orders'].includes(table))",QUERY+"   if(!['signup_notifications','research_orders'].includes(table))")

def context_for(browser,mobile,mode='admin'):
 context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 960},is_mobile=mobile,has_touch=mobile)
 def route_request(route):
  url=urlparse(route.request.url)
  if url.hostname=='ur-smart.test':
   path=ROOT/url.path.lstrip('/')
   if path.is_file():route.fulfill(body=path.read_bytes(),content_type={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'}.get(path.suffix,'text/html'));return
  if url.hostname=='cdn.jsdelivr.net' and '@supabase/supabase-js@2.57.4/' in url.path:route.fulfill(body=MOCK.replace('FIXTURE_MODE',json.dumps(mode)).replace('FIXTURE_SECRET',json.dumps('JBSWY3DPEHPK3PXP')),content_type='text/javascript');return
  route.abort('blockedbyclient')
 context.route('**/*',route_request);page=context.new_page();page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)));page.goto('https://ur-smart.test/admin.html');return context,page,errors

def card(page,order):return page.locator('.advertising-order[data-order-id="'+order+'"]')
def wait_rows(page,count=6):expect(page.locator('#advertisingOrderList .advertising-order')).to_have_count(count)
def wait_js(page,expression):
 end=time.monotonic()+10
 while time.monotonic()<end:
  if page.evaluate(expression):return
  page.wait_for_timeout(30)
 raise AssertionError(expression)
def signout(page):page.evaluate("()=>{window.__fixture.signedIn=false;for(const fn of [...window.__fixture.listeners])fn('SIGNED_OUT',null)}")
def change_access(page,change):
 if change=='signout':signout(page)
 elif change=='stepdown':page.evaluate("()=>window.__fixture.aal='aal1'")
 elif change=='revoked':page.evaluate('()=>window.__fixture.role=false')
 else:page.evaluate("()=>window.__fixture.actorId='different-admin'")
def fill_quote(page,order=FIRST):
 row=card(page,order);row.locator('[name=quote_amount]').fill('145000');row.locator('[name=quote_scope]').fill('حملة نصية تجريبية للحقل الزراعي؛ لا ضمان للمشاهدات');row.locator('[name=quote_duration]').fill('14');row.locator('[name=ad_title]').fill('عنوان الحملة المتفق عليه');row.locator('[name=ad_body]').fill('نص تجريبي للمعلن دون بيانات مستخدمين أو شيفرة');row.locator('[name=target_url]').fill('https://example.org/agriculture');row.locator('[name=quote_placement]').select_option('services');return row

def scenario(browser,mobile):
 for mode in ('anon','ordinary','challenge'):
  ctx,page,errors=context_for(browser,mobile,mode);wait_js(page,'()=>!!window.__fixture');expect(page.locator('#advertisingAdminPanel')).to_be_hidden();assert page.evaluate("()=>window.__fixture.calls.filter(c=>c.table==='advertising_orders'||String(c.rpc).includes('advertising')).length")==0;assert not errors,errors;ctx.close()
 ctx,page,errors=context_for(browser,mobile);wait_rows(page);expect(page.locator('#advertisingAdminPanel')).to_be_visible()
 body=page.locator('#advertisingOrderList').inner_text();assert '<img src=x' in body and '<script>' in body and 'PRIVATE_APPROVER' not in page.content() and 'PRIVATE_AD_TOKEN' not in page.content();assert page.locator('#advertisingOrderList img,#advertisingOrderList script').count()==0 and page.evaluate('()=>window.__adXss') is None
 # A paid receipt and publication are separate, guarded transitions.
 first=fill_quote(page)
 for invalid in ('javascript:alert(1)','https://example.org:8443/path','https://advertiser.local/path','https://advertiser.test/path','https://advertiser.invalid/path','https://127.0.0.1/path','https://user:secret@example.org/path','https://example.org\\path'):
  first.locator('[name=target_url]').fill(invalid);first.get_by_role('button',name='إرسال عرض الإعلان للعميل',exact=True).click();assert page.evaluate("()=>window.__fixture.calls.filter(c=>c.rpc==='quote_advertising_order').length")==0
 first=fill_quote(page);page.click('#refreshAdvertisingOrders');assert first.locator('[name=quote_amount]').input_value()=='145000';page.select_option('#advertisingOrderFilter','all');assert page.locator('#advertisingOrderFilter').input_value()=='open'
 first.get_by_role('button',name='إرسال عرض الإعلان للعميل',exact=True).click();expect(page.locator('#advertisingAdminStatus')).to_contain_text('أُرسل العرض')
 payload=page.evaluate("()=>window.__fixture.calls.find(c=>c.rpc==='quote_advertising_order').input");assert payload=={'p_order_id':FIRST,'p_amount_iqd':145000,'p_scope':'حملة نصية تجريبية للحقل الزراعي؛ لا ضمان للمشاهدات','p_duration_days':14,'p_ad_title':'عنوان الحملة المتفق عليه','p_ad_body':'نص تجريبي للمعلن دون بيانات مستخدمين أو شيفرة','p_target_url':'https://example.org/agriculture','p_placement':'services'}
 page.evaluate("id=>{const r=window.__fixture.adRows.find(r=>r.id===id);r.status='awaiting_payment';r.accepted_at=new Date().toISOString();}",FIRST);page.click('#refreshAdvertisingOrders');expect(card(page,FIRST).locator('[name=payment_verified]')).to_be_visible()
 first=card(page,FIRST);assert first.locator('[name=quote_scope]').count()==0;assert first.get_by_role('button',name='تأكيد استلام الدفع',exact=True).is_disabled();assert first.get_by_role('button',name='نشر الإعلان وبدء المدة',exact=True).count()==0
 expect(first).to_contain_text('١٤٥٬٠٠٠ دينار عراقي');first.locator('[name=payment_verified]').check();first.get_by_role('button',name='تأكيد استلام الدفع',exact=True).click();expect(page.locator('#advertisingAdminStatus')).to_contain_text('الإعلان غير منشور')
 assert page.evaluate("id=>{const r=window.__fixture.adRows.find(r=>r.id===id);return [r.status,r.starts_at,r.ends_at]}",FIRST)==['approved',None,None]
 card(page,FIRST).get_by_role('button',name='نشر الإعلان وبدء المدة',exact=True).click();expect(page.locator('#advertisingAdminStatus')).to_contain_text('نُشر الإعلان')
 published=page.evaluate("id=>{const r=window.__fixture.adRows.find(r=>r.id===id);return [r.starts_at,r.ends_at]}",FIRST);assert all(published)
 card(page,FIRST).get_by_role('button',name='إيقاف الإعلان مؤقتًا',exact=True).click();expect(page.locator('#advertisingAdminStatus')).to_contain_text('أُوقف الإعلان')
 card(page,FIRST).get_by_role('button',name='استئناف الإعلان ضمن المدة',exact=True).click();expect(page.locator('#advertisingAdminStatus')).to_contain_text('استؤنف الإعلان')
 assert page.evaluate("id=>{const r=window.__fixture.adRows.find(r=>r.id===id);return [r.starts_at,r.ends_at]}",FIRST)==published
 expired=card(page,'expired-ad');expect(expired).to_contain_text('انتهت مدة الإعلان');assert expired.get_by_role('button',name='استئناف الإعلان ضمن المدة',exact=True).count()==0 and expired.get_by_role('button',name='إيقاف الإعلان مؤقتًا',exact=True).count()==0
 card(page,FIRST).get_by_role('button',name='إغلاق الحملة',exact=True).click();expect(page.locator('#advertisingAdminStatus')).to_contain_text('أُغلقت الحملة');page.select_option('#advertisingOrderFilter','closed');expect(card(page,FIRST)).to_be_visible();assert card(page,FIRST).locator('form,button,input,textarea').count()==0
 assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1') and not errors,errors;ctx.close()
 # Pagination and terminal requests are read-only.
 ctx,page,errors=context_for(browser,mobile);wait_rows(page);page.evaluate("()=>{const s=window.__fixture;for(let i=0;i<54;i++)s.adRows.push({...s.adRows[0],id:'older-ad-'+i})}");page.select_option('#advertisingOrderFilter','all');wait_rows(page,50);page.click('#olderAdvertisingOrders');wait_rows(page,63);assert page.locator('#olderAdvertisingOrders').is_hidden();assert card(page,'cancelled-ad').locator('form,input,textarea,button').count()==0;assert not errors,errors;ctx.close()
 # Capacity failure leaves a paid order approved, without starting its clock.
 ctx,page,errors=context_for(browser,mobile);wait_rows(page);page.evaluate("()=>{const s=window.__fixture;s.adRows.push({...s.adRows.find(r=>r.id==='active-ad'),id:'third-reserved-slot'});}");page.click('#refreshAdvertisingOrders');wait_rows(page,7);card(page,THIRD).get_by_role('button',name='نشر الإعلان وبدء المدة',exact=True).click();expect(page.locator('#advertisingAdminStatus')).to_contain_text('سعة الموضع');assert page.evaluate("id=>{const r=window.__fixture.adRows.find(r=>r.id===id);return [r.status,r.starts_at,r.ends_at]}",THIRD)==['approved',None,None];assert 'PRIVATE_CAPACITY_SERVER_DETAIL' not in page.content() and not errors,errors;ctx.close()
 # Reads and responses cannot restore a prior actor, role or MFA state.
 for change in ('signout','stepdown','revoked','actorchange'):
  ctx,page,errors=context_for(browser,mobile);wait_rows(page);page.evaluate('()=>window.__fixture.holdAdReads=true');page.click('#refreshAdvertisingOrders');wait_js(page,'()=>window.__fixture.pendingAdReads.length>0');change_access(page,change);page.evaluate('()=>{for(const release of window.__fixture.pendingAdReads.splice(0))release()}');expect(page.locator('#advertisingAdminPanel')).to_be_hidden();assert page.locator('#advertisingOrderList').inner_text()=='' and not errors,errors;ctx.close()
 for kind,order,button in [('quote',FIRST,'إرسال عرض الإعلان للعميل'),('payment',SECOND,'تأكيد استلام الدفع'),('publication',THIRD,'نشر الإعلان وبدء المدة')]:
  for change in ('signout','stepdown','revoked','actorchange'):
   ctx,page,errors=context_for(browser,mobile);wait_rows(page)
   row=fill_quote(page) if kind=='quote' else card(page,order)
   if kind=='payment':row.locator('[name=payment_verified]').check()
   page.evaluate('()=>window.__fixture.holdAdMutation=true');row.get_by_role('button',name=button,exact=True).click();wait_js(page,'()=>window.__fixture.pendingAdMutations.length>0');change_access(page,change);page.evaluate('()=>{for(const release of window.__fixture.pendingAdMutations.splice(0))release()}');expect(page.locator('#advertisingAdminPanel')).to_be_hidden();assert page.locator('#advertisingOrderList').inner_text()=='' and not errors,errors;ctx.close()
 # A downgrade before submission prevents the RPC, and failures preserve drafts.
 ctx,page,errors=context_for(browser,mobile);wait_rows(page);first=fill_quote(page);page.evaluate("()=>window.__fixture.aal='aal1'");first.get_by_role('button',name='إرسال عرض الإعلان للعميل',exact=True).click();expect(page.locator('#advertisingAdminPanel')).to_be_hidden();assert page.evaluate("()=>window.__fixture.calls.filter(c=>c.rpc==='quote_advertising_order').length")==0;assert not errors,errors;ctx.close()
 ctx,page,errors=context_for(browser,mobile);wait_rows(page);first=fill_quote(page);page.evaluate('()=>window.__fixture.failAdMutation=true');first.get_by_role('button',name='إرسال عرض الإعلان للعميل',exact=True).click();expect(page.locator('#advertisingAdminStatus')).to_contain_text('تعذر حفظ قرار الإعلان');assert first.locator('[name=quote_amount]').input_value()=='145000' and 'PRIVATE_AD_PROVIDER_SECRET' not in page.content() and not errors,errors;ctx.close()

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for mobile in (False,True):
  scenario(browser,mobile)
  print(('Mobile' if mobile else 'Desktop')+': quote creative/version/total, manual receipt before explicit publication, unchanged pause/resume expiry, terminal records, safe text, pagination and before/after MFA/role/actor checks PASS; fixtures only.')
 browser.close()
