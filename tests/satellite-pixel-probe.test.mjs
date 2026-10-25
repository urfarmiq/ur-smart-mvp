import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sampleRaster,polygonContains,formatSample,DISPLAY_RANGES} from '../satellite-pixel-probe.mjs';
const geometry={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]};
const layer={index:'NDVI',geometry,bounds:[[0,0],[2,2]],width:2,height:2,pixels:new Uint8ClampedArray([0,0,0,255,128,128,128,255,255,255,255,255,100,100,100,0])};
test('samples the original image in north-to-south rows and east-to-west columns',()=>{
 const center=sampleRaster(layer,1.5,1.5);assert.equal(center.gray,128);assert.ok(Math.abs(center.value-(-.2+128/255))<1e-12);assert.equal(center.relation,'≈');assert.equal(center.status,'valid');
 assert.equal(sampleRaster(layer,.5,1.5).status,'nodata');assert.equal(sampleRaster(layer,3,1).status,'outside');
 assert.equal(sampleRaster(layer,0,0).gray,255);assert.equal(sampleRaster(layer,2,2).gray,128);
});
test('clamped endpoints are conservative bounds, not precise values',()=>{
 const low=sampleRaster(layer,1.5,.5),high=sampleRaster(layer,.5,.5);assert.equal(low.relation,'≤');assert.equal(high.relation,'≥');assert.ok(low.bound>DISPLAY_RANGES.NDVI[0]);assert.ok(high.bound<DISPLAY_RANGES.NDVI[1]);assert.equal(low.percent,0);assert.equal(high.percent,100);
 assert.match(formatSample(layer,low),/≤/);assert.match(formatSample(layer,high),/مقياس الألوان/);
});
test('polygon holes and exterior are never sampled',()=>{
 const withHole={...geometry,coordinates:[...geometry.coordinates,[[.8,.8],[1.2,.8],[1.2,1.2],[.8,1.2],[.8,.8]]]};
 assert.equal(polygonContains(withHole,1,1),false);assert.equal(polygonContains(withHole,.5,.5),true);assert.equal(polygonContains(withHole,1,3),false);
 assert.equal(sampleRaster({...layer,geometry:withHole},1,1).status,'outside');
});
test('no data and malformed rasters produce no numeric reading',()=>{
 assert.equal(sampleRaster({...layer,pixels:[]},1,1).status,'unavailable');assert.equal(sampleRaster({...layer,index:'UNKNOWN'},1,1).status,'unavailable');assert.match(formatSample(layer,{status:'nodata'}),/لا توجد بيانات/);
});
test('display decoding ranges match the Worker grayscale encoding',async()=>{
 const source=await readFile(new URL('../satellite-backend/worker.js',import.meta.url),'utf8');
 const encoded=source.match(/const indexRanges=(\{[^;]+\});/)[1];
 const ranges=Object.fromEntries([...encoded.matchAll(/(\w+):\[(-?[\d.]+),(-?[\d.]+)\]/g)].map(m=>[m[1],[Number(m[2]),Number(m[3])]]));
 assert.deepEqual(DISPLAY_RANGES,ranges);
});
