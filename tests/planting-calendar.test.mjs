import test from 'node:test';
import assert from 'node:assert/strict';
import {MONTHS,PROVINCES,provinceLookup,formatMonth,getIraqMonth,normalizeArabicQuery,validateCalendarData,getPlantingMatches,groupByCrop,getYearAvailability} from '../planting-calendar-core.mjs';

const source={id:'university',title:'مصدر جامعي اختباري',url:'https://university.edu.iq/calendar.pdf'};
const row=extra=>({id:'winter-reference',cropId:'spinach',cropName:'سبانخ',aliases:['إسفاناخ'],category:'vegetable',season:'winter',method:'open',operation:'sow',months:[9,10,11,12,1,2],zones:[],periodLabel:'أيلول إلى شباط — مرجع اختباري',notes:['هذا سجل اصطناعي لا يمثل توصية زراعية.'],sourceIds:['university'],...extra});
const errorCode=code=>error=>error?.code===code;

test('Iraqi month labels and all nineteen governorates use stable lookup codes',()=>{
 assert.equal(MONTHS.length,12);assert.equal(formatMonth(11),'تشرين الثاني');assert.equal(formatMonth(12),'كانون الأول');
 assert.equal(PROVINCES.length,20);assert.equal(provinceLookup('halabja').zone,'north');assert.equal(provinceLookup('wasit').zone,'center');assert.equal(provinceLookup('basra').zone,'south');assert.equal(provinceLookup('unknown'),null);
 assert.throws(()=>formatMonth('11'),errorCode('INVALID_CALENDAR_FILTER'));
});

test('the current month follows Baghdad at UTC boundaries and validates supplied dates',()=>{
 assert.equal(getIraqMonth('2026-10-31T20:59:59Z'),10);assert.equal(getIraqMonth('2026-10-31T21:00:00Z'),11);
 assert.equal(getIraqMonth(new Date('2026-12-31T21:05:00Z')),1);assert.equal(getIraqMonth(Date.parse('2026-11-30T21:00:00Z')),12);
 for(const value of ['invalid',null,true,{},NaN])assert.throws(()=>getIraqMonth(value),errorCode('INVALID_CALENDAR_DATE'));
});

test('Arabic search handles harakat, tatweel, letter variants and Iraqi crop aliases',()=>{
 assert.equal(normalizeArabicQuery('  إِسْفَانـاخ  '),'اسفاناخ');assert.equal(normalizeArabicQuery('فاصوليّة'),'فاصوليه');
 const rows=[row({cropId:'wheat',cropName:'حنطة',aliases:['قمح','حِنْطَة']})];
 assert.equal(getPlantingMatches(rows,{month:11,query:'قَمْح'}).length,1);
 assert.equal(getPlantingMatches(rows,{month:11,query:'حِنْطَه'}).length,1);
 assert.deepEqual(getPlantingMatches(rows,{month:11,query:'خيار'}),[]);
});

test('December-to-February windows use only the explicitly listed recurring months',()=>{
 const rows=[row()];for(const month of [9,12,1,2])assert.equal(getPlantingMatches(rows,{month}).length,1);
 for(const month of [3,8])assert.deepEqual(getPlantingMatches(rows,{month}),[]);
 assert.equal(getPlantingMatches(rows,{month:12})[0].periodLabel,rows[0].periodLabel);
});

test('unspecified references stay labelled references and regional dates never shift automatically',()=>{
 const rows=[row(),row({id:'national',cropId:'barley',cropName:'شعير',category:'field',zones:['all']}),row({id:'north',cropId:'courgette',cropName:'كوسة',months:[4],zones:['north']})];
 assert.deepEqual(getPlantingMatches(rows,{month:11,province:'wasit'}).map(r=>r.applicability),['general_reference','national']);
 assert.equal(getPlantingMatches(rows,{month:4,province:'nineveh'})[0].applicability,'regional');
 assert.equal(getPlantingMatches(rows,{month:4,province:'wasit'}).length,0);
 assert.equal(getPlantingMatches(rows,{month:3,province:'nineveh'}).length,0);
 assert.equal(getPlantingMatches(rows,{month:4,province:'all'}).length,1);
});

test('exact province scopes cannot leak to another governorate or become national validation',()=>{
 const rows=[row({provinceCodes:['wasit']})];
 assert.equal(getPlantingMatches(rows,{month:11,province:'wasit'})[0].applicability,'regional');
 assert.equal(getPlantingMatches(rows,{month:11,province:'all'}).length,1);
 assert.deepEqual(getPlantingMatches(rows,{month:11,province:'baghdad'}),[]);
 assert.throws(()=>validateCalendarData([row({zones:['all'],provinceCodes:['wasit']})],[source]),errorCode('INVALID_CALENDAR_DATA'));
});

