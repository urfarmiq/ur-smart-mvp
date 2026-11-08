import {handleTerrain,terrainStatus} from '../../../satellite-backend/terrain-service.mjs';

const origins=new Set(['https://ur-smart-urfarmiq.pages.dev','https://urfarmiq.github.io']);
const fallback='https://ur-smart-urfarmiq.pages.dev';
function reply(body:unknown,status=200,origin=fallback){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin,'cache-control':'no-store',vary:'Origin','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});}

Deno.serve(async(req:Request)=>{
 const requested=req.headers.get('origin')||'';
 if(requested&&!origins.has(requested))return reply({error:'ORIGIN_NOT_ALLOWED',message:'هذا المصدر غير مسموح.'},403);
 const origin=requested||fallback;
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'authorization, content-type, apikey, x-client-info',vary:'Origin'}});
 const env={SUPABASE_URL:Deno.env.get('SUPABASE_URL'),SUPABASE_PUBLISHABLE_KEY:Deno.env.get('SUPABASE_ANON_KEY'),SUPABASE_SERVICE_ROLE_KEY:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')};
 if(req.method==='GET')return reply(terrainStatus(env),200,origin);
 return handleTerrain(req,env,{reply,origin});
});
