// Server-only acquisition of actual Copernicus GLO-30 DSM cells. No generated fallback.
// PixelIsPoint values are retained at their native centres (1 arc-second in Iraq).
import {fromCustomClient,BaseClient,BaseResponse,BaseDecoder,addDecoder} from './vendor/geotiff-terrain.mjs';

export class TerrainDemError extends Error{
 constructor(status,message,code='dem_unavailable'){super(message);this.name='TerrainDemError';this.status=status;this.code=code;}
}

const HOST='https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com';
const LIMITS={bytes:8*1024*1024,range:5*1024*1024,requests:32,blocks:2,tiles:4,dimension:192,deadline:60000};
const ATTRIBUTION='produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved';

// The Web API inflator avoids allocating an extra JavaScript Deflate decoder.
// GeoTIFF's established floating-point predictor remains responsible for TIFF decoding.
if(typeof DecompressionStream==='function'){
 class NativeDeflateDecoder extends BaseDecoder{
  async decodeBlock(buffer){
   const response=new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('deflate')));
   return readBoundedBody(response,{bytes:0},4*1024*1024);
  }
 }
 addDecoder([8,32946],async()=>NativeDeflateDecoder,undefined,false);
}

function fail(status,message,code){throw new TerrainDemError(status,message,code);}

export function copernicusTileUrl(lon,lat){
 if(!Number.isInteger(lon)||!Number.isInteger(lat)||lon< -180||lon>179||lat< -90||lat>89)fail(400,'إحداثيات بلاطة الارتفاع غير صالحة.','invalid_dem_tile');
 const name='Copernicus_DSM_COG_10_'+(lat<0?'S':'N')+String(Math.abs(lat)).padStart(2,'0')+'_00_'+(lon<0?'W':'E')+String(Math.abs(lon)).padStart(3,'0')+'_00_DEM';
 return HOST+'/'+name+'/'+name+'.tif';
}

async function readBoundedBody(response,budget,maximum){
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>maximum){await response.body?.cancel();fail(502,'تجاوز ملف الارتفاع حد التحميل الآمن.','dem_resource_limit');}
 if(!response.body)fail(502,'وصلت استجابة ارتفاع فارغة.');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{
  while(true){
   const {value,done}=await reader.read();if(done)break;
   length+=value.byteLength;budget.bytes+=value.byteLength;
   if(length>maximum||budget.bytes>LIMITS.bytes){await reader.cancel();fail(413,'يتطلب هذا النطاق بيانات أكثر من حد المعالجة المجانية. جرّب حدودًا أصغر.','dem_resource_limit');}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return bytes.buffer;
}

class BoundedRangeResponse extends BaseResponse{
 constructor(response,data){super();this.response=response;this.data=data;}
 get status(){return this.response.status;}
 getHeader(name){return this.response.headers.get(name)??undefined;}
 async getData(){return this.data;}
}

class BoundedRangeClient extends BaseClient{
 constructor(url,budget,fetchImpl){super(url);this.budget=budget;this.fetchImpl=fetchImpl;}
 async request(options={}){
  const range=new Headers(options.headers).get('range'),match=/^bytes=(\d+)-(\d+)$/.exec(range||'');
  if(!match)fail(502,'تعذر تحديد جزء آمن من ملف الارتفاع.','dem_format');
  const start=Number(match[1]),end=Number(match[2]),maximum=end-start+1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||maximum<=0||maximum>LIMITS.range)fail(413,'طلب الارتفاع أكبر من حد المعالجة.','dem_resource_limit');
  if(++this.budget.requests>LIMITS.requests||Date.now()>this.budget.expires)fail(504,'استغرق مصدر الارتفاع وقتًا أطول من المسموح. حاول مجددًا.','dem_timeout');
  const timeout=Math.min(15000,Math.max(1,this.budget.expires-Date.now()));
  let response;
  try{response=await this.fetchImpl(this.url,{method:'GET',headers:{Range:range},redirect:'error',signal:AbortSignal.timeout(timeout)});}
  catch(error){if(error instanceof TerrainDemError)throw error;fail(error?.name==='TimeoutError'||error?.name==='AbortError'?504:502,'تعذر الاتصال بمصدر الارتفاع الحقيقي. حاول مجددًا.','dem_upstream');}
  if(response.status===404){await response.body?.cancel();fail(422,'لا تتوفر بلاطة ارتفاع عامة لهذا الموقع. لم يُنشأ تحليل بديل.','dem_missing');}
  if(response.status!==206){await response.body?.cancel();fail(502,'مصدر الارتفاع لم يسمح بقراءة الجزء المطلوب؛ لم يُنشأ تحليل.','dem_upstream');}
  const contentRange=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
  if(!contentRange||Number(contentRange[1])!==start||Number(contentRange[2])!==end||Number(contentRange[3])<=end){await response.body?.cancel();fail(502,'استجابة مصدر الارتفاع غير مطابقة للجزء المطلوب.','dem_format');}
  const data=await readBoundedBody(response,this.budget,maximum);
  if(data.byteLength!==maximum)fail(502,'وصل جزء ناقص من ملف الارتفاع.','dem_format');
  return new BoundedRangeResponse(response,data);
 }
}

