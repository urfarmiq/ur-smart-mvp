import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../satellite-analysis.html',import.meta.url),'utf8');
const helpers=html.slice(html.indexOf('const numberOrNaN='),html.indexOf('let analysisRequestGeneration='));

test('satellite readings preserve missing data and genuine zero from either response shape',()=>{
 const context=vm.createContext({});vm.runInContext(helpers,context);
 for(const value of [null,undefined,'',false])assert.equal(context.formatSceneIndex({indices:{NDMI:value}},'NDMI'),'غير متاح');
 assert.equal(context.formatSceneIndex({indices:{NDMI:0}},'NDMI'),'0.000');
 assert.equal(context.formatSceneIndex({ndmi:.12},'NDMI'),'0.120');
 assert.equal(context.formatSceneIndex({indices:{NDMI:null},ndmi:.12},'NDMI'),'غير متاح');
});

test('saved recommendation uses scene indices, never fabricates missing moisture, and labels data completeness',async()=>{
 let saved;
 const button={disabled:false,textContent:''};
 const context=vm.createContext({saveRecommendation:button,currentRecommendation:{crop:'حنطة',scene:{date:'2026-10-25',indices:{NDVI:0,NDMI:null}},weather:{rain_mm_7d:null},reasons:['بيانات ناقصة'],advice:'افحص الجذور',score:40},fieldId:'selected-field',user:{id:'owner'},option:{dataset:{farmId:'farm'}},client:{from:()=>({insert:async record=>{saved=record;return {error:null};}})},setTimeout:()=>0});
 vm.runInContext(helpers+html.slice(html.indexOf('saveRecommendation.onclick='),html.indexOf(' mapButton.onclick=')),context);
 await button.onclick();
 assert.equal(saved.field_id,'selected-field');assert.equal(saved.soil_moisture,null);
 assert.match(saved.plant_symptoms,/NDVI 0\.000; NDMI غير متاح/);
 assert.match(saved.confidence,/اكتمال وحداثة البيانات/);assert.match(saved.confidence,/ليس تقديرًا لدقة/);
 assert.equal(button.disabled,false);assert.match(button.textContent,/حُفظت/);
});
