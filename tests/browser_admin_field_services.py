"""Admin quote/payment controls with isolated HTTP/SDK fixtures only.

Uses the production admin/module/CSP. No private account, MFA factor, payment,
production database or model is contacted. Existing admin fixtures are read as
literal source data; this never executes their browser suite on import.
"""
from pathlib import Path
from urllib.parse import urlparse
import ast
import json
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parent.parent
SITE='https://ur-smart.test'
TREE=ast.parse((ROOT/'tests/browser_admin.py').read_text())
BASE=next(ast.literal_eval(node.value) for node in TREE.body if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='MOCK' for target in node.targets))
FIRST='10000000-0000-4000-8000-000000000001'
SECOND='10000000-0000-4000-8000-000000000002'
PAYMENT='10000000-0000-4000-8000-000000000003'
SETUP=r"""
Object.assign(window.__fixture,{holdFieldReads:false,pendingFieldReads:[],holdFieldReview:false,pendingFieldReviews:[],failFieldReview:false,fieldRows:[
 {id:FIRST,owner_id:'customer-one',field_id:'field-one',service_type:'field_report',request_note:'<img src=x onerror=window.__fieldXss=true> تقرير القمح',cadence_days:null,report_count:1,status:'waiting_quote',quote_iqd:null,quote_scope:null,quote_version:0,quoted_at:null,accepted_at:null,payment_reference:null,admin_note:null,approved_at:null,created_at:'2026-10-31T10:00:00Z',updated_at:'2026-10-31T10:00:00Z',completed_reports:0,period_attempts:0,started_at:null,next_due_at:null,run_token:'PRIVATE_FIELD_RUN_TOKEN',result:{secret:'PRIVATE_RAW_FIELD_REPORT'}},
 {id:SECOND,owner_id:'customer-two',field_id:'field-two',service_type:'field_monitoring',request_note:'متابعة الحقل الدوري',cadence_days:7,report_count:3,status:'quoted',quote_iqd:70000,quote_scope:'<script>window.__scopeXss=true</script> متابعة دورية',quote_version:1,quoted_at:'2026-10-31T09:30:00Z',accepted_at:null,payment_reference:null,admin_note:null,approved_at:null,created_at:'2026-10-31T09:00:00Z',updated_at:'2026-10-31T09:30:00Z',completed_reports:0,period_attempts:0,started_at:null,next_due_at:null},
 {id:PAYMENT,owner_id:'customer-three',field_id:'field-three',service_type:'field_monitoring',request_note:'خطة تقارير للحقول',cadence_days:14,report_count:4,status:'awaiting_payment',quote_iqd:90000,quote_scope:'أربعة تقارير بفاصل أربعة عشر يوماً',quote_version:2,quoted_at:'2026-10-31T08:30:00Z',accepted_at:'2026-10-31T08:40:00Z',payment_reference:'PAYMENT-REFERENCE',admin_note:null,approved_at:null,created_at:'2026-10-31T08:00:00Z',updated_at:'2026-10-31T08:40:00Z',completed_reports:0,period_attempts:0,started_at:null,next_due_at:null}
]});
""".replace('FIRST',json.dumps(FIRST)).replace('SECOND',json.dumps(SECOND)).replace('PAYMENT,',json.dumps(PAYMENT)+',')
RPC=r"""
  if(name==='quote_field_service_order'||name==='review_field_service_payment'){
   if(!s.signedIn||!s.role||s.aal!=='aal2')throw Error('Field admin RPC before verified MFA');
   if(s.failFieldReview)return {data:null,error:{message:'PRIVATE_FIELD_PAYMENT_SECRET'}};
   const row=s.fieldRows.find(row=>row.id===input.p_order_id);if(!row)return {data:null,error:{message:'missing'}};
   let result;
   if(name==='quote_field_service_order'){
    if(Object.keys(input).sort().join(',')!=='p_amount_iqd,p_order_id,p_scope'||!Number.isSafeInteger(input.p_amount_iqd)||!input.p_scope)throw Error('Unexpected quote payload');
    if(!['waiting_quote','quoted'].includes(row.status)||row.accepted_at)return {data:null,error:{message:'wrong state'}};
    row.status='quoted';row.quote_iqd=input.p_amount_iqd;row.quote_scope=input.p_scope;row.quote_version++;row.quoted_at='2026-10-31T12:00:00Z';
    result={data:{id:row.id,status:row.status,quote_iqd:row.quote_iqd,quote_scope:row.quote_scope,quote_version:row.quote_version},error:null};
   }else{
    if(Object.keys(input).sort().join(',')!=='p_decision,p_note,p_order_id')throw Error('Unexpected payment payload');
    if(input.p_decision==='approve'&&(!row.accepted_at||row.status!=='awaiting_payment'))throw Error('Approval before customer acceptance');
    row.status=input.p_decision==='approve'?'approved':'rejected';row.approved_at=input.p_decision==='approve'?'2026-10-31T12:01:00Z':null;row.admin_note=input.p_note;
    result={data:{id:row.id,status:row.status,quote_iqd:row.quote_iqd,approved_at:row.approved_at},error:null};
   }
   if(s.holdFieldReview)return new Promise(resolve=>s.pendingFieldReviews.push(()=>resolve(result)));
   return result;
  }
"""
QUERY=r"""
   if(table==='field_service_orders'){
    if(action!=='select'||!s.signedIn||!s.role||s.aal!=='aal2')throw Error('Invalid field admin query');
    if(columns.split(',').includes('*')||/run_token|quoted_by|approved_by|accepted_quote_version|result/.test(columns))throw Error('Unsafe admin field columns');
    const matches=row=>filters.every(f=>f.op==='in'?f.value.includes(row[f.key]):row[f.key]===f.value);
    const data=s.fieldRows.filter(matches).slice(start,start+limit).map(row=>Object.fromEntries(columns.split(',').map(key=>[key,row[key]])));
    const result={data,error:null};if(s.holdFieldReads)return new Promise(resolve=>s.pendingFieldReads.push(()=>resolve(result)));return result;
   }
"""
MOCK=BASE.replace('const user=()=>',SETUP+'\nconst user=()=>').replace("  if(name!=='admin_site_visits')throw Error('Unexpected RPC');",RPC+"  if(name!=='admin_site_visits')throw Error('Unexpected RPC');").replace("   if(!['signup_notifications','research_orders'].includes(table))",QUERY+"   if(!['signup_notifications','research_orders'].includes(table))")


