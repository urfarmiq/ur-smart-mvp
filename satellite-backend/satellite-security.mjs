// Request/resource limits for the authenticated satellite gateway.
export class SatelliteRequestError extends Error{
 constructor(status,message){super(message);this.name='SatelliteRequestError';this.status=status;}
}
const MAX_BODY_BYTES=4096,MAX_VERTICES=4096,MAX_RINGS=32,MAX_AREA_M2=2e7,MAX_BOUNDS_M2=4e7,MAX_SPAN_M=50000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INDICES=new Set(['NDVI','NDMI','SAVI','OSAVI','MSAVI2','EVI','GNDVI','NDRE','MNDWI','NBR','MSI','CIgreen','NDRE2','NDRE3','CIrededge','NIRv']);

export async function readSatelliteRequest(req){
 const declared=Number(req.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>MAX_BODY_BYTES)throw new SatelliteRequestError(413,'Request too large');
 if(!req.body)throw new SatelliteRequestError(400,'Invalid JSON request');
 const reader=req.body.getReader(),chunks=[];let total=0,timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{});},10000);
 try{
  while(true){const {done,value}=await reader.read();if(timedOut)throw new SatelliteRequestError(408,'Request body timed out');if(done)break;total+=value.byteLength;if(total>MAX_BODY_BYTES){await reader.cancel();throw new SatelliteRequestError(413,'Request too large');}chunks.push(value);}
 }finally{clearTimeout(timer);reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new SatelliteRequestError(400,'Invalid JSON request');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw new SatelliteRequestError(400,'Invalid JSON request');
 if(typeof data.field_id!=='string'||!UUID.test(data.field_id))throw new SatelliteRequestError(400,'Invalid field ID');
 if(data.action!==undefined&&data.action!==null&&!['statistics','imagery'].includes(data.action))throw new SatelliteRequestError(400,'Unsupported satellite action');
 if(data.action==='imagery'){
  if(typeof data.map_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.map_date))throw new SatelliteRequestError(400,'Invalid image date');
  const day=new Date(data.map_date+'T00:00:00.000Z'),now=new Date(),start=new Date(now.toISOString().slice(0,10)+'T00:00:00.000Z');start.setUTCDate(start.getUTCDate()-180);
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==data.map_date||day<start||day>now)throw new SatelliteRequestError(400,'Image date is outside the analysis window');
  if(data.map_index!==undefined&&data.map_index!==null&&data.map_index!==''&&(typeof data.map_index!=='string'||!INDICES.has(data.map_index)))throw new SatelliteRequestError(400,'Unsupported map indicator');
 }
 return {field_id:data.field_id,action:data.action,map_date:data.map_date,map_index:data.map_index};
}

export function validateSatellitePolygon(value,project){
 let geometry=value;
 if(typeof geometry==='string'){try{geometry=JSON.parse(geometry)}catch{throw new SatelliteRequestError(400,'Invalid saved polygon');}}
 if(geometry?.type!=='Polygon'||!Array.isArray(geometry.coordinates)||!geometry.coordinates.length)throw new SatelliteRequestError(400,'Invalid saved polygon');
 if(geometry.coordinates.length>MAX_RINGS)throw new SatelliteRequestError(413,'Field boundary is too complex');
 let count=0;
 for(const ring of geometry.coordinates){
  if(!Array.isArray(ring)||ring.length<4)throw new SatelliteRequestError(400,'Invalid saved polygon');
  count+=ring.length;if(count>MAX_VERTICES)throw new SatelliteRequestError(413,'Field boundary is too complex');
  for(const point of ring){if(!Array.isArray(point)||point.length!==2||!point.every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(point[0])>180||Math.abs(point[1])>90)throw new SatelliteRequestError(400,'Invalid field coordinates');if(point[1]<-80||point[1]>84)throw new SatelliteRequestError(400,'Field latitude is outside supported projection');}
  const first=ring[0],last=ring.at(-1);if(first[0]!==last[0]||first[1]!==last[1]||new Set(ring.slice(0,-1).map(p=>p.join(','))).size<3)throw new SatelliteRequestError(400,'Invalid saved polygon');
 }
 const ring=geometry.coordinates[0],vertices=ring.slice(0,-1),center=vertices.reduce((sum,p)=>[sum[0]+p[0]/vertices.length,sum[1]+p[1]/vertices.length],[0,0]),zone=Math.floor((center[0]+180)/6)+1;
 const projected={type:'Polygon',coordinates:geometry.coordinates.map(r=>r.map(([lon,lat])=>project(lon,lat,zone)))};
 const all=projected.coordinates.flat();if(!all.every(p=>p.every(Number.isFinite)))throw new SatelliteRequestError(400,'Invalid field coordinates');
 const bounds=all.reduce((b,[x,y])=>({minX:Math.min(b.minX,x),minY:Math.min(b.minY,y),maxX:Math.max(b.maxX,x),maxY:Math.max(b.maxY,y)}),{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity});
 const width=bounds.maxX-bounds.minX,height=bounds.maxY-bounds.minY;
 const area=points=>Math.abs(points.slice(1).reduce((sum,p,i)=>sum+points[i][0]*p[1]-p[0]*points[i][1],0))/2;
 const actualArea=area(projected.coordinates[0])-projected.coordinates.slice(1).reduce((sum,r)=>sum+area(r),0);
 if(!Number.isFinite(actualArea)||actualArea<=0||width<=0||height<=0)throw new SatelliteRequestError(400,'Invalid field area');
 if(actualArea>MAX_AREA_M2||width*height>MAX_BOUNDS_M2||width>MAX_SPAN_M||height>MAX_SPAN_M)throw new SatelliteRequestError(413,'Field too large for this analysis tier');
 return geometry;
}

export async function satelliteFetch(url,options={},timeoutMs=10000){
 try{return await fetch(url,{...options,signal:AbortSignal.timeout(timeoutMs)});}
 catch(error){if(error?.name==='AbortError'||error?.name==='TimeoutError')throw new SatelliteRequestError(504,'Satellite upstream timed out');throw new SatelliteRequestError(502,'Satellite upstream unavailable');}
}