export function planTerrainGrid(polygon,maxDimension=LIMITS.dimension){
 if(!Number.isInteger(maxDimension)||maxDimension<16||maxDimension>LIMITS.dimension)fail(400,'أبعاد شبكة الارتفاع غير مدعومة.','invalid_dem_grid');
 if(polygon?.type!=='Polygon'||!Array.isArray(polygon.coordinates)||!polygon.coordinates.length||polygon.coordinates.length>32)fail(400,'حدود الحقل غير صالحة.','invalid_polygon');
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,count=0;
 for(const ring of polygon.coordinates){
  if(!Array.isArray(ring)||ring.length<4)fail(400,'حلقة حدود الحقل غير مكتملة.','invalid_polygon');
  for(const point of ring){
   if(++count>4096||!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))fail(400,'إحداثيات حدود الحقل غير صالحة.','invalid_polygon');
   const [x,y]=point;
   // These native 1-arc-second tiles cover Iraq. Higher-latitude products have a
   // different longitude spacing and are deliberately outside this adapter.
   if(x< -179.9||x>179.9||y<=-50||y>=50)fail(422,'يقع الموقع خارج نطاق شبكة الارتفاع المدعومة حاليًا.','dem_coverage');
   minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  }
  if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])fail(400,'يجب إغلاق حدود الحقل.','invalid_polygon');
 }
 if(maxX<=minX||maxY<=minY||maxX-minX>0.2||maxY-minY>0.2)fail(413,'نطاق الحقل أكبر من حد التحليل الحالي. جرّب حدودًا أصغر.','dem_resource_limit');
 // One native-post halo retains real neighbours for edge slope computation.
 const west=Math.floor(minX*3600)-1,east=Math.ceil(maxX*3600)+1,north=Math.ceil(maxY*3600)+1,south=Math.floor(minY*3600)-1;
 const stride=Math.max(1,Math.ceil(Math.max(east-west,north-south)/(maxDimension-1)));
 const width=Math.ceil((east-west)/stride)+1,height=Math.ceil((north-south)/stride)+1;
 const step=stride/3600;
 return {width,height,stride,west,north,step,bounds:[west/3600-step/2,(north-(height-1)*stride)/3600-step/2,(west+(width-1)*stride)/3600+step/2,north/3600+step/2]};
}

