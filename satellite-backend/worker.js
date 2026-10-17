// UR Smart Sentinel-2 analytics gateway (Cloudflare Worker).
// Required secrets: SENTINEL_CLIENT_ID, SENTINEL_CLIENT_SECRET.
// Required variable: SUPABASE_URL. Optional: SUPABASE_PUBLISHABLE_KEY, ALLOWED_ORIGIN.
// Deploy this separately. Never expose Sentinel credentials in GitHub Pages.
const SH='https://sh.dataspace.copernicus.eu';
const TOKEN_URL='https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
function reply(body,status=200,origin=''){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin||'https://urfarmiq.github.io','vary':'Origin','cache-control':'no-store'}})}
const EVALSCRIPT=`//VERSION=3
function setup(){return {input:[{bands:["B04","B08","B11","SCL","dataMask"]}],output:[{id:"ndvi",bands:1,sampleType:"FLOAT32"},{id:"ndmi",bands:1,sampleType:"FLOAT32"},{id:"dataMask",bands:1}]};}
function evaluatePixel(s){let good=s.dataMask===1&&![0,1,3,8,9,10,11].includes(s.SCL);let nv=s.B08+s.B04, nm=s.B08+s.B11;if(!good||nv<=0||nm<=0)return {ndvi:[0],ndmi:[0],dataMask:[0]};return {ndvi:[(s.B08-s.B04)/nv],ndmi:[(s.B08-s.B11)/nm],dataMask:[1]};}`;
export default {async fetch(req,env){
 const origin=req.headers.get('Origin')||'';
 const allowed=env.ALLOWED_ORIGIN||'https://urfarmiq.github.io';
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':allowed,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Authorization, Content-Type','vary':'Origin'}});
 if(origin&&origin!==allowed)return reply({error:'Origin not allowed'},403,allowed);
 if(req.method!=='POST')return reply({error:'POST only'},405,allowed);
 try{
 if(!env.SENTINEL_CLIENT_ID||!env.SENTINEL_CLIENT_SECRET||!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY)return reply({error:'Satellite service is not configured'},503,allowed);
 const bearer=req.headers.get('Authorization')||'';
 if(!/^Bearer [^ ]+$/.test(bearer))return reply({error:'Login required'},401,allowed);
 const {field_id}=await req.json();
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
 const geometry=record.geometry;
 if(geometry?.type!=='Polygon'||!Array.isArray(geometry.coordinates?.[0])||geometry.coordinates[0].length<4)return reply({error:'Invalid saved polygon'},400,allowed);
 if(Number(record.area_m2)>2e7)return reply({error:'Field too large for this analysis tier'},413,allowed);
 const oauth=await fetch(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.SENTINEL_CLIENT_ID,client_secret:env.SENTINEL_CLIENT_SECRET})});
 if(!oauth.ok)return reply({error:'Satellite authentication failed'},502,allowed);
 const token=(await oauth.json()).access_token;
 const now=new Date(),start=new Date(now.getTime()-65*86400000);
 const statsRequest={input:{bounds:{geometry:{type:'Polygon',coordinates:geometry.coordinates},properties:{crs:'http://www.opengis.net/def/crs/EPSG/0/4326'}},data:[{type:'sentinel-2-l2a',dataFilter:{mosaickingOrder:'leastCC',maxCloudCoverage:60}}]},aggregation:{timeRange:{from:start.toISOString(),to:now.toISOString()},aggregationInterval:{of:'P1D'},evalscript:EVALSCRIPT,resx:20,resy:20}};
 const sr=await fetch(SH+'/statistics/v1',{method:'POST',headers:{'Authorization':'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(statsRequest)});
 if(!sr.ok){const message=(await sr.text()).slice(0,200);return reply({error:'Satellite processing failed',details:message},502,allowed)}
 const result=await sr.json();
 const items=(result.data||[]).map(x=>{const n=x.outputs?.ndvi?.bands?.B0?.stats,m=x.outputs?.ndmi?.bands?.B0?.stats;return {date:x.interval?.from,ndvi:n?.mean,ndmi:m?.mean,validPixels:n?.sampleCount-n?.noDataCount}}).filter(x=>Number.isFinite(x.ndvi)&&Number.isFinite(x.ndmi)&&x.validPixels>0).sort((a,b)=>b.date.localeCompare(a.date));
 if(!items.length)return reply({error:'No valid cloud-free pixels found in the last 65 days'},404,allowed);
 const best=items[0];return reply({field_id,ndvi:best.ndvi,ndmi:best.ndmi,date:best.date,valid_pixels:best.validPixels,source:'Sentinel-2 L2A via Sentinel Hub Statistical API',resolution_m:20,method:'Mean of valid SCL-masked pixels; newest available daily interval',note:'Field averages, not fertilizer or irrigation prescriptions'},200,allowed);
 }catch(e){return reply({error:'Analysis temporarily unavailable',details:String(e.message||e).slice(0,150)},500,allowed)}
}};