import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeTerrainGrid,inverseUtm,pointInProjectedPolygon,projectToUtm,utmZoneForLongitude} from '../topographic-core.mjs';

test('Iraqi WGS84 coordinates project to UTM and round-trip',()=>{
 const lon=45.2978942,lat=32.7541713,zone=utmZoneForLongitude(lon),xy=projectToUtm(lon,lat,zone),back=inverseUtm(xy[0],xy[1],zone,true);
 assert.equal(zone,38);assert.ok(Math.abs(back[0]-lon)<1e-6);assert.ok(Math.abs(back[1]-lat)<1e-6);
});

test('projected polygon includes its interior and excludes points outside',()=>{
 const ring=[[0,0],[10,0],[10,10],[0,10],[0,0]];
 assert.equal(pointInProjectedPolygon([5,5],[ring]),true);
 assert.equal(pointInProjectedPolygon([15,5],[ring]),false);
});

test('Horn slope and D8 direction are derived from a measured raster gradient',()=>{
 const width=5,height=5,cell=30,elevation=[],valid=new Uint8Array(25).fill(1),inside=new Uint8Array(25).fill(1);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)elevation.push(100+x*3);
 const result=analyzeTerrainGrid({width,height,elevation,valid,inside,cellSizeX:cell,cellSizeY:cell}),center=2*width+2;
 assert.ok(Math.abs(result.stats.mean_slope_degrees-Math.atan(.1)*180/Math.PI)<1e-8);
 assert.ok(Math.abs(result.stats.mean_slope_percent-10)<1e-8);
 assert.equal(result.grid.flow_direction[center],6); // downhill to the west
 assert.equal(result.stats.minimum_elevation_m,100);
 assert.equal(result.stats.maximum_elevation_m,112);
});

test('priority flood marks a real raster depression as a potential low area',()=>{
 const width=5,height=5,elevation=new Array(25).fill(10),valid=new Uint8Array(25).fill(1),inside=new Uint8Array(25).fill(1);
 elevation[12]=5;
 const result=analyzeTerrainGrid({width,height,elevation,valid,inside,cellSizeX:30,cellSizeY:30});
 assert.equal(result.grid.pooling[12],true);
 assert.equal(result.stats.low_cells,1);
 assert.equal(result.stats.low_area_m2,900);
 assert.equal(result.thresholds.depression_depth_m,.5);
});

test('analysis refuses grids with too few in-field DEM cells',()=>{
 const valid=new Uint8Array(25).fill(1),inside=new Uint8Array(25);
 inside[12]=1;
 assert.throws(()=>analyzeTerrainGrid({width:5,height:5,elevation:new Array(25).fill(1),valid,inside,cellSizeX:30,cellSizeY:30}),/Insufficient DEM cells/);
});
