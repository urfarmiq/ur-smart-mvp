import {fromArrayBuffer} from 'geotiff';
import {analyzeTerrainGrid,pointInProjectedPolygon,projectToUtm,utmZoneForLongitude} from '../topographic-core.mjs';
import {satelliteFetch,SatelliteRequestError,validateSatellitePolygon} from './satellite-security.mjs';

const DEM_URL='https://sh.dataspace.copernicus.eu/process/v1';
const TOKEN_URL='https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const MAX_PIXELS=262144,MAX_TIFF_BYTES=12*1024*1024,MAX_BODY=4096,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVALSCRIPT=`//VERSION=3
function setup(){return {input:[{bands:["DEM","dataMask"]}],output:{id:"default",bands:2,sampleType:SampleType.FLOAT32}}}
function evaluatePixel(s){return [s.DEM,s.dataMask]}
`;
const json=(reply,body,status,origin)=>reply(body,status,origin);
const fail=(reply,code,status,message,origin)=>json(reply,{code,error:code,message},status,origin);
const boundedJSON=async(response,max=32*1024)=>{
 const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>max)throw Error('body too large');
 const text=await response.text();if(new TextEncoder().encode(text).length>max)throw Error('body too large');return JSON.parse(text);
};
const boundsOf=geometry=>geometry.coordinates.flat().reduce((b,p)=>({minX:Math.min(b.minX,p[0]),minY:Math.min(b.minY,p[1]),maxX:Math.max(b.maxX,p[0]),maxY:Math.max(b.maxY,p[1])}),{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity});
const projectGeometry=(geometry,zone)=>({type:'Polygon',coordinates:geometry.coordinates.map(ring=>ring.map(([lon,lat])=>projectToUtm(lon,lat,zone)))});
const toLonLatCorners=(box,zone,north)=>[[box.minX,box.minY],[box.maxX,box.minY],[box.maxX,box.maxY],[box.minX,box.maxY]].map(([x,y])=>projectToUtm===null?[0,0]:(()=>{const a=6378137,e2=.00669438,k0=.9996,ep2=e2/(1-e2),e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2)),xx=x-500000,yy=north?y:y-10000000,m=yy/k0,mu=m/(a*(1-e2/4-3*e2*e2/64-5*e2*e2*e2/256)),j1=3*e1/2-27*e1**3/32,j2=21*e1*e1/16-55*e1**4/32,j3=151*e1**3/96,j4=1097*e1**4/512,fp=mu+j1*Math.sin(2*mu)+j2*Math.sin(4*mu)+j3*Math.sin(6*mu)+j4*Math.sin(8*mu),sin=Math.sin(fp),cos=Math.cos(fp),tan=Math.tan(fp),c1=ep2*cos*cos,t1=tan*tan,n1=a/Math.sqrt(1-e2*sin*sin),r1=a*(1-e2)/Math.pow(1-e2*sin*sin,1.5),d=xx/(n1*k0),q1=n1*tan/r1,q2=d*d/2,q3=(5+3*t1+10*c1-4*c1*c1-9*ep2)*d**4/24,q4=(61+90*t1+298*c1+45*t1*t1-252*ep2-3*c1*c1)*d**6/720,q5=d,q6=(1+2*t1+c1)*d**3/6,q7=(5-2*c1+28*t1-3*c1*c1+8*ep2+24*t1*t1)*d**5/120,lon0=((zone-1)*6-180+3)*Math.PI/180;return [(lon0+(q5-q6+q7)/cos)*180/Math.PI,(fp-q1*(q2-q3+q4))*180/Math.PI]})());

async function authenticate(request,env){
 const bearer=request.headers.get('Authorization')||'';
 if(bearer.length>8200||!/^Bearer [^\s]+$/.test(bearer))throw Object.assign(Error('AUTH_REQUIRED'),{status:401});
 const base=env.SUPABASE_URL.replace(/\/$/,'');
 const headers={apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:bearer};
 const response=await satelliteFetch(base+'/auth/v1/user',{headers},8000);
 if(!response.ok)throw Object.assign(Error('AUTH_REQUIRED'),{status:401});
 const user=await boundedJSON(response);if(!UUID.test(user?.id||'')||user.is_anonymous===true)throw Object.assign(Error('AUTH_REQUIRED'),{status:401});
 return {user,base,headers};
}
async function savedBoundary(fieldId,auth){
 const url=new URL(auth.base+'/rest/v1/field_boundaries');url.searchParams.set('field_id','eq.'+fieldId);url.searchParams.set('select','geometry,area_m2,owner_id');url.searchParams.set('limit','1');
 const response=await satelliteFetch(url.href,{headers:auth.headers},8000);if(!response.ok)throw Object.assign(Error('BOUNDARY_READ_FAILED'),{status:502});
 const rows=await boundedJSON(response);const row=Array.isArray(rows)?rows[0]:null;
 if(!row||row.owner_id!==auth.user.id)throw Object.assign(Error('FIELD_NOT_FOUND'),{status:404});
 return row;
}
async function accessToken(env){
 const response=await satelliteFetch(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.SENTINEL_CLIENT_ID,client_secret:env.SENTINEL_CLIENT_SECRET})},15000);
 if(!response.ok)throw Object.assign(Error('DEM_AUTH_FAILED'),{status:502});
 const value=await boundedJSON(response);if(typeof value.access_token!=='string')throw Object.assign(Error('DEM_AUTH_FAILED'),{status:502});return value.access_token;
}
async function fetchDem(token,bbox,width,height,instance){
 const payload={input:{bounds:{bbox:[bbox.minX,bbox.minY,bbox.maxX,bbox.maxY],properties:{crs:'http://www.opengis.net/def/crs/EPSG/0/'+bbox.epsg}},data:[{type:'dem',dataFilter:{demInstance:instance},processing:{egm:false,upsampling:'NEAREST',downsampling:'NEAREST'}}]},output:{width,height,responses:[{identifier:'default',format:{type:'image/tiff'}}]},evalscript:EVALSCRIPT};
 const response=await satelliteFetch(DEM_URL,{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json',Accept:'image/tiff'},body:JSON.stringify(payload)},60000);
 if(!response.ok){if(response.body)void response.body.cancel().catch(()=>{});throw Object.assign(Error('DEM_UPSTREAM_'+response.status),{status:response.status});}
 const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>MAX_TIFF_BYTES){void response.body?.cancel().catch(()=>{});throw Object.assign(Error('DEM_RESPONSE_TOO_LARGE'),{status:413});}
 const buffer=await response.arrayBuffer();if(buffer.byteLength>MAX_TIFF_BYTES)throw Object.assign(Error('DEM_RESPONSE_TOO_LARGE'),{status:413});
 return buffer;
}
async function readRaster(buffer,width,height){
 const tiff=await fromArrayBuffer(buffer),image=await tiff.getImage();
 const w=image.getWidth(),h=image.getHeight();if(w!==width||h!==height||w<3||h<3||w*h>MAX_PIXELS)throw Object.assign(Error('DEM_GRID_INVALID'),{status:502});
 const bands=await image.readRasters({interleave:false});
 if(!Array.isArray(bands)||bands.length<2||bands[0].length!==w*h||bands[1].length!==w*h)throw Object.assign(Error('DEM_GRID_INVALID'),{status:502});
 return {width:w,height:h,elevation:bands[0],dataMask:bands[1]};
}
export function terrainStatus(env={}){
 const configured=!!(env.SUPABASE_URL&&env.SUPABASE_PUBLISHABLE_KEY&&env.SENTINEL_CLIENT_ID&&env.SENTINEL_CLIENT_SECRET);
 return {available:configured,source:'Copernicus DEM via Sentinel Hub Process API',preferred_instance:'COPERNICUS_30',fallback_instance:'COPERNICUS_90',requires_existing_worker_credentials:true,report_table:'terrain_reports',message:configured?'خدمة الارتفاع مهيأة؛ تحقق من صلاحية مجموعة DEM لحساب Copernicus.':'يلزم إعداد اعتماد Sentinel Hub وSupabase في العامل الخلفي.'};
}
export async function handleTerrainAnalysis(request,env,{reply,origin}){
 const bad=(code,status,message)=>fail(reply,code,status,message,origin);
 if(request.method!=='POST')return bad('METHOD_NOT_ALLOWED',405,'طريقة الطلب غير مدعومة.');
 if(!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY||!env.SENTINEL_CLIENT_ID||!env.SENTINEL_CLIENT_SECRET)return bad('TERRAIN_SETUP_REQUIRED',503,'خدمة الارتفاع غير مهيأة في العامل الخلفي.');
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))return bad('INVALID_REQUEST',415,'أرسل الطلب بصيغة JSON.');
 let body;try{
  const length=Number(request.headers.get('Content-Length'));if(Number.isFinite(length)&&length>MAX_BODY)throw Error();
  const text=await request.text();if(new TextEncoder().encode(text).length>MAX_BODY)throw Error();body=JSON.parse(text);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='field_id')||!UUID.test(body.field_id||''))throw Error();
 }catch{return bad('INVALID_REQUEST',400,'بيانات الطلب غير صالحة.')}
 try{
  const auth=await authenticate(request,env),record=await savedBoundary(body.field_id.toLowerCase(),auth);
  const area=Number(record.area_m2);if(!Number.isFinite(area)||area<=0||area>2e7)return bad('FIELD_SIZE_UNSUPPORTED',413,'مساحة الحقل غير صالحة أو أكبر من الحد المدعوم.');
  const geometry=validateSatellitePolygon(record.geometry,projectToUtm);
  const center=geometry.coordinates[0].slice(0,-1).reduce((sum,p)=>[sum[0]+p[0],sum[1]+p[1]],[0,0]).map(v=>v/(geometry.coordinates[0].length-1));
  const zone=utmZoneForLongitude(center[0]),epsg=(center[1]<0?32700:32600)+zone,projected=projectGeometry(geometry,zone),fieldBox=boundsOf(projected),nominal=30,pad=nominal*2;
  const bbox={minX:fieldBox.minX-pad,minY:fieldBox.minY-pad,maxX:fieldBox.maxX+pad,maxY:fieldBox.maxY+pad,epsg};
  const width=Math.max(3,Math.ceil((bbox.maxX-bbox.minX)/nominal)),height=Math.max(3,Math.ceil((bbox.maxY-bbox.minY)/nominal));
  if(width*height>MAX_PIXELS||width>1024||height>1024)return bad('FIELD_GRID_TOO_LARGE',413,'شبكة الحقل أكبر من حد المعالجة؛ قلّص حدود الحقل أو اطلب معالجة مخصصة.');
  const token=await accessToken(env);let instance='COPERNICUS_30',buffer;
  try{buffer=await fetchDem(token,bbox,width,height,instance)}
  catch(error){instance='COPERNICUS_90';buffer=await fetchDem(token,bbox,width,height,instance)}
  const raster=await readRaster(buffer,width,height),resX=(bbox.maxX-bbox.minX)/width,resY=(bbox.maxY-bbox.minY)/height,inside=new Uint8Array(width*height),valid=new Uint8Array(width*height),pixelElevation=Float64Array.from(raster.elevation);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=y*width+x,point=[bbox.minX+(x+.5)*resX,bbox.maxY-(y+.5)*resY];
   valid[i]=raster.dataMask[i]>0&&Number.isFinite(pixelElevation[i])?1:0;
   inside[i]=valid[i]&&pointInProjectedPolygon(point,projected.coordinates)?1:0;
  }
  let result;try{result=analyzeTerrainGrid({width,height,elevation:pixelElevation,valid,inside,cellSizeX:resX,cellSizeY:resY})}
  catch(error){if(error instanceof RangeError)return bad('INSUFFICIENT_DEM_COVERAGE',422,'بيانات الارتفاع المتاحة لا تغطي عددًا كافيًا من خلايا الحقل لإجراء تحليل موثوق. جرّب حقلًا أكبر أو تأكد من صلاحية بيانات Copernicus.');throw error}
  const covered=result.stats.valid_cells,fieldCells=area/(resX*resY),warnings=[];
  if(covered<9)warnings.push('عدد خلايا DEM داخل الحدود قليل؛ قراءة الانحدار ومسارات التصريف تقريبية جدًا.');
  if(instance==='COPERNICUS_90')warnings.push('استُخدم نموذج Copernicus GLO-90 بدقة اسمية 90 مترًا؛ لا يكفي لتصميم مبازل داخل الحقل.');
  warnings.push('Copernicus DEM نموذج سطح رقمي (DSM) بدقة متوسطة؛ قد تتأثر الأراضي شبه المستوية والغطاء النباتي والمنشآت بخطأ الارتفاع.');
  const flat=(result.stats.mean_slope_percent??0)<0.2;
  if(flat)warnings.push('الانحدار المحسوب شبه مستوٍ؛ تحقق بمسح مناسيب ميداني قبل اختيار اتجاه الري أو المبازل.');
  const source=instance==='COPERNICUS_30'?'Copernicus DEM GLO-30 Public عبر Sentinel Hub':'Copernicus DEM GLO-90 عبر Sentinel Hub';
  return json(reply,{field_id:body.field_id.toLowerCase(),geometry,source,dem_instance:instance,resolution_m:instance==='COPERNICUS_30'?30:90,grid_resolution_x_m:resX,grid_resolution_y_m:resY,vertical_datum:'EGM2008 orthometric heights',area_m2:area,area_donum:area/2500,grid:{width,height,bounds_utm:[bbox.minX,bbox.minY,bbox.maxX,bbox.maxY],epsg,rows:result.grid},stats:{...result.stats,field_grid_cells_estimate:fieldCells},thresholds:result.thresholds,warnings,generated_at:new Date().toISOString(),analysis_method:'Horn 3x3 slope; D8 flow direction; priority-flood depression depth estimate; flow-accumulation threshold for preliminary drainage paths',note:'المناطق المنخفضة ومسارات التصريف مؤشرات أولية مستنتجة من DEM وليست قياسًا ميدانيًا أو تصميمًا هندسيًا.'},200,origin);
 }catch(error){
  if(error?.status===401)return bad('AUTH_REQUIRED',401,'انتهت جلسة الدخول أو تعذر التحقق من الحساب.');
  if(error?.status===404)return bad('FIELD_NOT_FOUND',404,'الحقل أو حدوده المحفوظة غير متاحة لهذا الحساب.');
  if(error?.status===413)return bad('REQUEST_LIMIT',413,'الطلب يتجاوز حد المعالجة. قلّص حدود الحقل.');
  if(error?.status===504)return bad('UPSTREAM_TIMEOUT',504,'تأخر مصدر بيانات الارتفاع؛ أعد المحاولة لاحقًا.');
  if(error?.status===422)return bad('NO_DEM_COVERAGE',422,'لم تتوفر بيانات DEM صالحة داخل حدود الحقل.');
  if(error?.status===429)return bad('DEM_RATE_LIMIT',429,'تجاوز مصدر DEM حد الطلبات؛ حاول لاحقًا.');
  return bad('TERRAIN_ANALYSIS_FAILED',502,'تعذر جلب بيانات Copernicus أو تحليلها الآن. لم تُحفظ أي نتيجة.');
 }
}
