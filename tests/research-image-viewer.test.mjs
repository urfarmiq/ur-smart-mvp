import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleImagePixel,nativeImageDetails} from '../research-image-viewer.mjs';
import {colorizeRaster} from '../satellite-raster.mjs';

test('research image probe reconstructs actual grayscale NDVI and keeps the original measurements unchanged',()=>{
 const pixels=new Uint8ClampedArray([51,51,51,255,153,153,153,255,230,230,230,255,200,200,200,0]);
 const original=new Uint8ClampedArray(pixels),display=colorizeRaster(new Uint8ClampedArray(pixels),'NDVI');
 assert.deepEqual(pixels,original);assert.notDeepEqual(display,pixels);
 assert.ok(Math.abs(sampleImagePixel(pixels,4,1,.2,.1).value)<1e-12);
 assert.ok(Math.abs(sampleImagePixel(pixels,4,1,1.8,.1).value-.4)<1e-12);
 const third=sampleImagePixel(pixels,4,1,2.3,.1);assert.ok(Math.abs(third.value-(-.2+230/255))<1e-12);assert.equal(third.relation,'≈');assert.equal(third.step,1/255);
 assert.equal(sampleImagePixel(pixels,4,1,3.4,.1).status,'nodata');assert.equal(display[15],0,'palette never fills a transparent pixel');
});
test('display clamps stay bounds rather than exact invented NDVI measurements',()=>{
 const pixels=new Uint8ClampedArray([0,0,0,255,255,255,255,255]);
 const low=sampleImagePixel(pixels,2,1,0,0),high=sampleImagePixel(pixels,2,1,1,0);
 assert.equal(low.relation,'≤');assert.equal(high.relation,'≥');assert.equal(low.bound,-.2+1/510);assert.equal(high.bound,.8-1/510);
});
test('image probe rejects invalid dimensions, buffers and coordinates instead of returning a field average',()=>{
 const pixels=new Uint8ClampedArray([153,153,153,255]);
 for(const [x,y] of [[-1,0],[1,0],[0,1],[NaN,0],[0,Infinity]])assert.equal(sampleImagePixel(pixels,1,1,x,y).status,'outside');
 for(const [buffer,w,h] of [[null,1,1],[pixels,0,1],[pixels,2,1],[pixels,1.5,1],[[NaN,0,0,255],1,1],[[10,10,10,999],1,1]])assert.equal(sampleImagePixel(buffer,w,h,0,0).status,'unavailable');
});
test('native details disclose source pixels and never advertise display enlargement as higher satellite resolution',()=>{
 const small=nativeImageDetails({resolution_m:10,resolution_x_m:9.7,resolution_y_m:9.8},32,24);
 assert.match(small,/32 × 24/);assert.match(small,/10 متر\/بكسل/);assert.match(small,/لا يضيف تفاصيل/);assert.doesNotMatch(small,/شبكة العرض/);
 const large=nativeImageDetails({native_resolution_m:10,resolution_m:10,resolution_x_m:20,resolution_y_m:25},1024,1024);
 assert.match(large,/دقة المصدر 10/);assert.match(large,/شبكة العرض نحو 20 × 25/);
 const unknown=nativeImageDetails({},3,5);assert.doesNotMatch(unknown,/دقة المصدر/);assert.match(unknown,/3 × 5/);
});
