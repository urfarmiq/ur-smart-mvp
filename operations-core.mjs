export const types=['زراعة','ري','تسميد','مراقبة آفات','حصاد','صيانة'];
export function validateEntry(value){
 if(!value||!types.includes(value.type)||typeof value.notes!=='string'||!value.notes.trim()||value.notes.length>1000)throw Error('بيانات العملية غير صالحة');
 if(typeof value.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.date))throw Error('تاريخ العملية غير صالح');
 const d=new Date(value.date+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value.date)throw Error('تاريخ العملية غير صالح');
 return {date:value.date,type:value.type,notes:value.notes.trim()};
}
export function validateBackup(value,fieldId){
 if(value?.version!==1||value.field_id!==fieldId||!Array.isArray(value.operations)||value.operations.length>5000)throw Error('النسخة لا تخص الحقل المختار أو تنسيقها غير صالح');
 return value.operations.map(validateEntry);
}
export function localKey(userId,fieldId){if(!userId||!fieldId)throw Error('اختر حقلًا وسجّل الدخول');return `ur-smart-operations-v1:${userId}:${fieldId}`;}
