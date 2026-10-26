import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareGeminiReport,parseGeminiRecommendation,geminiErrorMessage,requestGeminiAdvice,createGeminiAdvisor} from '../gemini-advisor-ui.mjs';
const fieldId='11111111-1111-4111-8111-111111111111';
const report={field:{name:'private-name',id:'private-id',crop:'حنطة',area_donum:4,soil:'طينية'},satellite:{date:'2026-10-20',indices:{NDVI:.5,NDMI:null},geometry:{secret:'coordinates'}},weather:{summary:{past_rain_mm:0,forecast_rain_mm:null},daily:[]},irrigation_logs:[],observations:{notes:'ملاحظة ميدانية'},access_token:'private-token'};
const response={provider:'Google Gemini',model:'free-model',generated_at:'2026-10-25T12:00:00Z',recommendation:{summary:'فحص رطوبة الجذور أولًا',evidence:['NDVI مسجل'],missing_data:['تحليل التربة'],irrigation:['فحص ميداني'],fertilization:[],follow_up:[],limitations:['إرشادي']}};
test('request report excludes automatic names, IDs, geometry and secrets; missing values stay missing',()=>{
 const clean=prepareGeminiReport(report),serialized=JSON.stringify(clean);
 assert.ok(!serialized.includes('private-'));assert.ok(!serialized.includes('coordinates'));assert.equal(clean.satellite.indices.NDMI,null);assert.equal(clean.weather.summary.past_rain_mm,0);assert.equal(clean.weather.summary.forecast_rain_mm,null);assert.equal(clean.observations.notes,'ملاحظة ميدانية');
});
test('response schema rejects malformed model answers and never treats arbitrary HTML as markup',()=>{
 const parsed=parseGeminiRecommendation(response);assert.equal(parsed.recommendation.summary,response.recommendation.summary);
 assert.throws(()=>parseGeminiRecommendation({recommendation:{summary:''}}));assert.throws(()=>parseGeminiRecommendation({...response,recommendation:{...response.recommendation,evidence:[{}]}}));
 const html=parseGeminiRecommendation({...response,recommendation:{...response.recommendation,summary:'<img src=x onerror=alert(1)>'}});assert.equal(html.recommendation.summary,'<img src=x onerror=alert(1)>');
});
test('calls only configured Worker using user bearer and sanitized reviewed report',async()=>{
 let called=0;
 const result=await requestGeminiAdvice({endpoint:'https://example.workers.dev',fieldId,report,session:{access_token:'session-only'},fetchImpl:async(url,options)=>{called++;assert.equal(url,'https://example.workers.dev/advice');assert.equal(options.headers.Authorization,'Bearer session-only');const body=JSON.parse(options.body);assert.equal(body.action,'advice');assert.equal(body.field_id,fieldId);assert.equal(body.consent,true);assert.ok(!JSON.stringify(body.report).includes('private-'));return new Response(JSON.stringify(response),{status:200});}});
 assert.equal(called,1);assert.equal(result.provider,'Google Gemini');
});
test('authentication and saved-field validation prevent outbound requests',async()=>{
 let called=false;const fetchImpl=async()=>{called=true;};
 await assert.rejects(requestGeminiAdvice({endpoint:'https://example.workers.dev',fieldId:'bad',report,session:{access_token:'x'},fetchImpl}));
 await assert.rejects(requestGeminiAdvice({endpoint:'https://example.workers.dev',fieldId,report,session:null,fetchImpl}));assert.equal(called,false);
});
test('free quota, setup and invalid JSON produce useful errors with no paid fallback',async()=>{
 assert.match(geminiErrorMessage(429,'FREE_QUOTA_EXHAUSTED'),/لن ننتقل تلقائيًا/);assert.match(geminiErrorMessage(503,'GEMINI_SETUP_REQUIRED'),/الخطة المجانية/);
 const args={endpoint:'https://example.workers.dev',fieldId,report,session:{access_token:'x'}};
 await assert.rejects(requestGeminiAdvice({...args,fetchImpl:async()=>new Response(JSON.stringify({code:'FREE_QUOTA_EXHAUSTED'}),{status:429})}),/حد الاستخدام المجاني/);
 await assert.rejects(requestGeminiAdvice({...args,fetchImpl:async()=>new Response('not-json',{status:200})}),/توصية صالحة/);
});

test('field A to B to A invalidation suppresses the old response even when field and date match again',async()=>{
 class Element{
  constructor(tag){this.tagName=tag;this.textContent='';this.children=[];this.style={};this.value='';this.checked=false;this.isConnected=true;}
  setAttribute(){}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;this.textContent='';}
 }
 const find=(root,predicate)=>predicate(root)?root:root.children?.filter(node=>typeof node==='object').map(node=>find(node,predicate)).find(Boolean);
 const previousDocument=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
 let selected=fieldId,resolveAdvice,markIssued;
 const issued=new Promise(resolve=>markIssued=resolve),pendingAdvice=new Promise(resolve=>resolveAdvice=resolve);
 try{
  const section=createGeminiAdvisor({endpoint:'https://example.workers.dev',getContext:()=>({fieldId:selected,report}),getSession:async()=>({access_token:'test-only'}),fetchImpl:async url=>{
   if(url.endsWith('/status'))return new Response(JSON.stringify({available:true}));
   markIssued();return pendingAdvice;
  }});
  await new Promise(resolve=>setImmediate(resolve));
  const prepare=find(section,node=>node.textContent==='مراجعة البيانات قبل إرسالها إلى Gemini'),send=find(section,node=>node.textContent==='طلب توصية Gemini'),consent=find(section,node=>node.tagName==='input'),result=find(section,node=>node.className==='gemini-result'),preview=find(section,node=>node.className==='gemini-preview');
  prepare.onclick();consent.checked=true;consent.onchange();assert.equal(send.disabled,false);
  const sending=send.onclick();await issued;
  selected='22222222-2222-4222-8222-222222222222';section.invalidateContext();
  selected=fieldId;section.invalidateContext();
  resolveAdvice(new Response(JSON.stringify(response)));await sending;
  assert.equal(result.children.length,0);assert.equal(preview.value,'');assert.equal(consent.checked,false);assert.equal(send.disabled,true);
  const status=find(section,node=>node.className==='gemini-status');assert.match(status.textContent,/لم تُعرض التوصية القديمة/);
 }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
});
