// Public catalogue descriptions only. A quotation confirms the exact item,
// availability and price; these entries do not represent stock or a purchase.
export const CATALOG=Object.freeze([
 Object.freeze({code:'drip_supplies',title:'مستلزمات الري بالتنقيط',kind:'منتجات الري',symbol:'💧',description:'حدّد احتياج شبكتك والكميات المطلوبة، لنراجع المكونات المناسبة ونجهّز عرض السعر.',scope:'تُحدد الأنواع والمقاسات والكميات في العرض.',installation:false}),
 Object.freeze({code:'drip_installation',title:'تنفيذ الري بالتنقيط',kind:'خدمة تنفيذ · واسط فقط',symbol:'🌱',description:'اطلب تنفيذ شبكة ري بالتنقيط لحقل داخل محافظة واسط، وفق نطاق ومكونات وموعد متفق عليها.',scope:'التنفيذ داخل واسط فقط؛ التكلفة والموعد حسب العرض.',installation:true}),
 Object.freeze({code:'weather_station',title:'محطة الطقس الزراعية',kind:'المحطات الزراعية',symbol:'🌦️',description:'استفسر عن محطة الطقس وحدّد ما تحتاجه لحقلِك. تراجع الإدارة الموديل والمواصفات المطلوبة ضمن عرضها.',scope:'الموديل والمواصفات والتوفر والسعر تُؤكد في العرض.',installation:false}),
 Object.freeze({code:'pest_station',title:'محطة مكافحة الحشرات',kind:'المحطات الزراعية',symbol:'🦋',description:'قدّم استفسارك عن المحطة وطبيعة الاستخدام المطلوبة، للحصول على تفاصيل المنتج وعرض مناسب.',scope:'الموديل وطريقة العمل والتوفر والسعر تُؤكد في العرض.',installation:false})
]);
export const PROVINCES=Object.freeze([
 ['baghdad','بغداد'],['basra','البصرة'],['nineveh','نينوى'],['erbil','أربيل'],['najaf','النجف'],['karbala','كربلاء'],['kirkuk','كركوك'],['anbar','الأنبار'],['diyala','ديالى'],['salah_al_din','صلاح الدين'],['dhi_qar','ذي قار'],['maysan','ميسان'],['wasit','واسط'],['babil','بابل'],['qadisiyyah','القادسية'],['muthanna','المثنى'],['sulaymaniyah','السليمانية'],['duhok','دهوك']
].map(p=>Object.freeze(p)));
export const catalogItem=code=>CATALOG.find(item=>item.code===code)||null;
export const provinceName=code=>PROVINCES.find(p=>p[0]===code)?.[1]||'غير محددة';
