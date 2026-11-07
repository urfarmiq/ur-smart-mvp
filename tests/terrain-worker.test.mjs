import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../satellite-backend/worker.js';

const ORIGIN='https://ur-smart-urfarmiq.pages.dev';
const ENV={SUPABASE_URL:'https://supabase.test',SUPABASE_PUBLISHABLE_KEY:'publishable',SENTINEL_CLIENT_ID:'client',SENTINEL_CLIENT_SECRET:'secret'};

test('terrain status is independent of Sentinel analysis routes and hides credentials',async()=>{
 const response=await worker.fetch(new Request('https://worker.test/terrain/status',{headers:{Origin:ORIGIN}}),{});
 assert.equal(response.status,200);
 assert.equal(response.headers.get('access-control-allow-origin'),ORIGIN);
 const status=await response.json();
 assert.equal(status.available,false);
 assert.equal(status.source,'Copernicus DEM via Sentinel Hub Process API');
 assert.ok(!JSON.stringify(status).includes('secret'));
});

test('terrain analysis rejects missing login before calling external services',async()=>{
 const response=await worker.fetch(new Request('https://worker.test/terrain/analyze',{
  method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},
  body:JSON.stringify({field_id:'11111111-1111-4111-8111-111111111111'})
 }),ENV);
 assert.equal(response.status,401);
 assert.equal(response.headers.get('access-control-allow-origin'),ORIGIN);
 assert.equal((await response.json()).code,'AUTH_REQUIRED');
});

test('terrain endpoints reject untrusted origins',async()=>{
 const response=await worker.fetch(new Request('https://worker.test/terrain/status',{headers:{Origin:'https://untrusted.example'}}),{});
 assert.equal(response.status,403);
});

test('terrain analysis requires a saved field ID and JSON body',async()=>{
 const response=await worker.fetch(new Request('https://worker.test/terrain/analyze',{
  method:'POST',headers:{Origin:ORIGIN,'Content-Type':'text/plain'},body:'{}'
 }),ENV);
 assert.equal(response.status,415);
 assert.equal((await response.json()).code,'INVALID_REQUEST');
});
