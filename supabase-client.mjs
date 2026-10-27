// The pinned browser bundle is served with the site, without a runtime CDN chain.
import './vendor/supabase-js-2.57.4.js';

const sdk=globalThis.supabase;
if(typeof sdk?.createClient!=='function')throw Error('تعذر تحميل مكتبة الاتصال. أعد تحميل الصفحة.');
export const createClient=sdk.createClient;
