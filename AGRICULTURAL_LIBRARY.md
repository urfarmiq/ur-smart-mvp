# المكتبة الزراعية ذات المسارين – أور الزراعية

آخر تحديث: 2026-11-23

## الهدف
تقدم المكتبة مستويين منفصلين من المعرفة:
- **دليل المزارع:** لغة مباشرة وخطوات ميدانية، مع توضيح متى يلزم التحليل أو الاستعانة بمختص.
- **المكتبة العلمية:** منهجيات أخذ العينات والقياس والتحليل والتصميم التجريبي، مع المصطلحات والوحدات والمعادلات ومراجع فنية.

## صفحات الدخول
- [المكتبة الزراعية](./articles.html)
- [دليل المزارع](./farmer-library.html)
- [المكتبة العلمية](./research-library.html)
- [منهجية التحرير والتحقق](./editorial-policy.html)

## فصول المسار العلمي
1. [أخذ عينات التربة](./research-soil-sampling.html)
2. [تشخيص الملوحة والصودية](./research-salinity-diagnostics.html)
3. [الاحتياجات المائية والميزان المائي](./research-irrigation-water-balance.html)
4. [معايرة اختبارات التربة والتسميد](./research-nutrient-calibration.html)
5. [مراحل نمو الحنطة](./research-wheat-phenology.html)
6. [تصميم التجارب الحقلية](./research-field-trials.html)

## قواعد الدقة
- لا تُنقل جرعات السماد أو الري أو الحدود التصنيفية من بلد أو نظام مختبري إلى العراق دون معايرة محلية.
- يجب ذكر طريقة التحليل وعمق العينة ونسبة الاستخلاص والوحدة عندما تؤثر في تفسير النتيجة.
- لا يُعامل NDVI أو EC أو أي مؤشر منفرد بوصفه تشخيصًا لسبب المشكلة.
- لا يُعرض المحتوى على أنه مراجعة محكمة أو توصية رسمية ما لم يوجد توثيق صريح لذلك.
- يجب فصل العينة الفرعية عن الوحدة التجريبية، وتجنب التكرار الوهمي في التجارب.
- عند تحديث مرجع أو معلومة، يُسجل تاريخ التحديث ويُراجع الرابط.

## حالة المراجعة
الفصول الجديدة مواد تعليمية تحريرية أعدها فريق المحتوى الزراعي في أور، مع إحالات إلى مصادر فنية أصلية. لم تُعلن مراجعة فنية مستقلة منشورة لهذه الفصول. لذلك لا تُستخدم بديلًا عن البروتوكولات الرسمية أو المختبرات أو الإرشاد الزراعي المحلي.

## المصادر الأساسية المستخدمة
- FAO, Soil and plant testing and analysis as a basis of fertilizer recommendations, Soils Bulletin 38/2: https://www.fao.org/4/ar118e/ar118e.pdf
- FAO, Soil analysis and sampling: https://www.fao.org/4/i0131e/i0131e00.pdf
- FAO, Crop evapotranspiration / Irrigation and Drainage Paper 56: https://www.fao.org/4/X0490E/X0490E00.htm
- FAO, CROPWAT: https://www.fao.org/land-water/land/land-governance-and-planning/land-resources-planning-toolbox/detail/crop-water-and-irrigation-requirements-program-of-fao-%28cropwat%29/en
- USDA NRCS, Soil Survey Manual: https://www.nrcs.usda.gov/sites/default/files/2022-09/The-Soil-Survey-Manual.pdf
- USDA NRCS, Soil Electrical Conductivity: https://www.nrcs.usda.gov/sites/default/files/2022-10/Soil%20Electrical%20Conductivity.pdf
- University of Minnesota Extension, Wheat growth and development: https://extension.umn.edu/agriculture/crop-production/small-grains/spring-wheat-growth-and-development-guide
- Oregon State University Extension, Experimenting on the Farm: https://extension.oregonstate.edu/catalog/em-9381-experimenting-farm-introduction-experimental-design
- University of Florida IFAS, Planning and Establishing On-Farm Field Trials: https://ask.ifas.ufl.edu/publication/AG447

## اختبارات قبل النشر
شغّل:
- `python tests/check_pages.py`
- `node --test tests/*.test.mjs`

ثم اختبر فتح المسارين والروابط من هاتف وحاسوب. نجاح الاختبارات الساكنة لا يثبت وحده أن كل مصدر خارجي ما زال متاحًا أو أن المحتوى خضع لتحكيم علمي.