/** Actual, row-major north-to-south WGS84 elevation raster. Null means no data. */
export async function fetchTerrainDem({polygon,maxDimension=LIMITS.dimension},{fetchImpl=fetch}={}){
 const grid=planTerrainGrid(polygon,maxDimension),budget={bytes:0,requests:0,expires:Date.now()+LIMITS.deadline},groups=new Map();
 for(let y=0;y<grid.height;y++)for(let x=0;x<grid.width;x++){
  const nativeX=grid.west+x*grid.stride,nativeY=grid.north-y*grid.stride;
  const tileLon=Math.floor(nativeX/3600),tileLat=Math.ceil(nativeY/3600-1e-10)-1,key=tileLon+':'+tileLat;
  if(!groups.has(key))groups.set(key,{lon:tileLon,lat:tileLat,points:[]});
  groups.get(key).points.push({out:y*grid.width+x,col:nativeX-tileLon*3600,row:(tileLat+1)*3600-nativeY});
 }
 if(groups.size>LIMITS.tiles)fail(413,'يتقاطع الحقل مع بلاطات أكثر من حد المعالجة.','dem_resource_limit');
 const opened=[];let blockCount=0;
 try{
  // Inspect every native window before decoding any of the potentially costly blocks.
  for(const group of groups.values()){
   const url=copernicusTileUrl(group.lon,group.lat),tiff=await fromCustomClient(new BoundedRangeClient(url,budget,fetchImpl),{allowFullFile:false,maxRanges:0});
   const image=await tiff.getImage(0),res=image.getResolution(),origin=image.getOrigin(),keys=image.getGeoKeys();
   const bits=image.fileDirectory.getValue('BitsPerSample'),format=image.fileDirectory.getValue('SampleFormat');
   if(image.getWidth()!==3600||image.getHeight()!==3600||image.getSamplesPerPixel()!==1||Number(bits?.[0])!==32||Number(format?.[0])!==3||keys.GeographicTypeGeoKey!==4326||keys.GTRasterTypeGeoKey!==2||Math.abs(res[0]-1/3600)>1e-12||Math.abs(res[1]+1/3600)>1e-12||Math.abs(origin[0]-group.lon)>1e-8||Math.abs(origin[1]-group.lat-1)>1e-8)fail(502,'تنسيق بلاطة الارتفاع لا يطابق الشبكة المدعومة.','dem_format');
   const xs=group.points.map(p=>p.col),ys=group.points.map(p=>p.row),window=[Math.min(...xs),Math.min(...ys),Math.max(...xs)+1,Math.max(...ys)+1];
   const tileWidth=image.getTileWidth(),tileHeight=image.getTileHeight();
   if(tileWidth>1024||tileHeight>1024||!Number.isInteger(tileWidth)||!Number.isInteger(tileHeight)||tileWidth<=0||tileHeight<=0)fail(502,'حجم كتلة الارتفاع غير مدعوم.','dem_format');
   blockCount+=(Math.floor((window[2]-1)/tileWidth)-Math.floor(window[0]/tileWidth)+1)*(Math.floor((window[3]-1)/tileHeight)-Math.floor(window[1]/tileHeight)+1);
   if(blockCount>LIMITS.blocks)fail(413,'تتطلب حدود هذا الحقل أكثر من كتلتَي ارتفاع في الطلب الواحد. حدّد جزءًا أصغر لتناسب المعالجة المجانية.','dem_resource_limit');
   opened.push({...group,url,image,window,nodata:image.getGDALNoData()});
  }
  const elevations=Array(grid.width*grid.height).fill(null);
  for(const entry of opened){
   if(Date.now()>budget.expires)fail(504,'انتهت مهلة تحميل الارتفاعات. حاول مجددًا.','dem_timeout');
   const values=await entry.image.readRasters({window:entry.window,samples:[0],interleave:true,pool:null});
   const readWidth=entry.window[2]-entry.window[0];
   for(const point of entry.points){
    const value=values[(point.row-entry.window[1])*readWidth+point.col-entry.window[0]];
    if(Number.isFinite(value)&&value!==entry.nodata&&value>=-500&&value<=9000)elevations[point.out]=value;
   }
  }
  if(!elevations.some(Number.isFinite))fail(422,'لم يعطِ مصدر الارتفاع قياسات صالحة داخل النطاق. لا توجد نتيجة تحليل.','dem_no_data');
  const latitude=(grid.bounds[1]+grid.bounds[3])/2,dy=grid.step*111195.0802335329,dx=dy*Math.cos(latitude*Math.PI/180);
  return {width:grid.width,height:grid.height,bounds:grid.bounds,elevations,source:{id:'copernicus-glo30-aws-2021',name:'Copernicus DEM GLO-30 Public (DSM)',kind:'DSM',native_resolution_m:30,resolution_m:Math.max(dx,dy),sample_spacing_m:{x:dx,y:dy},pixel_size_degrees:grid.step,sampling:grid.stride===1?'native_posts':'nearest_native_decimation',decimation_factor:grid.stride,crs:'EPSG:4326',vertical_datum:'EGM2008',nominal_vertical_accuracy_m:4,release:'AWS public COG 2021 collection',acquisition_period:'2011–2015, with older gap-filled elevation sources',url:'https://registry.opendata.aws/copernicus-dem/',license_url:'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM',attribution:ATTRIBUTION,accessed_at:new Date().toISOString(),tile_urls:opened.map(t=>t.url),downloaded_bytes:budget.bytes,decoded_blocks:blockCount},sample_spacing_m:{x:dx,y:dy}};
 }catch(error){
  if(error instanceof TerrainDemError)throw error;
  fail(502,'تعذرت قراءة بيانات الارتفاع الحقيقية. لم تُستبدل بقيم تجريبية.','dem_decode');
 }
}
