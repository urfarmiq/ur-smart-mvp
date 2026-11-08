import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeTerrain,sampleTerrainProfile,validateTerrainPolygon,ALGORITHM_VERSION,TerrainAnalysisError} from '../terrain-core.mjs';

// Analytic grids are test fixtures only. Production always supplies a fetched DEM.
const R=6371008.8,DEG=Math.PI/180;
function grid(fn=()=>100,width=7,height=7){
 const west=44,south=33,dx=10/(R*DEG*Math.cos(33*DEG)),dy=10/(R*DEG);
 const raster={width,height,bounds:[west,south,west+width*dx,south+height*dy],elevations:Array.from({length:width*height},(_,i)=>fn(i%width,Math.floor(i/width))),source:{id:'analytic-test-fixture',name:'Analytic test grid (not production)',resolution_m:10,vertical_datum:'test',vertical_accuracy_m:4}};
 const p=(x,y)=>[west+x*dx,south+y*dy],polygon={type:'Polygon',coordinates:[[p(1,1),p(width-1,1),p(width-1,height-1),p(1,height-1),p(1,1)]]};
 return {raster,polygon,p};
}
function near(actual,expected,tolerance=.005){assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);}
function expectFailure(fn,code){assert.throws(fn,error=>error instanceof TerrainAnalysisError&&(!code||error.code===code));}

test('metric Horn slope on an analytic plane gives independent degrees and percent, with downhill D8',()=>{
 const fixture=grid((x,y)=>100+2*x+3*y),result=analyzeTerrain(fixture),ratio=Math.sqrt(13)/10;
 near(result.summary.mean_slope_percent,100*ratio,.01);near(result.summary.mean_slope_degrees,Math.atan(ratio)/DEG,.01);
 assert.equal(result.raster.flow_direction[3*7+3],5);assert.ok(result.flow_arrows.length>0);
 assert.ok(result.flow_arrows.every(a=>a.drop_m>0));assert.equal(result.algorithm_version,ALGORITHM_VERSION);
 assert.ok(result.summary.mean_slope_percent!==result.summary.mean_slope_degrees);
});

test('field clipping excludes halo values from elevation summaries but keeps them for slope',()=>{
 const fixture=grid((x,y)=>x===0||y===0||x===6||y===6?999:100+x),result=analyzeTerrain(fixture);
 assert.equal(result.summary.min_elevation_m,101);assert.equal(result.summary.max_elevation_m,105);assert.equal(result.summary.valid_cells,25);
 assert.equal(result.raster.elevations[0],null);assert.equal(result.raster.slope_degrees[0],null);assert.equal(result.raster.field_mask[0],false);
 assert.equal(result.raster.elevations[24],103);assert.equal(result.summary.coverage_percent,100);
});

test('flat DEM has zero slope without invented flow arrows, drainage paths, or ponding',()=>{
 const result=analyzeTerrain(grid());assert.equal(result.summary.mean_slope_percent,0);assert.equal(result.summary.mean_slope_degrees,0);
 assert.equal(result.flow_arrows.length,0);assert.equal(result.drainage_paths.length,0);assert.equal(result.low_areas.cells,0);
 assert.ok(result.raster.flow_direction.filter(x=>x!==null).every(x=>x===-1));assert.equal(result.diagnostics.unresolved_flow_cells,25);
 assert.ok(result.warnings.some(s=>s.includes('لم يُفرض اتجاه')));assert.ok(result.warnings.some(s=>s.includes('لا ينفي تجمع الماء')));
});

test('closed bowl depression is bounded by the field spill elevation and provisional escape requires survey',()=>{
 const result=analyzeTerrain(grid((x,y)=>Math.max(Math.abs(x-3),Math.abs(y-3))));
 assert.equal(result.raster.depression_depth_m[24],2);assert.equal(result.low_areas.cells,9);assert.equal(result.low_areas.max_depth_m,2);
 assert.ok(result.low_areas.area_m2>0&&result.low_areas.area_m2<result.area_m2);
 const escape=result.drainage_paths.find(p=>p.kind==='depression_escape');assert.ok(escape);assert.equal(escape.outfall_verified,false);assert.equal(escape.requires_survey,true);
 assert.ok(escape.note_ar.includes('يتطلب حفرًا'));assert.ok(escape.coordinates.length>=2);
});

