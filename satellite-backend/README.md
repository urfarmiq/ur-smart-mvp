# UR Smart — Sentinel-2 NDVI / NDMI

هذا العامل الخلفي منفصل عن GitHub Pages. يتحقق من جلسة المزارع في Supabase، ويقرأ حدود حقله وفق سياسات RLS، ثم يطلب إحصاءات Sentinel-2 L2A من Sentinel Hub.

## الإعداد

1. أنشئ OAuth client في Copernicus Data Space Ecosystem مع صلاحية Sentinel Hub Statistical API.
2. أضف أسرار Cloudflare Worker:
   - `SENTINEL_CLIENT_ID`
   - `SENTINEL_CLIENT_SECRET`
3. أضف متغيرات Worker:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `ALLOWED_ORIGIN=https://urfarmiq.github.io`
4. تأكد أن صفحة `satellite-analysis.html` تشير إلى عنوان العامل المنشور.
5. أضف حدًا للطلبات وحصة استخدام في Sentinel Hub قبل فتح الخدمة للجمهور.

لا تحفظ بيانات Sentinel أو Cloudflare السرية في GitHub أو صفحات HTML، ولا ترسلها عبر المحادثة.

## التحليل وجودة العينة

- تُقرأ حدود الحقل المحفوظة في `field_boundaries` وتُحوّل إلى نظام UTM بالمتر قبل طلب الدقة المكانية.
- تُغطّي المعالجة آخر 65 يومًا، وتختار الفترة ذات أكبر عدد من البكسلات الصالحة؛ وعند التعادل تختار الأحدث.
- يُستبعد الماء والغيوم والظلال عبر طبقة SCL، مع استبعاد البكسلات خارج المضلع.
- تُرجع الخدمة NDVI وNDMI وتاريخ الرصد وعدد البكسلات الصالحة والإجمالي ونسبة التغطية.
- لا تُرجع توصية مؤكدة للري أو التسميد؛ المتوسطات الفضائية لا تقيس رطوبة التربة أو NPK مباشرة.

يقرأ السجل المعروض في صفحة التحليل من تخزين المتصفح على الجهاز الحالي، ولا يُحفظ في Supabase.
