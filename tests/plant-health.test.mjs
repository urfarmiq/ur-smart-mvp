import test from 'node:test';
import assert from 'node:assert/strict';
import {handlePlantHealth,plantHealthStatus,validatePlantHealthInput,sanitizePlantHealthAssessment} from '../satellite-backend/plant-health.mjs';
const PNG="iVBORw0KGgoAAAANSUhEUgAAAIAAAABgCAIAAABaGO0eAAAAI3RFWHRwcml2YXRlAEdQUy1QRVJTT05BTC1ETy1OT1QtRk9SV0FSRJq/chgAAADsSURBVHic7dExDQAgAMAwwA4a8IV8ZPRgVbBkc98z4iwd8LsGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYA7AERKQGgzQXIQgAAAABJRU5ErkJggg==";
const JPEG="/9j/4AAQSkZJRgABAQAAAQABAAD/4QA+RXhpZgAATU0AKgAAAAgAAQEOAAIAAAAcAAAAGgAAAABHUFMtUEVSU09OQUwtRE8tTk9ULUZPUldBUkQA/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAYACAAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A5miiiuA8EKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/9k=";
const ENV={SUPABASE_URL:'https://supabase.test',SUPABASE_PUBLISHABLE_KEY:'public',GEMINI_API_KEY:'private-provider-key-not-forwarded',GEMINI_FREE_TIER_CONFIRMED:'true'};
const assessment={image_quality:'usable',plant_visible:true,summary:'بقع ظاهرة تحتاج إلى فحص ميداني للتمييز بين الأسباب.',observations:['بقع بنية على نصل الورقة'],possible_causes:[{name:'تبقع ورقي محتمل',category:'disease',supporting_signs:['حواف بقع ظاهرة'],distinguishing_checks:['قارن بين سطحي الورقة وافحص انتشار البقع']}],missing_information:['مدة ظهور الأعراض'],initial_steps:['افحص رطوبة منطقة الجذور وتصريف الماء قبل تغيير الري'],expert_review:['راجع مهندساً إذا انتشرت الأعراض سريعاً'],limitations:['الصورة وحدها لا تؤكد المرض']};
const input=(overrides={})=>({crop:'حنطة',symptoms:'بقع واصفرار',duration:'منذ عدة أيام',region:'بغداد',recent_care:'ري اعتيادي',consent:true,images:[{mime_type:'image/jpeg',data:JPEG,width:128,height:96}],...overrides});
const request=(body=input(),headers={},method='POST')=>new Request('https://worker.test/plant-health',{method,headers:{Authorization:'Bearer fixture-session-token','Content-Type':'application/json',...headers},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
let sequence=0;
const userId=()=>`aaaaaaaa-aaaa-4aaa-8aaa-${(++sequence).toString(16).padStart(12,'0')}`;
async function mocked(run,{authStatus=200,anonymous=false,user=userId(),upstreamStatus=200,modelOutput=assessment,finishReason='STOP',thought=false,networkError=false,authError=false}={}){
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options={})=>{
  const href=String(url);calls.push({url:href,options});
  if(href.endsWith('/auth/v1/user')){if(authError)throw Error(ENV.GEMINI_API_KEY);return json({id:user,is_anonymous:anonymous,email:'private-customer@example.test',user_metadata:{role:'admin'}},authStatus);}
  if(href.startsWith('https://generativelanguage.googleapis.com/')){
   if(networkError)throw Error(ENV.GEMINI_API_KEY);
   if(upstreamStatus!==200)return json({error:{message:ENV.GEMINI_API_KEY}},upstreamStatus);
   return json({candidates:[{finishReason,content:{parts:[...(thought?[{thought:true,text:'PRIVATE_INTERNAL_THOUGHT'}]:[]),{text:typeof modelOutput==='string'?modelOutput:JSON.stringify(modelOutput)}]}}]});
  }
  throw Error('Unexpected upstream '+href);
 };
 try{return await run(calls);}finally{globalThis.fetch=original;}
}

test('plant status reuses configured free-only model gate without disclosing keys',()=>{
 const status=plantHealthStatus(ENV);assert.equal(status.available,true);assert.equal(status.preliminary_only,true);assert.equal(status.images_stored_by_platform,false);assert.equal(status.limits.max_images,3);assert.equal(status.limits.max_dimension,1600);
 assert.equal(plantHealthStatus({...ENV,GEMINI_FREE_TIER_CONFIRMED:'false'}).available,false);assert.equal(plantHealthStatus({...ENV,GEMINI_MODEL:'paid-pro-model'}).available,false);assert.ok(!JSON.stringify(status).includes(ENV.GEMINI_API_KEY));assert.match(status.quota_note,/ليست حداً عالمياً/);
});
test('valid images retain pixels/dimensions while JPEG EXIF and PNG text metadata are stripped',()=>{
 for(const [mime,data] of [['image/jpeg',JPEG],['image/png',PNG]]){
  const result=validatePlantHealthInput(input({images:[{mime_type:mime,data,width:128,height:96}]}));
  assert.equal(result.images[0].width,128);assert.equal(result.images[0].height,96);assert.equal(result.images[0].mime_type,mime);
  assert.ok(!Buffer.from(result.images[0].data,'base64').includes(Buffer.from('GPS-PERSONAL-DO-NOT-FORWARD')));
  assert.notEqual(result.images[0].data,data);assert.ok(Buffer.from(result.images[0].data,'base64').length>50);
 }
});
test('request validation rejects missing consent/context, unsupported data and forged image dimensions',()=>{
 const invalid=[{consent:false},{crop:''},{crop:'x'.repeat(101)},{symptoms:''},{duration:'x'.repeat(121)},{duration:12},{access_token:'should not be forwarded'},{images:[]},{images:Array(4).fill({mime_type:'image/jpeg',data:JPEG})},{images:[{mime_type:'image/jpeg',data:JPEG,width:129}]},{images:[{mime_type:'image/png',data:JPEG}]},{images:[{mime_type:'image/svg+xml',data:btoa('<svg/>')}]},{images:[{mime_type:'image/jpeg',data:JPEG,filename:'private.jpg'}]},{images:[{mime_type:'image/jpeg',data:JPEG+'\n'}]},{images:[{mime_type:'image/jpeg',data:JPEG.slice(0,-8)}]}];
 for(const change of invalid)assert.throws(()=>validatePlantHealthInput(input(change)),undefined,JSON.stringify(change).slice(0,100));
 const raw=Buffer.from(PNG,'base64');raw.writeUInt32BE(1700,16);assert.throws(()=>validatePlantHealthInput(input({images:[{mime_type:'image/png',data:raw.toString('base64')}]})));
 const badCRC=Buffer.from(PNG,'base64');badCRC[29]^=1;assert.throws(()=>validatePlantHealthInput(input({images:[{mime_type:'image/png',data:badCRC.toString('base64')}]})));
 const trailing=Buffer.concat([Buffer.from(JPEG,'base64'),Buffer.from('hidden')]);assert.throws(()=>validatePlantHealthInput(input({images:[{mime_type:'image/jpeg',data:trailing.toString('base64')}]})));
});
test('image and overall request byte limits reject oversized input before a provider call',async()=>{
 const size=plantHealthStatus(ENV).limits.max_image_bytes;
 assert.throws(()=>validatePlantHealthInput(input({images:[{mime_type:'image/jpeg',data:'A'.repeat(4*Math.ceil((size+4)/3))}]})));
 await mocked(async calls=>{const response=await handlePlantHealth(request(input(),{'content-length':String(plantHealthStatus(ENV).limits.max_request_bytes+1)}),ENV);assert.equal(response.status,413);assert.equal(calls.length,1);});
});
test('auth, origin, method and free-tier gates stop images before Google',async()=>{
 await mocked(async calls=>{
  assert.equal((await handlePlantHealth(request(input(),{},'GET'),ENV)).status,405);
  assert.equal((await handlePlantHealth(request(input(),{Origin:'https://attacker.test'}),ENV)).status,403);
  assert.equal((await handlePlantHealth(request(),{...ENV,GEMINI_FREE_TIER_CONFIRMED:'false'})).status,503);
  assert.equal((await handlePlantHealth(request(input(),{Authorization:''}),ENV)).status,401);assert.equal(calls.length,0);
 });
 for(const options of [{authStatus:401},{anonymous:true}])await mocked(async calls=>{const response=await handlePlantHealth(request(),ENV);assert.equal(response.status,401);assert.equal(calls.length,1);},options);
 for(const options of [{authStatus:503},{authError:true}])await mocked(async calls=>{const response=await handlePlantHealth(request(),ENV);assert.equal(response.status,502);assert.equal((await response.json()).code,'AUTH_UNAVAILABLE');assert.equal(calls.length,1);},options);
});
test('authenticated multimodal request forwards only sanitized images and bounded farmer context',async()=>{
 await mocked(async calls=>{
  const response=await handlePlantHealth(request(),ENV);assert.equal(response.status,200);const result=await response.json();assert.deepEqual(result.assessment,assessment);assert.equal(result.provider,'Google Gemini');
  const provider=calls.find(row=>row.url.includes('googleapis'));assert.ok(provider);assert.equal(calls.length,2);assert.ok(!provider.url.includes(ENV.GEMINI_API_KEY));assert.equal(provider.options.headers['x-goog-api-key'],ENV.GEMINI_API_KEY);
  const sent=JSON.parse(provider.options.body);assert.equal(sent.contents[0].parts.length,2);assert.equal(sent.contents[0].parts[1].inlineData.mimeType,'image/jpeg');assert.equal(sent.tools,undefined);assert.equal(sent.generationConfig.responseMimeType,'application/json');assert.ok(sent.generationConfig.responseSchema.required.includes('possible_causes'));
  const forwarded=JSON.parse(sent.contents[0].parts[0].text);assert.equal(forwarded.farmer_reported_context.crop,'حنطة');assert.equal(forwarded.image_count,1);
  for(const privateValue of ['fixture-session-token','private-customer@example.test',ENV.GEMINI_API_KEY,'GPS-PERSONAL-DO-NOT-FORWARD'])assert.ok(!provider.options.body.includes(privateValue));
  assert.ok(!Buffer.from(sent.contents[0].parts[1].inlineData.data,'base64').includes(Buffer.from('GPS-PERSONAL-DO-NOT-FORWARD')));
  assert.equal(response.headers.get('cache-control'),'no-store');
 },{thought:true});
});
test('model quality/nonplant/absent evidence abstains without a fabricated diagnosis',()=>{
 for(const overrides of [{plant_visible:false},{image_quality:'unusable'},{observations:[]}]){
  const result=sanitizePlantHealthAssessment({...assessment,...overrides});assert.equal(result.image_quality,'unusable');assert.deepEqual(result.possible_causes,[]);assert.match(result.summary,/غير كافية/);assert.match(result.initial_steps[0],/صورة/);
 }
 const healthy=sanitizePlantHealthAssessment({...assessment,summary:'لا تظهر علامات مرض واضحة في الصور المتاحة.',possible_causes:[]});assert.deepEqual(healthy.possible_causes,[]);
});
test('numeric certainty, definite diagnosis, pesticide doses and positive spray prescriptions are rejected',()=>{
 for(const line of ['تشخيص مؤكد','احتمال المرض 95%','الثقة ٠٫٩','استخدم محلولاً بجرعة 2 mg/L','طبّق المعالجة بجرعة ٢ سم لكل لتر.','رش أزوكسيستروبين بجرعة ٢ سم لكل لتر.','استخدم مانكوزيب','رش مادة جديدة الآن'])assert.throws(()=>sanitizePlantHealthAssessment({...assessment,initial_steps:[line]}),undefined,line);
 assert.doesNotThrow(()=>sanitizePlantHealthAssessment({...assessment,initial_steps:['تجنب الرش بالمبيد قبل فحص مختص','لا ترش أي محلول قبل مراجعة مختص']}));
 for(const change of [{confidence:95},{image_quality:'perfect'},{possible_causes:[{name:'disease',category:'certain',supporting_signs:[],distinguishing_checks:[]}]},{initial_steps:Array(5).fill('فحص')}])assert.throws(()=>sanitizePlantHealthAssessment({...assessment,...change}));
});
test('quota/provider/configuration failures stay safe and never activate a fallback',async()=>{
 for(const [upstreamStatus,status,code] of [[429,429,'FREE_QUOTA_EXHAUSTED'],[403,502,'GEMINI_KEY_REJECTED'],[500,502,'GEMINI_UPSTREAM_ERROR']])await mocked(async calls=>{const response=await handlePlantHealth(request(),ENV);assert.equal(response.status,status);const body=await response.json();assert.equal(body.code,code);assert.ok(!JSON.stringify(body).includes(ENV.GEMINI_API_KEY));assert.equal(calls.filter(row=>row.url.includes('googleapis')).length,1);},{upstreamStatus});
 await mocked(async()=>{const response=await handlePlantHealth(request(),ENV);assert.equal(response.status,502);assert.ok(!(await response.text()).includes(ENV.GEMINI_API_KEY));},{networkError:true});
});
test('truncated, thought-only, unsafe and malformed model responses are not returned as successful reports',async()=>{
 for(const options of [{modelOutput:'not JSON'},{modelOutput:{summary:'only one field'}},{finishReason:'MAX_TOKENS'},{modelOutput:{...assessment,initial_steps:['استخدم بجرعة 5 ml/l']}}])await mocked(async()=>{const response=await handlePlantHealth(request(),ENV);assert.equal(response.status,502);assert.equal((await response.json()).code,'GEMINI_INVALID_OUTPUT');},options);
});
test('warm-instance cooldown avoids duplicate model requests for the same account',async()=>{
 await mocked(async calls=>{assert.equal((await handlePlantHealth(request(),ENV)).status,200);const response=await handlePlantHealth(request(),ENV);assert.equal(response.status,429);const body=await response.json();assert.equal(body.code,'PLANT_HEALTH_BUSY');assert.ok(body.retry_after_seconds>0&&body.retry_after_seconds<=60);assert.equal(calls.filter(row=>row.url.includes('googleapis')).length,1);});
});
test('warm user-day quota remains bounded after cooldowns and resets on the next UTC day',async()=>{
 const original=Date.now;let now=Date.parse('2030-01-01T01:00:00Z');Date.now=()=>now;
 try{await mocked(async calls=>{for(let index=0;index<5;index++){assert.equal((await handlePlantHealth(request(),ENV)).status,200);now+=61000;}assert.equal((await handlePlantHealth(request(),ENV)).status,429);assert.equal(calls.filter(row=>row.url.includes('googleapis')).length,5);now+=86400000;assert.equal((await handlePlantHealth(request(),ENV)).status,200);});}finally{Date.now=original;}
});