test('open descending plane does not become a closed depression and accumulation excludes external catchment',()=>{
 const result=analyzeTerrain(grid(x=>100-x));assert.equal(result.low_areas.cells,0);
 assert.equal(Math.max(...result.raster.flow_accumulation.filter(x=>x!==null)),5);
 assert.ok(result.flow_arrows.some(a=>a.leaves_field));assert.ok(result.drainage_paths.some(p=>p.kind==='natural_flow'));
 assert.ok(result.drainage_paths.every(p=>!p.outfall_verified&&p.requires_survey));
});

test('holes subtract area and clip every array and invalid flow through their centre',()=>{
 const fixture=grid((x,y)=>x+y),outer=validateTerrainPolygon(fixture.polygon).area_m2;
 fixture.polygon.coordinates.push([fixture.p(3,3),fixture.p(4,3),fixture.p(4,4),fixture.p(3,4),fixture.p(3,3)]);
 const result=analyzeTerrain(fixture);near(result.area_m2,outer-100,.1);assert.equal(result.summary.valid_cells,24);
 const i=3*7+3;assert.equal(result.raster.field_mask[i],false);assert.equal(result.raster.elevations[i],null);assert.equal(result.raster.low_mask[i],null);assert.equal(result.raster.flow_accumulation[i],null);
});

test('missing DEM data is not zero-filled and insufficient coverage is rejected',()=>{
 const fixture=grid((x,y)=>x===3&&y===3?null:100+x),result=analyzeTerrain(fixture);
 assert.equal(result.raster.elevations[24],null);assert.equal(result.summary.coverage_percent,96);assert.ok(result.warnings.some(x=>x.includes('لم تُستبدل')));
 const missing=grid((x,y)=>x>1&&x<6&&y>1&&y<6?null:10);expectFailure(()=>analyzeTerrain(missing),'incomplete_dem');
 expectFailure(()=>analyzeTerrain(grid(()=>null)),'insufficient_dem');
});

test('polygon area uses Iraqi dunam of 2500m² and latitude-aware spacing',()=>{
 const fixture=grid(),field=validateTerrainPolygon(fixture.polygon);near(field.area_m2,2500,.1);near(field.area_dunam,1,.001);
 const result=analyzeTerrain(fixture);near(result.diagnostics.cell_spacing_x_m,10,.002);near(result.diagnostics.cell_spacing_y_m,10,.001);
});

test('self-intersections, nonclosing boundaries, invalid coordinates and nested/outside holes are rejected',()=>{
 const {p,polygon}=grid();
 for(const value of [null,{type:'Point',coordinates:p(1,1)},{type:'Polygon',coordinates:[[p(1,1),p(6,6),p(6,1),p(1,6),p(1,1)]]},{type:'Polygon',coordinates:[[p(1,1),p(6,1),p(6,6),p(1,6)]]},{type:'Polygon',coordinates:[[[181,33],[182,33],[182,34],[181,33]]]}])expectFailure(()=>validateTerrainPolygon(value));
 const outside=structuredClone(polygon);outside.coordinates.push([p(8,8),p(9,8),p(9,9),p(8,9),p(8,8)]);expectFailure(()=>validateTerrainPolygon(outside));
 const nested=structuredClone(polygon);nested.coordinates.push([p(2,2),p(5,2),p(5,5),p(2,5),p(2,2)],[p(3,3),p(4,3),p(4,4),p(3,4),p(3,3)]);expectFailure(()=>validateTerrainPolygon(nested));
});

test('grid shape, finite data, provenance, complete polygon coverage and resource bounds are enforced',()=>{
 const fixture=grid();
 for(const patch of [{width:0},{height:50000},{elevations:[0,1]},{elevations:fixture.raster.elevations.map(()=>NaN)},{source:{}},{source:{id:'x',name:'x',resolution_m:0}},{bounds:[44,33,44.00001,33.00001]}])expectFailure(()=>analyzeTerrain({...fixture,raster:{...fixture.raster,...patch}}));
 const huge=grid(()=>1,201,201);expectFailure(()=>analyzeTerrain(huge),'raster_limit');
 const tiny=grid();tiny.polygon.coordinates=[[tiny.p(2,2),tiny.p(3,2),tiny.p(3,3),tiny.p(2,3),tiny.p(2,2)]];expectFailure(()=>analyzeTerrain(tiny),'insufficient_dem');
});

