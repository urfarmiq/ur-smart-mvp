import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadRasterImage,colorizeRaster,collectRasters,pickSceneDate} from '../satellite-raster.mjs';
test('cached data URL can load synchronously without losing the event',async()=>{
 class CachedImage{naturalWidth=10;naturalHeight=10;set src(value){this.onload();}}
 const image=await loadRasterImage('data:image/png;base64,test',CachedImage,100);
 assert.equal(image.naturalWidth,10);
});
test('invalid image URLs, decode errors and timeout reject instead of hanging',async()=>{
 await assert.rejects(loadRasterImage('not-an-image'));
 class BrokenImage{set src(value){this.onerror();}}
 await assert.rejects(loadRasterImage('data:image/png;base64,test',BrokenImage,100));
 class SilentImage{set src(value){}}
 await assert.rejects(loadRasterImage('data:image/png;base64,test',SilentImage,5));
});
test('colors retain nodata transparency and distinguish low and high indices',()=>{
 const pixels=new Uint8ClampedArray([0,0,0,255,255,255,255,255,90,90,90,0]);
 colorizeRaster(pixels,'NDVI');assert.deepEqual([...pixels.slice(0,4)],[216,63,50,255]);assert.deepEqual([...pixels.slice(4,8)],[17,163,90,255]);assert.equal(pixels[11],0);
});
test('one unavailable raster does not discard successful layers and requests are bounded',async()=>{
 let active=0,peak=0;
 const result=await collectRasters([null,'NDVI','NDMI','NDRE'],async key=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));active--;if(key==='NDMI')throw Error('unavailable');return {image:key};});
 assert.equal(result.images.size,3);assert.equal(result.images.get('NDVI').image,'NDVI');assert.equal(result.errors.get('NDMI'),'unavailable');assert.ok(peak<=2);
});
// Date selection must never reuse a day from a previously selected field.

test('scene date stays within selected field and prefers server recommendation',()=>{const series=[{date:'2026-10-23T00:00:00Z'},{date:'2026-10-20T00:00:00Z'}];assert.equal(pickSceneDate(series,'2026-10-20','2026-10-23'),'2026-10-20');assert.equal(pickSceneDate(series,'2026-09-01','2026-10-20'),'2026-10-20');});