def context_for(browser,mobile,mode='admin'):
 context=browser.new_context(viewport={'width':390 if mobile else 1280,'height':844 if mobile else 900},is_mobile=mobile,has_touch=mobile)
 def route_request(route):
  url=urlparse(route.request.url)
  if url.hostname=='ur-smart.test':
   path=ROOT/url.path.lstrip('/')
   if path.is_file():route.fulfill(body=path.read_bytes(),content_type={'.mjs':'text/javascript','.css':'text/css','.js':'text/javascript'}.get(path.suffix,'text/html'));return
  if url.hostname=='cdn.jsdelivr.net' and '@supabase/supabase-js@2.57.4/' in url.path:
   route.fulfill(body=MOCK.replace('FIXTURE_MODE',json.dumps(mode)).replace('FIXTURE_SECRET',json.dumps('JBSWY3DPEHPK3PXP')),content_type='text/javascript');return
  route.abort('blockedbyclient')
 context.route('**/*',route_request);page=context.new_page();page.set_default_timeout(9000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(SITE+'/admin.html');return context,page,errors


def card(page,order):return page.locator('.field-service-order[data-order-id="'+order+'"]')
def wait_cards(page,count=3):expect(page.locator('#fieldServiceOrderList .field-service-order')).to_have_count(count)
def sign_out(page):page.evaluate("()=>{window.__fixture.signedIn=false;for(const callback of [...window.__fixture.listeners])callback('SIGNED_OUT',null)}")


def scenario(browser,mobile):
 for mode in ('anon','ordinary','challenge'):
  ctx,page,errors=context_for(browser,mobile,mode)
  page.wait_for_function("()=>!!window.__fixture")
  expect(page.locator('#fieldServiceAdminPanel')).to_be_hidden()
  assert page.evaluate("()=>window.__fixture.calls.filter(x=>x.table==='field_service_orders'||x.rpc==='quote_field_service_order'||x.rpc==='review_field_service_payment').length")==0
  assert not errors,errors;ctx.close()
 ctx,page,errors=context_for(browser,mobile)
 wait_cards(page);expect(page.locator('#fieldServiceAdminPanel')).to_be_visible()
 visible=page.locator('#fieldServiceOrderList').inner_text()
 assert '<img src=x' in visible and '<script>' in visible
 assert page.locator('#fieldServiceOrderList img,#fieldServiceOrderList script').count()==0
 assert page.evaluate('()=>window.__fieldXss') is None and page.evaluate('()=>window.__scopeXss') is None
 assert 'PRIVATE_FIELD_RUN_TOKEN' not in page.content() and 'PRIVATE_RAW_FIELD_REPORT' not in page.content()
 first=card(page,FIRST);first.locator('[name=quote_amount]').fill('45000');first.locator('[name=quote_scope]').fill('تقرير واحد يجمع المشاهد المتاحة والطقس مع تواريخ المصادر')
 page.select_option('#fieldServiceOrderFilter','all');assert page.locator('#fieldServiceOrderFilter').input_value()=='open'
 first.get_by_role('button',name='إرسال عرض السعر للعميل',exact=True).click()
 page.wait_for_function("()=>window.__fixture.calls.some(x=>x.rpc==='quote_field_service_order')")
 expect(page.locator('#fieldServiceAdminStatus')).to_contain_text('ينتظر قبول العميل')
 payload=page.evaluate("()=>window.__fixture.calls.find(x=>x.rpc==='quote_field_service_order').input")
 assert payload=={'p_order_id':FIRST,'p_amount_iqd':45000,'p_scope':'تقرير واحد يجمع المشاهد المتاحة والطقس مع تواريخ المصادر'}
 assert card(page,FIRST).locator('[name=payment_verified]').count()==0
 payment=card(page,PAYMENT);before=page.evaluate("()=>window.__fixture.calls.filter(x=>x.rpc==='review_field_service_payment').length")
 assert payment.locator('[name=quote_amount],[name=quote_scope]').count()==0
 assert '٩٠٬٠٠٠ دينار عراقي' in payment.locator('.payment-check').inner_text()
 payment.locator('form').evaluate('form=>form.requestSubmit()');page.wait_for_timeout(80)
 assert page.evaluate("()=>window.__fixture.calls.filter(x=>x.rpc==='review_field_service_payment').length")==before
 payment.locator('[name=payment_verified]').check();payment.locator('[name=admin_note]').fill('تحققت من مرجع الاستلام وقبول النطاق')
 payment.get_by_role('button',name='تأكيد الدفع والسماح بالتنفيذ',exact=True).click()
 expect(page.locator('#fieldServiceAdminStatus')).to_contain_text('تم تأكيد الدفع')
 assert card(page,PAYMENT).count()==0
 payload=page.evaluate("()=>window.__fixture.calls.filter(x=>x.rpc==='review_field_service_payment').at(-1).input")
 assert payload=={'p_order_id':PAYMENT,'p_decision':'approve','p_note':'تحققت من مرجع الاستلام وقبول النطاق'}
 # A late row-read cannot restore customer metadata after sign-out.
 page.evaluate('()=>window.__fixture.holdFieldReads=true');page.click('#refreshFieldServiceOrders')
 page.wait_for_function('()=>window.__fixture.pendingFieldReads.length>0');sign_out(page)
 expect(page.locator('#fieldServiceAdminPanel')).to_be_hidden();assert page.locator('#fieldServiceOrderList').inner_text()==''
 page.evaluate('()=>{for(const release of window.__fixture.pendingFieldReads.splice(0))release()}');page.wait_for_timeout(100)
 assert page.locator('#fieldServiceOrderList').inner_text()==''
 assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1')
 assert not errors,errors;ctx.close()
 # AAL downgrade before an intended mutation clears data and prevents its RPC.
 ctx,page,errors=context_for(browser,mobile);wait_cards(page);first=card(page,FIRST)
 first.locator('[name=quote_amount]').fill('40000');first.locator('[name=quote_scope]').fill('نطاق جديد')
 page.evaluate("()=>window.__fixture.aal='aal1'");first.get_by_role('button',name='إرسال عرض السعر للعميل',exact=True).click()
 expect(page.locator('#fieldServiceAdminPanel')).to_be_hidden()
 assert page.evaluate("()=>window.__fixture.calls.filter(x=>x.rpc==='quote_field_service_order').length")==0
 assert page.locator('#fieldServiceOrderList').inner_text()=='';assert not errors,errors;ctx.close()
 # A deleted field retains the financial record without an offer/approval path.
 ctx,page,errors=context_for(browser,mobile);wait_cards(page)
 page.evaluate("""()=>{
  const s=window.__fixture;
  s.fieldRows.push({...s.fieldRows[0],id:'deleted-quote',field_id:null});
  s.fieldRows.push({...s.fieldRows[2],id:'deleted-payment',field_id:null});
 }""")
 page.click('#refreshFieldServiceOrders');wait_cards(page,5)
 for deleted in ('deleted-quote','deleted-payment'):
  missing=card(page,deleted)
  expect(missing).to_contain_text('الحقل غير متاح')
  assert missing.locator('[name=quote_amount],[name=quote_scope],[name=payment_verified]').count()==0
  assert missing.get_by_role('button',name='تأكيد الدفع والسماح بالتنفيذ',exact=True).count()==0
  assert missing.get_by_role('button',name='رفض الطلب',exact=True).count()==1
 card(page,'deleted-payment').get_by_role('button',name='رفض الطلب',exact=True).click()
 expect(page.locator('#fieldServiceAdminStatus')).to_contain_text('تم رفض الطلب')
 assert card(page,'deleted-payment').count()==0
 assert not errors,errors;ctx.close()
 # Access is rechecked after a held response; an MFA/allowlist change clears
 # both the prior rows and the just-returned customer metadata.
 for access_change in ("window.__fixture.aal='aal1'",'window.__fixture.role=false'):
  ctx,page,errors=context_for(browser,mobile);wait_cards(page)
  page.evaluate('()=>window.__fixture.holdFieldReads=true');page.click('#refreshFieldServiceOrders')
  page.wait_for_function('()=>window.__fixture.pendingFieldReads.length>0')
  page.evaluate('()=>{'+access_change+';for(const release of window.__fixture.pendingFieldReads.splice(0))release()}')
  expect(page.locator('#fieldServiceAdminPanel')).to_be_hidden()
  assert page.locator('#fieldServiceOrderList').inner_text()==''
  assert not errors,errors;ctx.close()
 # A completed server mutation can return after sign-out or assurance stepdown.
 # Its response must never restore the old account's rows or draft controls.
 for access_change in ('signout','stepdown'):
  ctx,page,errors=context_for(browser,mobile);wait_cards(page)
  payment=card(page,PAYMENT);payment.locator('[name=payment_verified]').check()
  payment.locator('[name=admin_note]').fill('TEST-DRAFT-TO-CLEAR')
  page.evaluate('()=>window.__fixture.holdFieldReview=true')
  payment.get_by_role('button',name='تأكيد الدفع والسماح بالتنفيذ',exact=True).click()
  page.wait_for_function('()=>window.__fixture.pendingFieldReviews.length>0')
  if access_change=='signout':sign_out(page)
  else:page.evaluate("()=>window.__fixture.aal='aal1'")
  page.evaluate('()=>{for(const release of window.__fixture.pendingFieldReviews.splice(0))release()}')
  expect(page.locator('#fieldServiceAdminPanel')).to_be_hidden()
  assert page.locator('#fieldServiceOrderList').inner_text()==''
  assert 'TEST-DRAFT-TO-CLEAR' not in page.content()
  assert not errors,errors;ctx.close()


with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for mobile in (False,True):
  scenario(browser,mobile)
  print(('Mobile' if mobile else 'Desktop')+': admin allowlist/MFA before and after reads/writes, quoted amount/scope, immutable accepted quotes, checked payment approval, deleted fields, exact RPC arguments, draft preservation, safe text and stale/downgraded-session cleanup passed; fixtures only.')
 browser.close()
