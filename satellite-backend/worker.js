// UR Smart Sentinel-2 analytics gateway (Cloudflare Worker).
// Required secrets: SENTINEL_CLIENT_ID, SENTINEL_CLIENT_SECRET.
// Required variable: SUPABASE_URL. Optional: SUPABASE_PUBLISHABLE_KEY, ALLOWED_ORIGIN.
// Deploy this separately. Never expose Sentinel credentials in GitHub Pages.
const SH='https://sh.dataspace.copernicus.eu';
const TOKEN_URL='https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
function reply(body,status=200,origin=''){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin||'https://urfarmiq.github.io','vary':'Origin','cache-control':'no-store'}})}
const EVALSCRIPT=`//VERSION=3
function setup(){return {input:[{bands:["B02","B03","B04","B05","B06","B07","B08","B8A","B11","B12","SCL","dataMask"]}],output:[{id:"indices",bands:16,sampleType:"FLOAT32"},{id:"dataMask",bands:["indices"]}]};}
function evaluatePixel(s){
 const good=Number(s.dataMask)>0&&Number.isFinite(Number(s.SCL))&&![0,1,3,8,9,10,11].includes(Number(s.SCL));
 const r=(a,b)=>Math.abs(b)>1e-8?a/b:0;
 const ndvi=r(s.B08-s.B04,s.B08+s.B04),ndmi=r(s.B08-s.B11,s.B08+s.B11);
 const savi=r(1.5*(s.B08-s.B04),s.B08+s.B04+0.5),osavi=r(1.16*(s.B08-s.B04),s.B08+s.B04+0.16);
 const msavi2=(2*s.B08+1-Math.sqrt(Math.max(0,(2*s.B08+1)**2-8*(s.B08-s.B04))))/2;
 const evi=r(2.5*(s.B08-s.B04),s.B08+6*s.B04-7.5*s.B02+1),gndvi=r(s.B08-s.B03,s.B08+s.B03);
 const ndre=r(s.B08-s.B05,s.B08+s.B05),mndwi=r(s.B03-s.B11,s.B03+s.B11);
 const nbr=r(s.B08-s.B12,s.B08+s.B12),msi=r(s.B11,s.B08),cigreen=r(s.B08,s.B03)-1;
 const ndre2=r(s.B8A-s.B06,s.B8A+s.B06),ndre3=r(s.B8A-s.B07,s.B8A+s.B07),ciredge=r(s.B8A,s.B05)-1,nirv=ndvi*s.B08;
 if(!good)return {indices:Array(16).fill(0),dataMask:[0]};
 return {indices:[ndvi,ndmi,savi,osavi,msavi2,evi,gndvi,ndre,mndwi,nbr,msi,cigreen,ndre2,ndre3,ciredge,nirv],dataMask:[1]};
}
`;
function toUtm(lon,lat,zone){
 const a=6378137,e2=0.00669438,ep2=e2/(1-e2),k0=0.9996;
 const phi=lat*Math.PI/180,lambda=lon*Math.PI/180,lambda0=((zone-1)*6-180+3)*Math.PI/180;
 const sin=Math.sin(phi),cos=Math.cos(phi),tan=Math.tan(phi);
 const N=a/Math.sqrt(1-e2*sin*sin),T=tan*tan,C=ep2*cos*cos,A=cos*(lambda-lambda0);
 const M=a*((1-e2/4-3*e2*e2/64-5*e2*e2*e2/256)*phi-(3*e2/8+3*e2*e2/32+45*e2*e2*e2/1024)*Math.sin(2*phi)+(15*e2*e2/256+45*e2*e2*e2/1024)*Math.sin(4*phi)-(35*e2*e2*e2/3072)*Math.sin(6*phi));
 let x=500000+k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120);
 let y=k0*(M+N*tan*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720));
 if(lat<0)y+=10000000;
 return [x,y];
}
export default {async fetch(req,env){
 const origin=req.headers.get('Origin')||'';
 const allowed=env.ALLOWED_ORIGIN||'https://urfarmiq.github.io';
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':allowed,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Authorization, Content-Type','access-control-max-age':'86400','vary':'Origin'}});
 if(origin&&origin!==allowed)return reply({error:'Origin not allowed'},403,allowed);
 if(req.method!=='POST')return reply({error:'POST only'},405,allowed);
 try{
 if(!env.SENTINEL_CLIENT_ID||!env.SENTINEL_CLIENT_SECRET||!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY)return reply({error:'Satellite service is not configured'},503,allowed);
 const bearer=req.headers.get('Authorization')||'';
 if(!/^Bearer [^ ]+$/.test(bearer))return reply({error:'Login required'},401,allowed);
 const {field_id,action,map_date:mapDate,map_index:mapIndex}=await req.json();
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(field_id||''))return reply({error:'Invalid field ID'},400,allowed);
 const headers={'apikey':env.SUPABASE_PUBLISHABLE_KEY,'Authorization':bearer};
 const auth=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers});
 if(!auth.ok)return reply({error:'Session expired'},401,allowed);
 const u=await auth.json();
 const query=env.SUPABASE_URL+'/rest/v1/field_boundaries?field_id=eq.'+encodeURIComponent(field_id)+'&select=geometry,area_m2,owner_id&limit=1';
 const br=await fetch(query,{headers});
 if(!br.ok)return reply({error:'Could not read field boundary'},502,allowed);
 const rows=await br.json();const record=rows[0];
 if(!record||record.owner_id!==u.id)return reply({error:'Field boundary unavailable for this account'},404,allowed);
 const geometry=typeof record.geometry==='string'?JSON.parse(record.geometry):record.geometry;
 if(geometry?.type!=='Polygon'||!Array.isArray(geometry.coordinates?.[0])||geometry.coordinates[0].length<4)return reply({error:'Invalid saved polygon'},400,allowed);
 const areaM2=Number(record.area_m2);if(!Number.isFinite(areaM2)||areaM2<=0)return reply({error:'Invalid field area'},400,allowed);if(areaM2>2e7)return reply({error:'Field too large for this analysis tier'},413,allowed);
 const oauth=await fetch(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.SENTINEL_CLIENT_ID,client_secret:env.SENTINEL_CLIENT_SECRET})});
 if(!oauth.ok)return reply({error:'Satellite authentication failed'},502,allowed);
 const token=(await oauth.json()).access_token;
 const now=new Date(),start=new Date(now.getTime()-65*86400000),mapStart=new Date(now.getTime()-180*86400000);
 if(action==="imagery"){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(mapDate||""))return reply({error:"Invalid image date"},400,allowed);
   const day=new Date(mapDate+"T00:00:00.000Z");
   if(Number.isNaN(day.getTime())||day.toISOString().slice(0,10)!==mapDate||day<mapStart||day>now)return reply({error:"Image date is outside the analysis window"},400,allowed);
   const coords=geometry.coordinates.flat();
   const bounds=coords.reduce((b,p)=>({minLon:Math.min(b.minLon,p[0]),minLat:Math.min(b.minLat,p[1]),maxLon:Math.max(b.maxLon,p[0]),maxLat:Math.max(b.maxLat,p[1])}),{minLon:Infinity,minLat:Infinity,maxLon:-Infinity,maxLat:-Infinity});
   const imageRing=geometry.coordinates[0],imageCenter=imageRing.slice(0,-1).reduce((p,c)=>[p[0]+c[0],p[1]+c[1]],[0,0]).map(v=>v/Math.max(1,imageRing.length-1)),imageZone=Math.floor((imageCenter[0]+180)/6)+1,imageProjected={type:"Polygon",coordinates:geometry.coordinates.map(r=>r.map(([lon,lat])=>toUtm(lon,lat,imageZone)))};
   const projectedCoords=imageProjected.coordinates.flat();const projectedBounds=projectedCoords.reduce((b,p)=>({minX:Math.min(b.minX,p[0]),minY:Math.min(b.minY,p[1]),maxX:Math.max(b.maxX,p[0]),maxY:Math.max(b.maxY,p[1])}),{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity});const wide=Math.max(1,projectedBounds.maxX-projectedBounds.minX),high=Math.max(1,projectedBounds.maxY-projectedBounds.minY);
   const resolution=mapIndex?(["NDMI","NDRE","MNDWI","NBR","MSI","NDRE2","NDRE3","CIrededge"].includes(mapIndex)?20:10):10,maxSide=1024,width=Math.max(1,Math.min(maxSide,Math.ceil(wide/resolution))),height=Math.max(1,Math.min(maxSide,Math.ceil(high/resolution)));
   const from=day.toISOString(),to=new Date(day.getTime()+86400000-1).toISOString();
   const indexExpressions={NDVI:"(s.B08-s.B04)/(s.B08+s.B04)",NDMI:"(s.B08-s.B11)/(s.B08+s.B11)",SAVI:"1.5*(s.B08-s.B04)/(s.B08+s.B04+0.5)",OSAVI:"1.16*(s.B08-s.B04)/(s.B08+s.B04+0.16)",MSAVI2:"(2*s.B08+1-Math.sqrt(Math.max(0,(2*s.B08+1)*(2*s.B08+1)-8*(s.B08-s.B04))))/2",EVI:"2.5*(s.B08-s.B04)/(s.B08+6*s.B04-7.5*s.B02+1)",GNDVI:"(s.B08-s.B03)/(s.B08+s.B03)",NDRE:"(s.B08-s.B05)/(s.B08+s.B05)",MNDWI:"(s.B03-s.B11)/(s.B03+s.B11)",NBR:"(s.B08-s.B12)/(s.B08+s.B12)",MSI:"s.B11/s.B08",CIgreen:"s.B08/s.B03-1",NDRE2:"(s.B8A-s.B06)/(s.B8A+s.B06)",NDRE3:"(s.B8A-s.B07)/(s.B8A+s.B07)",CIrededge:"s.B8A/s.B05-1",NIRv:"((s.B08-s.B04)/(s.B08+s.B04))*s.B08"};
   const indexRanges={NDVI:[-0.2,0.8],NDMI:[-0.5,0.5],SAVI:[-0.2,0.8],OSAVI:[-0.2,0.8],MSAVI2:[-0.2,0.8],EVI:[-0.2,1],GNDVI:[-0.2,0.8],NDRE:[-0.2,0.8],MNDWI:[-0.8,0.8],NBR:[-1,1],MSI:[0,2],CIgreen:[0,4],NDRE2:[-0.2,0.8],NDRE3:[-0.2,0.8],CIrededge:[0,4],NIRv:[0,0.5]};
   let script;
   if(mapIndex){
     if(!indexExpressions[mapIndex])return reply({error:"Unsupported map indicator"},400,allowed);
     const expression=indexExpressions[mapIndex],range=indexRanges[mapIndex],invert=false,span=range[1]-range[0],scaleExpression=range[0]<0?`(v+${Math.abs(range[0])})/${span}`:`(v-${range[0]})/${span}`;
     const requiredBands={NDVI:["B08","B04"],NDMI:["B08","B11"],SAVI:["B08","B04"],OSAVI:["B08","B04"],MSAVI2:["B08","B04"],EVI:["B08","B04","B02"],GNDVI:["B08","B03"],NDRE:["B08","B05"],MNDWI:["B03","B11"],NBR:["B08","B12"],MSI:["B11","B08"],CIgreen:["B08","B03"],NDRE2:["B8A","B06"],NDRE3:["B8A","B07"],CIrededge:["B8A","B05"],NIRv:["B08","B04"]}[mapIndex];
     script=`//VERSION=3
function setup(){return {input:[{bands:["B02","B03","B04","B05","B06","B07","B08","B8A","B11","B12","SCL","dataMask"]}],output:{bands:4,sampleType:"UINT8"}};}
function evaluatePixel(s){
 const v=${expression};
 const hasSpectralData=Number(s.dataMask)>0&&![0,1,3,8,9,10,11].includes(Number(s.SCL))&&${JSON.stringify(requiredBands)}.every(k=>Number.isFinite(Number(s[k]))&&Number(s[k])>0);
 if(!hasSpectralData||!Number.isFinite(v))return [0,0,0,0];
 let t=Math.max(0,Math.min(1,${scaleExpression}));
 const gray=Math.round(t*255);return [gray,gray,gray,255];
}`;
   }else{
     script=`//VERSION=3
function setup(){return {input:[{bands:["B04","B03","B02","SCL","dataMask"]}],output:{bands:4,sampleType:"UINT8"}};}
function evaluatePixel(s){
 const scl=Number(s.SCL),rgb=["B04","B03","B02"],valid=Number(s.dataMask)>0&&![0,1,3,8,9,10,11].includes(scl)&&rgb.every(k=>Number.isFinite(Number(s[k]))&&Number(s[k])>0);
 if(!valid)return [0,0,0,0];
 const tone=v=>Math.max(0,Math.min(1,2.5*v-0.07))*255;
 return [Math.round(tone(s.B04)),Math.round(tone(s.B03)),Math.round(tone(s.B02)),255];
}`;
   }
   const body={input:{bounds:{geometry,properties:{crs:"http://www.opengis.net/def/crs/OGC/1.3/CRS84"}},data:[{type:"sentinel-2-l2a",dataFilter:{timeRange:{from,to},mosaickingOrder:"leastCC",maxCloudCoverage:100}}]},output:{width,height,responses:[{identifier:"default",format:{type:"image/png"}}]},evalscript:script};
   const imageRes=await fetch(SH+"/process/v1",{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(body)});
   if(!imageRes.ok)return reply({error:mapIndex?"Indicator raster unavailable":"Satellite image unavailable",details:(await imageRes.text()).slice(0,180)},502,allowed);
   const bytes=new Uint8Array(await imageRes.arrayBuffer());let binary="";
   for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
   const mapBounds=[[bounds.minLat,bounds.minLon],[bounds.maxLat,bounds.maxLon]];
   return reply({field_id,date:mapDate,index:mapIndex||null,image:"data:image/png;base64,"+btoa(binary),bounds:mapBounds,resolution_m:resolution,source:mapIndex?"Sentinel-2 L2A per-pixel "+mapIndex+" raster via Copernicus Data Space":"Sentinel-2 L2A true color via Copernicus Data Space"},200,allowed);
 }
 const ring=geometry.coordinates[0];const center=ring.slice(0,-1).reduce((p,c)=>[p[0]+c[0],p[1]+c[1]],[0,0]).map(v=>v/Math.max(1,ring.length-1));const zone=Math.floor((center[0]+180)/6)+1;const epsg=(center[1]<0?32700:32600)+zone;const projected={type:'Polygon',coordinates:geometry.coordinates.map(r=>r.map(([lon,lat])=>toUtm(lon,lat,zone)))};const indexNames=["NDVI","NDMI","SAVI","OSAVI","MSAVI2","EVI","GNDVI","NDRE","MNDWI","NBR","MSI","CIgreen","NDRE2","NDRE3","CIrededge","NIRv"];
 const parseItems=result=>(result.data||[]).map(x=>{const bands=x.outputs?.indices?.bands||{};const indices=Object.fromEntries(indexNames.map((n,i)=>[n,bands["B"+i]?.stats?.mean]));const n=bands.B0?.stats;return {date:x.interval?.from,indices,ndvi:indices.NDVI,ndmi:indices.NDMI,validPixels:n?.sampleCount-n?.noDataCount}}).filter(x=>Number.isFinite(x.ndvi)&&Number.isFinite(x.ndmi)&&x.validPixels>0).sort((a,b)=>b.validPixels-a.validPixels||b.date.localeCompare(a.date));
 const runStats=async(days)=>{const rangeStart=new Date(now.getTime()-days*86400000);const statsRequest={input:{bounds:{geometry:projected,properties:{crs:'http://www.opengis.net/def/crs/EPSG/0/'+epsg}},data:[{type:'sentinel-2-l2a',dataFilter:{mosaickingOrder:'leastCC',maxCloudCoverage:100}}]},aggregation:{timeRange:{from:rangeStart.toISOString(),to:now.toISOString()},aggregationInterval:{of:'P1D'},evalscript:EVALSCRIPT,resx:20,resy:20}};const response=await fetch(SH+'/statistics/v1',{method:'POST',headers:{'Authorization':'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(statsRequest)});if(!response.ok){const message=(await response.text()).slice(0,200);throw Error('Satellite processing failed: '+message)}return response.json()};
 let searchedDays=65,result=await runStats(65),items=parseItems(result);
 if(!items.length){searchedDays=180;result=await runStats(180);items=parseItems(result)}
 if(!items.length)return reply({error:'No valid cloud-free pixels found in the last 180 days',searched_days:180,message:'لم نجد بكسلات صالحة خالية من الغيوم خلال 180 يومًا. تحقق من حدود الحقل أو أعد المحاولة عند مرور مشهد أقمار أوضح.'},404,allowed);
 const newest=items.filter(x=>x.validPixels>=3).sort((a,b)=>b.date.localeCompare(a.date))[0];const best=newest||items[0];const totalPixels=Number(result.geometryPixelCount);const coveragePercent=Number.isFinite(totalPixels)&&totalPixels>0?Math.round(best.validPixels/totalPixels*1000)/10:null;const series=items.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(x=>({date:x.date,indices:x.indices,ndvi:x.ndvi,ndmi:x.ndmi,valid_pixels:x.validPixels,geometry_pixels:Number.isFinite(totalPixels)?totalPixels:null,coverage_percent:Number.isFinite(totalPixels)&&totalPixels>0?Math.round(x.validPixels/totalPixels*1000)/10:null}));return reply({field_id,geometry,series,ndvi:best.ndvi,ndmi:best.ndmi,indices:best.indices,date:best.date,valid_pixels:best.validPixels,geometry_pixels:Number.isFinite(totalPixels)?totalPixels:null,coverage_percent:coveragePercent,source:'Sentinel-2 L2A via Sentinel Hub Statistical API',resolution_m:20,search_window_days:searchedDays,note:searchedDays>65?'لم يتوفر مشهد صالح في آخر 65 يومًا؛ عُرض أحدث مشهد صالح من نافذة بحث موسعة حتى 180 يومًا.':'مشهد صالح ضمن آخر 65 يومًا. القيم متوسطات بكسلات صالحة بعد قناع السحب.'},200,allowed);
 }catch(e){return reply({error:'Analysis temporarily unavailable',details:String(e.message||e).slice(0,150)},500,allowed)}
}};
