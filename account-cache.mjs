// Account separation for device caches. This is not a replacement for server RLS.
function identity(userId){
 if(typeof userId!=='string'||!userId.trim()||userId!==userId.trim()||userId.length>256||/[\u0000-\u001f\u007f]/.test(userId))throw Error('سجّل الدخول إلى حسابك قبل استخدام الحفظ المحلي.');
 return userId;
}

export function accountCacheKey(namespace,userId){
 if(typeof namespace!=='string'||!namespace.trim()||namespace.length>128)throw Error('اسم الحفظ المحلي غير صالح.');
 return encodeURIComponent(namespace)+':account:'+encodeURIComponent(identity(userId));
}

export function readAccountCache(storage,namespace,userId,fallback=null){
 const key=accountCacheKey(namespace,userId),raw=storage.getItem(key);
 if(raw===null)return fallback;
 const record=JSON.parse(raw);
 if(!record||record.version!==1||record.owner_id!==userId||!Object.hasOwn(record,'value'))throw Error('تعذر قراءة النسخة المحلية لهذا الحساب. لم تُغيّر البيانات المحفوظة.');
 return record.value;
}

export function writeAccountCache(storage,namespace,userId,value){
 const key=accountCacheKey(namespace,userId);
 if(value===undefined||typeof value==='function'||typeof value==='symbol')throw Error('بيانات الحفظ المحلي غير صالحة.');
 storage.setItem(key,JSON.stringify({version:1,owner_id:userId,value}));
 return key;
}
