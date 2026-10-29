import test from 'node:test';
import assert from 'node:assert/strict';
import {pageForVisit,buildVisitRequest} from '../visit-tracker.mjs';

const root='https://urfarmiq.github.io/ur-smart-mvp/';

test('only the seven production pages contribute aggregate page views',()=>{
 const pages={'':'home','index.html':'home','dashboard.html':'dashboard','field-map.html':'field-map','field-analysis.html':'field-analysis','satellite-analysis.html':'satellite-analysis','operations.html':'operations','weather.html':'weather'};
 for(const [file,page] of Object.entries(pages))assert.equal(pageForVisit(root+file),page);
 for(const [file,page] of Object.entries(pages))assert.equal(pageForVisit('https://ur-smart-urfarmiq.pages.dev/'+file),page);
 for(const value of [
  root+'admin.html',root+'auth.html',root+'satellite-staging-test.html',root+'unknown.html',
  root+'weather.html/extra','http://urfarmiq.github.io/ur-smart-mvp/',
  'https://urfarmiq.github.io/other/dashboard.html','https://urfarmiq.github.io/ur-smart-mvp-copy/',
  'https://urfarmiq.github.io:8443/ur-smart-mvp/','https://preview.example/ur-smart-mvp/',
  'http://localhost:8000/index.html','https://user:password@urfarmiq.github.io/ur-smart-mvp/',
  'not a URL'
 ])assert.equal(pageForVisit(value),null,value);
});

test('tracking preferences suppress collection',()=>{
 for(const privacy of [{doNotTrack:'1'},{doNotTrack:1},{globalPrivacyControl:true},{doNotTrack:'1',globalPrivacyControl:true}]){
  assert.equal(pageForVisit(root,privacy),null);
  assert.equal(buildVisitRequest(root,privacy),null);
 }
 assert.equal(pageForVisit(root,{doNotTrack:'0',globalPrivacyControl:false}),'home');
});

test('request carries a page key and public API key, never URL or identity data',()=>{
 const request=buildVisitRequest(root+'weather.html?email=private%40example.test&field=secret#private-token');
 assert.equal(request.url,'https://ynsmhtsktbubxfhsekjq.supabase.co/rest/v1/rpc/record_site_visit');
 assert.deepEqual(JSON.parse(request.options.body),{p_page:'weather'});
 assert.deepEqual(Object.keys(request.options.headers).sort(),['Content-Type','apikey']);
 assert.match(request.options.headers.apikey,/^sb_publishable_/);
 assert.equal(request.options.credentials,'omit');
 assert.equal(request.options.referrerPolicy,'no-referrer');
 assert.equal(request.options.keepalive,true);
 const serialized=JSON.stringify(request);
 for(const value of ['private@example.test','secret','private-token','Authorization','user_id','session_id'])assert.equal(serialized.includes(value),false,value);
});