test('crop category, season, system and operation remain separate from month membership',()=>{
 const rows=[row(),row({id:'greenhouse',cropId:'cucumber',cropName:'خيار',season:'autumn',method:'protected',operation:'sow',months:[11]}),row({id:'nursery',cropId:'tomato',cropName:'طماطة',method:'nursery',operation:'nursery_sow',months:[11]})];
 const matches=getPlantingMatches(rows,{month:11,method:'protected',season:'autumn',category:'vegetable'});
 assert.equal(matches.length,1);assert.equal(matches[0].cropId,'cucumber');assert.equal(matches[0].operation,'sow');
 assert.equal(getPlantingMatches(rows,{month:11,method:'nursery'})[0].operation,'nursery_sow');
 assert.deepEqual(getPlantingMatches(rows,{month:11,category:'field'}),[]);
});

test('invalid filters fail closed rather than silently recommending all crops',()=>{
 for(const filters of [{month:0},{month:13},{month:'11'},{month:11,province:'fake'},{month:11,province:null},{month:11,method:null},{month:11,region:'north'},{month:11,method:'harvest'},{month:11,category:'whatever'},{month:11,season:'anytime'},{month:11,cropId:'missing'},{month:11,query:{}},{month:11,query:'a'.repeat(301)}])assert.throws(()=>getPlantingMatches([row()],filters),errorCode('INVALID_CALENDAR_FILTER'));
 assert.throws(()=>getPlantingMatches([row()],null),errorCode('INVALID_CALENDAR_FILTER'));
 assert.deepEqual(getPlantingMatches([],{month:11}),[]);
});

test('a source with unspecified cover is never silently promoted to open-field or protected advice',()=>{
 const rows=[row({method:'unspecified'})];
 assert.equal(getPlantingMatches(rows,{month:11})[0].applicability,'general_reference');
 assert.equal(getPlantingMatches(rows,{month:11,method:'unspecified'}).length,1);
 assert.deepEqual(getPlantingMatches(rows,{month:11,method:'open'}),[]);
 assert.deepEqual(getPlantingMatches(rows,{month:11,method:'protected'}),[]);
});

test('year views count unique crops rather than multiple stages or sources of the same crop',()=>{
 const rows=[row(),row({id:'nursery',method:'nursery',operation:'nursery_sow',months:[11]}),row({id:'other',cropId:'bean',cropName:'باقلاء',category:'field',months:[11]})];
 const year=getYearAvailability(rows,{province:'wasit'});assert.equal(year.length,12);
 assert.deepEqual(year[10],{month:11,label:'تشرين الثاني',count:2,windowCount:3});
 assert.equal(getYearAvailability(rows,{month:99,cropId:'spinach'})[10].count,1);
 assert.equal(getYearAvailability(rows,{method:'nursery'})[9].count,0);
 const grouped=groupByCrop(getPlantingMatches(rows,{month:11}));assert.equal(grouped.length,2);assert.equal(grouped[0].windows.length,2);
});

test('matching and grouping do not mutate source windows or their array metadata',()=>{
 const rows=[row()],before=structuredClone(rows),matched=getPlantingMatches(rows,{month:11});
 matched[0].months.push(4);matched[0].aliases.push('changed');matched[0].sourceIds.push('changed');
 assert.deepEqual(rows,before);
 const grouped=groupByCrop(getPlantingMatches(rows,{month:11}));grouped[0].windows.push(row({id:'temporary'}));assert.deepEqual(rows,before);
});

test('data validation requires unique dates, valid methods, safe sources and resolvable evidence',()=>{
 assert.equal(validateCalendarData([row()],[source]),true);
 const badRows=[row({months:[0]}),row({months:[11,11]}),row({months:[]}),row({zones:['east']}),row({zones:['all','north']}),row({operation:'harvest'}),row({method:'heated_by_default'}),row({sourceIds:[]}),row({sourceIds:['missing']}),row({provinceCodes:['fake']})];
 for(const bad of badRows)assert.throws(()=>validateCalendarData([bad],[source]),errorCode('INVALID_CALENDAR_DATA'));
 assert.throws(()=>validateCalendarData([row(),row()],[source]),errorCode('INVALID_CALENDAR_DATA'));
 assert.throws(()=>validateCalendarData([row(),row({id:'other',cropName:'different'})],[source]),errorCode('INVALID_CALENDAR_DATA'));
 for(const url of ['http://university.edu.iq/x','javascript:alert(1)','https://user:pass@university.edu.iq/x','https://localhost/x','https://127.0.0.1/x','https://university.edu.iq:8443/x'])assert.throws(()=>validateCalendarData([row()],[{...source,url}]),errorCode('INVALID_CALENDAR_DATA'));
 assert.throws(()=>validateCalendarData([row()],[source,source]),errorCode('INVALID_CALENDAR_DATA'));
 assert.throws(()=>validateCalendarData([],[source]),errorCode('INVALID_CALENDAR_DATA'));
});

test('the published crop dataset has valid evidence for every recurring planting window',async()=>{
 const data=await import('../planting-calendar-data.mjs');
 assert.equal(validateCalendarData(data.PLANTING_WINDOWS,data.SOURCES),true);
 assert.ok(data.PLANTING_WINDOWS.length>0);
 for(let month=1;month<=12;month++)assert.equal(getYearAvailability(data.PLANTING_WINDOWS)[month-1].count,new Set(getPlantingMatches(data.PLANTING_WINDOWS,{month}).map(row=>row.cropId)).size);
});