test('bilinear topographic profile follows an analytic plane at metric distances',()=>{
 const fixture=grid((x,y)=>100+2*x+3*y),a=fixture.p(1.5,5.5),b=fixture.p(5.5,1.5);
 const profile=sampleTerrainProfile({...fixture,line:[a,b],samples:9});assert.equal(profile.samples.length,9);assert.equal(profile.valid_samples,9);
 near(profile.samples[0].elevation_m,105);near(profile.samples.at(-1).elevation_m,125);near(profile.samples[4].elevation_m,115);
 near(profile.length_m,Math.sqrt(40**2+40**2),.01);assert.equal(profile.samples[0].distance_m,0);assert.equal(profile.samples.at(-1).distance_m,profile.length_m);
});

test('profile rejects a segment crossing a hole even when both endpoints are inside',()=>{
 const fixture=grid();fixture.polygon.coordinates.push([fixture.p(3,2),fixture.p(4,2),fixture.p(4,5),fixture.p(3,5),fixture.p(3,2)]);
 expectFailure(()=>sampleTerrainProfile({...fixture,line:[fixture.p(2,3.5),fixture.p(5,3.5)]}),'profile_outside_field');
 expectFailure(()=>sampleTerrainProfile({...fixture,line:[fixture.p(0,0),fixture.p(2,2)]}),'profile_outside_field');
});

test('profile rejects concavity crossings without relying on coarse samples',()=>{
 const fixture=grid(),p=fixture.p;fixture.polygon.coordinates=[[p(1,1),p(6,1),p(6,6),p(4,6),p(4,3),p(3,3),p(3,6),p(1,6),p(1,1)]];
 expectFailure(()=>sampleTerrainProfile({...fixture,line:[p(2,5),p(5,5)],samples:2}),'profile_outside_field');
});

test('profile preserves no-data gaps and refuses a completely missing line',()=>{
 const fixture=grid((x,y)=>x===3?null:100+x);
 const result=sampleTerrainProfile({...fixture,line:[fixture.p(1.5,3.5),fixture.p(5.5,3.5)],samples:9});assert.ok(result.valid_samples<9);assert.ok(result.samples.some(p=>p.elevation_m===null));
 expectFailure(()=>sampleTerrainProfile({...fixture,line:[fixture.p(3.5,2),fixture.p(3.5,5)]}),'insufficient_profile');
 expectFailure(()=>sampleTerrainProfile({...fixture,line:[fixture.p(2,2),fixture.p(5,5)],samples:100000}),'invalid_profile');
});

test('analysis output remains JSON-safe and does not mutate input raster or polygon',()=>{
 const fixture=grid((x,y)=>100+x+y),before=JSON.stringify(fixture),result=analyzeTerrain(fixture),serialized=JSON.stringify(result);
 assert.equal(JSON.stringify(fixture),before);assert.ok(!serialized.includes('NaN'));assert.ok(!serialized.includes('Infinity'));
 assert.equal(JSON.parse(serialized).source.id,'analytic-test-fixture');assert.ok(result.warnings.some(s=>s.includes('LiDAR')));assert.ok(result.warnings.some(s=>s.includes('ليست إثباتًا')));
});

test('proposed routes never cross a subpixel hole between two valid raster centres',()=>{
 const fixture=grid(x=>100-x),p=fixture.p;
 // This narrow gap contains no pixel centre. Straight D8 links across it must
 // still be truncated when turning a raster path into a field polyline.
 fixture.polygon.coordinates.push([p(3.9,1.2),p(4.1,1.2),p(4.1,5.8),p(3.9,5.8),p(3.9,1.2)]);
 const result=analyzeTerrain(fixture);assert.ok(result.drainage_paths.length>0);assert.ok(result.drainage_paths.some(path=>path.boundary_truncated));
 for(const path of result.drainage_paths){assert.doesNotThrow(()=>sampleTerrainProfile({...fixture,line:{type:'LineString',coordinates:path.coordinates},samples:5}));}
});

test('actual provider nominal accuracy warns about DEM noise and does not advertise ten-centimetre precision',()=>{
 const fixture=grid((x,y)=>Math.max(Math.abs(x-3),Math.abs(y-3)));
 delete fixture.raster.source.vertical_accuracy_m;fixture.raster.source.nominal_vertical_accuracy_m=4;
 const result=analyzeTerrain(fixture);
 assert.ok(result.warnings.some(note=>note.includes('مدى ارتفاع الحقل')));assert.ok(result.warnings.some(note=>note.includes('قد تمثل ضوضاء DEM')));
 assert.equal(result.low_areas.min_screening_depth_m,.1);assert.equal(result.low_areas.min_detection_depth_m,undefined);
 assert.ok(result.low_areas.threshold_note_ar.includes('ليست دقة كشف'));assert.ok(result.warnings.some(note=>note.includes('لا تعني أن DEM يستطيع كشف')));
});
