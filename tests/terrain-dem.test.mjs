import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {copernicusTileUrl,planTerrainGrid,fetchTerrainDem,TerrainDemError} from '../satellite-backend/terrain-dem.mjs';

const polygon={type:'Polygon',coordinates:[[[45.815,32.485],[45.833,32.485],[45.833,32.503],[45.815,32.503],[45.815,32.485]]]};
const box=(w,s,e,n)=>({type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]});
const reject=(promise,status,code)=>assert.rejects(promise,error=>error instanceof TerrainDemError&&error.status===status&&(!code||error.code===code));

test('DEM tile URLs are constrained to the fixed public source and exact integer naming',()=>{
 assert.equal(copernicusTileUrl(45,32),'https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/Copernicus_DSM_COG_10_N32_00_E045_00_DEM/Copernicus_DSM_COG_10_N32_00_E045_00_DEM.tif');
 assert.match(copernicusTileUrl(-7,-4),/_S04_00_W007_00_DEM/);
 for(const x of ['https://evil.test',45.5,NaN,180])assert.throws(()=>copernicusTileUrl(x,32),TerrainDemError);
});

test('native grid keeps 1 arc-second posts, outer-edge bounds, real slope halo and safe dimensions',()=>{
 const grid=planTerrainGrid(polygon);assert.equal(grid.stride,1);assert.equal(grid.width,68);assert.equal(grid.height,68);
 const [west,south,east,north]=grid.bounds,step=(east-west)/grid.width;
 assert.ok(Math.abs(step-1/3600)<1e-12);assert.ok(Math.abs((north-south)/grid.height-step)<1e-12);
 assert.ok(Math.abs((west+step/2)*3600-grid.west)<1e-8);
 assert.ok(Math.abs((north-step/2)*3600-grid.north)<1e-8);
 assert.ok(west<45.815&&east>45.833&&south<32.485&&north>32.503);
});

test('larger windows use an explicit integer native decimation, never synthetic upsampling',()=>{
 const grid=planTerrainGrid(box(45.1,32.1,45.25,32.25));
 assert.ok(grid.stride>1);assert.ok(grid.width<=192&&grid.height<=192);
 assert.equal(grid.step,grid.stride/3600);
});

test('invalid, huge, unclosed, nonfinite and unsupported-coordinate geometry makes no upstream call',async()=>{
 let calls=0;const fetchImpl=()=>{calls++;throw Error('must not fetch');};
 for(const input of [null,{},box(45,32,45.3,32.3),box(45,60,45.1,60.1),{type:'Polygon',coordinates:[[[45,32],[45.1,32],[45.1,32.1],[NaN,32]]]}])await assert.rejects(fetchTerrainDem({polygon:input},{fetchImpl}),TerrainDemError);
 await assert.rejects(fetchTerrainDem({polygon,maxDimension:500},{fetchImpl}),TerrainDemError);
 assert.equal(calls,0);
});

test('missing source tiles fail clearly with no ocean-zero or generated elevation fallback',async()=>{
 await reject(fetchTerrainDem({polygon},{fetchImpl:async()=>new Response('NoSuchKey',{status:404})}),422,'dem_missing');
});

test('full-file and forbidden upstream responses are rejected without leaking provider bodies',async()=>{
 for(const status of [200,403,429,500]){
  const promise=fetchTerrainDem({polygon},{fetchImpl:async()=>new Response('provider-secret-must-not-leak',{status})});
  await assert.rejects(promise,error=>error instanceof TerrainDemError&&error.status===502&&!error.message.includes('provider-secret'));
 }
});

test('an upstream range must exactly match the requested offsets and object length',async()=>{
 const fetchImpl=async()=>new Response(new Uint8Array(1024),{status:206,headers:{'content-range':'bytes 1-1024/50000000'}});
 await reject(fetchTerrainDem({polygon},{fetchImpl}),502,'dem_format');
});

test('declared oversized bodies are rejected before allocation',async()=>{
 const fetchImpl=async()=>new Response(new Uint8Array(1),{status:206,headers:{'content-range':'bytes 0-1023/50000000','content-length':'50000000'}});
 await reject(fetchTerrainDem({polygon},{fetchImpl}),502,'dem_resource_limit');
});

test('truncated bodies and invalid TIFF headers cannot turn into successful analysis',async()=>{
 const headers={'content-range':'bytes 0-1023/50000000'};
 await reject(fetchTerrainDem({polygon},{fetchImpl:async()=>new Response(new Uint8Array(1),{status:206,headers})}),502,'dem_format');
 await reject(fetchTerrainDem({polygon},{fetchImpl:async()=>new Response(new Uint8Array(1024),{status:206,headers})}),502,'dem_decode');
});

test('timeouts produce a bounded retryable error without fake data',async()=>{
 await reject(fetchTerrainDem({polygon},{fetchImpl:async()=>{throw new DOMException('secret provider URL','TimeoutError');}}),504,'dem_upstream');
});

test('real Copernicus metadata rejects four-block windows before decoding any elevation block',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/terrain-copernicus-header.json',import.meta.url),'utf8'));
 const seen=[];
 const fetchImpl=async(url,options)=>{
  const range=new Headers(options.headers).get('range');seen.push(range);
  const record=fixture.ranges.find(r=>r.url===url&&r.range===range);assert.ok(record,'No native elevation block should be requested');
  return new Response(Buffer.from(record.data,'base64'),{status:record.status,headers:record.headers});
 };
 const lon=45+1024/3600,lat=33-1024/3600;
 await reject(fetchTerrainDem({polygon:box(lon-.001,lat-.001,lon+.001,lat+.001)},{fetchImpl}),413,'dem_resource_limit');
 assert.ok(seen.length>0&&seen.length<=fixture.ranges.length);assert.ok(seen.every(range=>Number(range.split('=')[1].split('-')[0])<2000));
});
