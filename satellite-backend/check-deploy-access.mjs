// Read-only checks for the API reads Wrangler performs after a dashboard edit.
// Never log response data, request headers, URLs, account IDs or credential values.
import {pathToFileURL} from 'node:url';

export async function checkDeployAccess({token,accountId,workerName='ur-smart-satellite',fetchImpl=globalThis.fetch,writeLine=line=>console.log(JSON.stringify(line))}){
 if(!token||!/^[a-f0-9]{32}$/i.test(accountId||'')||!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(workerName)){
  writeLine({check:'configuration',success:false,category:'MISSING_OR_INVALID_DEPLOY_CONFIGURATION'});
  return false;
 }
 const base='https://api.cloudflare.com/client/v4/accounts/'+accountId;
 async function read(label,path){
  try{
   const response=await fetchImpl(base+path,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
   let body;try{body=await response.json()}catch{
    writeLine({check:label,http:response.status,success:false,category:'INVALID_JSON_RESPONSE'});
    return null;
   }
   const success=response.ok&&body?.success===true;
   const errorCodes=(Array.isArray(body?.errors)?body.errors:[]).map(error=>error?.code).filter(code=>typeof code==='number'&&Number.isFinite(code)||typeof code==='string'&&/^\d{1,10}$/.test(code));
   writeLine({check:label,http:response.status,success,error_codes:errorCodes});
   return success?body.result:null;
  }catch{
   writeLine({check:label,http:null,success:false,category:'NETWORK_OR_TIMEOUT_ERROR'});
   return null;
  }
 }
 const name=encodeURIComponent(workerName);
 const service=await read('service metadata','/workers/services/'+name);
 const environment=service?.default_environment?.environment;
 if(typeof environment!=='string'||!/^[a-z0-9_-]+$/i.test(environment)){
  if(service!==null)writeLine({check:'environment selection',success:false,category:'UNEXPECTED_SERVICE_METADATA'});
  return false;
 }
 const env=encodeURIComponent(environment),prefix='/workers/services/'+name+'/environments/'+env;
 const endpoints=[
  ['bindings',prefix+'/bindings'],
  ['routes',prefix+'/routes?show_zonename=true'],
  ['custom domains','/workers/domains/records?page=0&per_page=5&service='+name+'&environment='+env],
  ['subdomain',prefix+'/subdomain'],
  ['environment metadata',prefix],
  ['schedules','/workers/scripts/'+name+'/schedules'],
 ];
 const results=await Promise.all(endpoints.map(([label,path])=>read(label,path)));
 return results.every(result=>result!==null);
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const success=await checkDeployAccess({token:process.env.CLOUDFLARE_API_TOKEN,accountId:process.env.CLOUDFLARE_ACCOUNT_ID});
 process.exitCode=success?0:1;
}
