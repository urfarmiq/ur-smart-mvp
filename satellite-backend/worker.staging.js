// UR Smart Sentinel-2 analytics gateway (Cloudflare Worker).
// Required secrets: SENTINEL_CLIENT_ID, SENTINEL_CLIENT_SECRET.
// Required variable: SUPABASE_URL. Optional: SUPABASE_PUBLISHABLE_KEY, ALLOWED_ORIGIN.
// Deploy this separately. Never expose Sentinel credentials in GitHub Pages.
const SH='https://sh.dataspace.copernicus.eu';
const TOKEN_URL='https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
function reply(body,status=200,origin=''){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin||'https://urfarmiq.github.io','vary':'Origin','cache-control':'no-store'}})}
// For EPSG:4326, resolution values are degrees, not meters. ~0.00018° is approximately 20 m north-south; east-west varies by latitude.
const EVALSCRIPT=`//VERSION=3
function setup(){return {input:[{bands:["B04","B08","B11","SCL","dataMask"]}],output:[{id:"ndvi",bands:1,sampleType:"FLOAT32"},{id:"ndmi",bands:1,sampleType:"FLOAT32"},{id:"dataMask",bands:1}]};}
function evaluatePixel(s){let good=s.dataMask===1&&![0,1,3,8,9,10,11].includes(s.SCL);let nv=s.B08+s.B04, nm=s.B08+s.B11;if(!good||nv<=0||nm<=0)return {ndvi:[0],ndmi:[0],dataMask:[0]};return {ndvi:[(s.B08-s.B04)/nv],ndmi:[(s.B08-s.B11)/nm],dataMask:[1]};}`;
export default {async fetch(req,env){
 const origin=req.headers.get('Origin')||'';
 const allowed=env.ALLOWED_ORIGIN||'https://urfarmiq.github.io';
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':allowed,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Authorization, Content-Type','access-control-max-age':'86400','vary':'Origin'}});
 if(origin&&origin!==allowed)return reply({error:'Origin not allowed'},403,allowed);
 if(req.method!=='POST')return reply({error:'POST only'},405,allowed);
 try{
 if(!env.SENTINEL_CLIENT_ID||!env.SENTINEL_CLIENT_SECRET||!env.SUPABASE_URL||!(env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY))return reply({error:'Satellite service is not configured'},503,allowed);
 const bearer=req.headers.get('Authorization')||'';
 if(!/^Bearer [^ ]+$/.test(bearer))return reply({error:'Login required'},401,allowed);
 const {field_id,visualization}=await req.json();
 if(visualization!==undefined&&!['ndvi','ndmi','truecolor'].includes(visualization))return reply({error:'Invalid visualization'},400,allowed);
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(field_id||''))return reply({error:'Invalid field ID'},400,allowed);
 const headers={'apikey':env.SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY,'Authorization':bearer};
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
 if(!Number.isFinite(Number(record.area_m2))||Number(record.area_m2)<=0)return reply({error:'Invalid field area'},400,allowed);
 if(Number(record.area_m2)>2e7)return reply({error:'Field too large for this analysis tier'},413,allowed);
 const oauth=await fetch(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.SENTINEL_CLIENT_ID,client_secret:env.SENTINEL_CLIENT_SECRET})});
 if(!oauth.ok)return reply({error:'Satellite authentication failed'},502,allowed);
 const token=(await oauth.json()).access_token;
 const now=new Date(),start=new Date(now.getTime()-65*86400000);
 if(visualization){
  // Process API creates a real Sentinel-2 PNG clipped to the saved field polygon.
  const ring=geometry.coordinates.flat(2).filter((_,i)=>i%2===0);
  const pts=geometry.coordinates.flat(1);
  const xs=pts.map(p=>Number(p[0])),ys=pts.map(p=>Number(p[1]));
  if(xs.some(x=>!Number.isFinite(x))||ys.some(y=>!Number.isFinite(y)))return reply({error:'Invalid coordinates'},400,allowed);
  const bbox=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  const centerLat=(bbox[1]+bbox[3])/2;
  const wMeters=(bbox[2]-bbox[0])*111320*Math.cos(centerLat*Math.PI/180);
  const hMeters=(bbox[3]-bbox[1])*111320;
  const width=Math.max(16,Math.min(1024,Math.ceil(wMeters/10)));
  const height=Math.max(16,Math.min(1024,Math.ceil(hMeters/10)));
  const expression=visualization==='truecolor'?'return [2.5*s.B04,2.5*s.B03,2.5*s.B02,1]':visualization==='ndvi'?'let v=(s.B08-s.B04)/(s.B08+s.B04+0.00001);return [v<0.15?0.78:v<0.35?0.96:v<0.55?0.60:0.10,v<0.15?0.23:v<0.35?0.77:v<0.55?0.80:0.55,v<0.15?0.18:v<0.35?0.16:v<0.55?0.22:0.18,1]':'let v=(s.B08-s.B11)/(s.B08+s.B11+0.00001);return [v<0?0.77:v<0.2?0.96:v<0.4?0.32:0.08,v<0?0.41:v<0.2?0.84:v<0.4?0.76:0.39,v<0?0.17:v<0.2?0.25:v<0.4?0.84:0.65,1]';
  const evalscript='//VERSION=3\\nfunction setup(){return {input:[{bands:["B02","B03","B04","B08","B11","SCL","dataMask"]}],output:{bands:4,sampleType:"FLOAT32"}};}\\nfunction evaluatePixel(s){if(s.dataMask!==1||[0,1,3,8,9,10,11].includes(s.SCL))return [0,0,0,0];'+expression+'}';
  const body={input:{bounds:{bbox,geometry,properties:{crs:'http://www.opengis.net/def/crs/EPSG/0/4326'}},data:[{type:'sentinel-2-l2a',dataFilter:{timeRange:{from:start.toISOString(),to:now.toISOString()},mosaickingOrder:'leastCC',maxCloudCoverage:60}}]},output:{width,height,responses:[{identifier:'default',format:{type:'image/png'}}]},evalscript};
  const pr=await fetch(SH+'/api/v1/process',{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
  if(!pr.ok)return reply({error:'Satellite image unavailable',details:(await pr.text()).slice(0,160)},502,allowed);
  return new Response(pr.body,{status:200,headers:{'content-type':'image/png','cache-control':'private, no-store','access-control-allow-origin':allowed,'vary':'Origin','x-ur-visualization':visualization}});
 }

 const statsRequest={input:{bounds:{geometry:{type:'Polygon',coordinates:geometry.coordinates},properties:{crs:'http://www.opengis.net/def/crs/EPSG/0/4326'}},data:[{type:'sentinel-2-l2a',dataFilter:{mosaickingOrder:'leastCC',maxCloudCoverage:60}}]},aggregation:{timeRange:{from:start.toISOString(),to:now.toISOString()},aggregationInterval:{of:'P1D',lastIntervalBehavior:'SHORTEN'},evalscript:EVALSCRIPT,resx:0.00018,resy:0.00018}};
 const sr=await fetch(SH+'/statistics/v1',{method:'POST',headers:{'Authorization':'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(statsRequest)});
 if(!sr.ok){const message=(await sr.text()).slice(0,200);return reply({error:'Satellite processing failed',details:message},502,allowed)}
 const result=await sr.json();
 // Sentinel Hub reports sampleCount and noDataCount per interval and output band.
 // Valid-pixel fraction must use matching interval statistics, not a top-level geometryPixelCount.
 const MIN_VALID_PIXELS=3,MIN_COVERAGE=0.60;
 const candidates=(result.data||[]).map(x=>{
  const n=x.outputs?.ndvi?.bands?.B0?.stats,m=x.outputs?.ndmi?.bands?.B0?.stats;
  const geometryPixels=n?.sampleCount==null?NaN:Number(n.sampleCount);
  const noDataPixels=n?.noDataCount==null?NaN:Number(n.noDataCount);
  const validPixels=geometryPixels-noDataPixels;
  const coverage=Number.isFinite(geometryPixels)&&geometryPixels>0&&Number.isFinite(noDataPixels)?validPixels/geometryPixels:null;
  return {date:x.interval?.from,ndvi:n?.mean,ndmi:m?.mean,validPixels,geometryPixels,coverage};
 });
 const items=candidates.filter(x=>Number.isFinite(x.ndvi)&&Number.isFinite(x.ndmi)&&Number.isFinite(x.validPixels)&&x.validPixels>=MIN_VALID_PIXELS&&x.coverage!==null&&x.coverage>=MIN_COVERAGE).sort((a,b)=>b.date.localeCompare(a.date));
 if(!items.length){const bestCandidate=candidates.filter(x=>Number.isFinite(x.validPixels)).sort((a,b)=>b.validPixels-a.validPixels)[0];return reply({error:'Insufficient satellite coverage for a reliable field average',min_valid_pixels:MIN_VALID_PIXELS,min_coverage_percent:60,intervals_checked:candidates.length,best_available_valid_pixels:bestCandidate?.validPixels??null,best_available_coverage_percent:bestCandidate?.coverage==null?null:Math.round(bestCandidate.coverage*1000)/10,geometry_pixels:bestCandidate?.geometryPixels??null},422,allowed)}
 const best=items[0];return reply({field_id,ndvi:best.ndvi,ndmi:best.ndmi,date:best.date,valid_pixels:best.validPixels,coverage_percent:Math.round(best.coverage*1000)/10,geometry_pixels:best.geometryPixels,source:'Sentinel-2 L2A via Sentinel Hub Statistical API',resolution_m_approx:20,resolution_m:null,method:'Mean of valid SCL-masked pixels; newest available daily interval',note:'Field averages, not fertilizer or irrigation prescriptions'},200,allowed);
 }catch(e){return reply({error:'Analysis temporarily unavailable',details:String(e.message||e).slice(0,150)},500,allowed)}
}};