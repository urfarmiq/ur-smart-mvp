// Public presentation helpers. Access is independently checked by the server.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SATELLITE_PAYMENT_MESSAGE='التحليل الفضائي خدمة مدفوعة لهذا الحقل.';
export function satelliteAccessUrl(fieldId){return './satellite-access.html'+(UUID.test(fieldId||'')?'?field='+encodeURIComponent(fieldId):'');}
export function updateSatelliteAccessLink(link,fieldId){if(link)link.href=satelliteAccessUrl(fieldId);}
export function isSatellitePaymentRequired(error){return error?.code==='SATELLITE_PAYMENT_REQUIRED'||String(error?.message||error||'').includes(SATELLITE_PAYMENT_MESSAGE);}
export function satelliteResponseError(response,data,fallback='تعذر تحميل التحليل الفضائي.'){
 const paid=response?.status===403&&data?.code==='SATELLITE_PAYMENT_REQUIRED';
 const error=Error(paid?SATELLITE_PAYMENT_MESSAGE+' اطلب التفعيل أو التجديد بعد الاتفاق على السعر والمدة وتأكيد الدفع.':data?.message||data?.error||fallback);
 if(paid)error.code='SATELLITE_PAYMENT_REQUIRED';return error;
}
export function showSatellitePayment(container,fieldId){
 if(!container)return;const message=document.createElement('p'),link=document.createElement('a');
 message.textContent=SATELLITE_PAYMENT_MESSAGE+' تُحدد المدة والسعر في عرض توافق عليه، ثم تؤكد الإدارة استلام الدفع.';
 link.href=satelliteAccessUrl(fieldId);link.textContent='طلب أو تجديد تفعيل التحليل الفضائي ←';link.className='satellite-payment-link';
 container.replaceChildren(message,link);
}
