// Source-checked Iraqi planting references. No API, account or storage access.
// A matching month means overlap with periodLabel, not every day of that month.
// Empty zones mean a general reference; unspecified cover is not an open-field claim.
export const REVIEWED_AT = "2026-11-07";

export const SOURCES = [
  {
    "id": "fao-calendar",
    "title": "التقويم الزراعي المرجعي للعراق — GIEWS",
    "publisher": "منظمة الأغذية والزراعة للأمم المتحدة (FAO)",
    "url": "https://www.fao.org/giews/countrybrief/country/IRQ/graphics/1_2026-09-01.jpg",
    "locator": "الشريط الخاص بالبذر/الزراعة: الحنطة والشعير والبطاطا",
    "published": "2026-09-01",
    "scopeNote": "مرجع وطني موسمي عام. يعرض نافذة واحدة للبطاطا، ولا يغطي جميع عراها أو الاختلافات المحلية؛ لا يمثل موافقة على خطة زراعية أو تخصيص مياه."
  },
  {
    "id": "fao-archive",
    "title": "أرشيف الموجز القطري للعراق — GIEWS",
    "publisher": "منظمة الأغذية والزراعة للأمم المتحدة (FAO)",
    "url": "https://www.fao.org/giews/countrybrief/country/IRQ/pdf_archive/IRQ_Archive.pdf",
    "locator": "صفحة PDF 31: بداية زراعة الشعير منتصف تشرين الأول والحنطة بداية تشرين الثاني، واستمرار البذر عادة إلى منتصف كانون الأول؛ صفحة 13: اختلاف نظم المياه؛ صفحة 1: موسم 2026",
    "scopeNote": "تُستخدم أوصاف المواسم السابقة لتحديد حدود النافذة المرجعية، ولا تُعامل كتوجيه لحقل معين أو كتخصيص مياه للموسم الحالي."
  },
  {
    "id": "samarra-winter",
    "title": "ماذا نزرع في شهر كانون الأول",
    "publisher": "كلية الزراعة — جامعة سامراء",
    "url": "https://uosamarra.edu.iq/agr-news/ماذا-نزرع-في-شهر-كانون-الأول/",
    "locator": "جدول المحاصيل ومواعيد الزراعة",
    "published": "2022-12-20",
    "scopeNote": "مرجع تعليمي منشور في سامراء؛ لا يفصل المواعيد بحسب شمال العراق وجنوبه أو بحسب الزراعة المحمية والمكشوفة، لذا تعرض بياناته كمراجع عامة."
  },
  {
    "id": "baghdad-summer",
    "title": "محاصيل خضر صيفية — المرحلة الثالثة، د. وفاء علي حسين",
    "publisher": "كلية الزراعة — جامعة بغداد",
    "url": "https://coagri.uobaghdad.edu.iq/wp-content/uploads/sites/10/uploads/1%20hort%20dep.%20Aseel/hort%20lectures/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC%20%D8%AE%D8%B6%D8%B1%20%D9%85%D8%B1%D8%AD%D9%84%D8%A9%20%D8%AB%D8%A7%D9%84%D8%AB%D8%A9%20%D9%83%D9%88%D8%B1%D8%B3%20%D8%B1%D8%A8%D9%8A%D8%B9%D9%8A.pdf",
    "locator": "أقسام البطاطا والطماطم والباذنجان والفلفل والخيار وقرع الكوسة واللوبيا والباميا؛ فقرة موعد الزراعة في كل قسم",
    "published": "2016/2017",
    "scopeNote": "مقرر تعليمي عن إنتاج الخضر في العراق. تُحفظ الفروق الإقليمية ونوع الغطاء عندما يذكرها النص؛ الفقرات التي لا تحدد المنطقة تبقى مراجع عامة، وليست خريطة ملاءمة لجميع المحافظات."
  },
  {
    "id": "mosul-cereals",
    "title": "محاصيل حبوب وبقول",
    "publisher": "كلية الزراعة والغابات — جامعة الموصل",
    "url": "https://uomosul.edu.iq/agriculture/wp-content/uploads/sites/11/2023/09/%D9%85%D8%AD%D8%A7%D8%B5%D9%8A%D9%84-%D8%AD%D8%A8%D9%88%D8%A8-%D9%88%D8%A8%D9%82%D9%88%D9%84.pdf",
    "locator": "قسم الذرة الصفراء: موعد الزراعة؛ الباقلاء صفحة PDF 100؛ العدس صفحة PDF 114",
    "scopeNote": "مرجع جامعي مستضاف ضمن ملفات 2023؛ لم يتحقق تاريخ تأليف المقرر. ذُكرت منطقة الوسط والجنوب صراحة للذرة الربيعية، بينما سياق العدس يشمل شمال العراق والزراعة الديمية. الفقرات غير المفصلة إقليمياً تبقى عامة."
  }
];

export const PLANTING_WINDOWS = [
  {
    "id": "wheat-national-winter",
    "cropId": "wheat",
    "cropName": "الحنطة",
    "aliases": [
      "حنطة",
      "قمح"
    ],
    "category": "field",
    "season": "winter",
    "method": "open",
    "operation": "sow",
    "months": [
      11,
      12
    ],
    "zones": [
      "all"
    ],
    "periodLabel": "بداية تشرين الثاني إلى منتصف كانون الأول",
    "notes": [
      "نافذة وطنية مرجعية؛ ظهور كانون الأول لا يعني أن أواخر الشهر ضمن الموعد.",
      "يتحدد البذر الفعلي بالصنف ورطوبة التربة وبداية المطر أو توافر الري والخطة الزراعية المحلية."
    ],
    "sourceIds": [
      "fao-calendar",
      "fao-archive"
    ]
  },
  {
    "id": "barley-national-winter",
    "cropId": "barley",
    "cropName": "الشعير",
    "aliases": [
      "شعير"
    ],
    "category": "field",
    "season": "winter",
    "method": "open",
    "operation": "sow",
    "months": [
      10,
      11,
      12
    ],
    "zones": [
      "all"
    ],
    "periodLabel": "منتصف تشرين الأول إلى منتصف كانون الأول",
    "notes": [
      "نافذة وطنية مرجعية؛ ليست جميع أيام تشرين الأول وكانون الأول ضمن الموعد.",
      "اختيار الموعد داخل النافذة يعتمد على الأمطار والري والصنف والبرودة المحلية؛ لا يُستنتج تخصيص مياه من التقويم."
    ],
    "sourceIds": [
      "fao-calendar",
      "fao-archive"
    ]
  },
  {
    "id": "potato-national-spring",
    "cropId": "potato",
    "cropName": "البطاطا",
    "aliases": [
      "بطاطا",
      "بطاطس"
    ],
    "category": "vegetable",
    "season": "spring",
    "method": "open",
    "operation": "plant",
    "months": [
      2,
      3
    ],
    "zones": [
      "all"
    ],
    "periodLabel": "شباط وآذار — نافذة وطنية مرجعية",
    "notes": [
      "تزرع بتقاوي الدرنات؛ يبين مخطط FAO هذه النافذة فقط، ولا يحصر كل عرا البطاطا في العراق.",
      "تحتاج المواعيد المحلية إلى التحقق من الصقيع وحرارة التربة وجودة التقاوي؛ لا تعمم على كل ارتفاع أو موقع."
    ],
    "sourceIds": [
      "fao-calendar"
    ]
  },
  {
    "id": "turnip-1",
    "cropId": "turnip",
    "cropName": "الشلغم (اللفت)",
    "aliases": [
      "لفت",
      "شغلم",
      "شلغم",
      "الشلغم",
      "سلجم"
    ],
    "category": "vegetable",
    "season": "winter",
    "method": "unspecified",
    "operation": "plant",
    "months": [
      8,
      9,
      10,
      11,
      12,
      1,
      2
    ],
    "zones": [],
    "periodLabel": "نهاية آب إلى شباط",
    "notes": [
      "مرجع عام؛ جدول المصدر لا يحدد المحافظة أو نوع الغطاء ولا يفصل البذر عن الشتل.",
      "تُراجع الحرارة والصقيع والحر الشديد محلياً قبل الزراعة؛ اسم الشهر يدل على تداخل مع النافذة المكتوبة فقط."
    ],
    "sourceIds": [
      "samarra-winter"
    ]
  },
  {
    "id": "beet-1",
    "cropId": "beet",
    "cropName": "الشوندر",
    "aliases": [
      "شوندر",
      "بنجر"
    ],
    "category": "vegetable",
    "season": "winter",
    "method": "unspecified",
    "operation": "plant",
    "months": [
      8,
      9,
      10,
      11,
      12,
      1,
      2
    ],
    "zones": [],
    "periodLabel": "آب إلى شباط",
    "notes": [
      "مرجع عام؛ جدول المصدر لا يحدد المحافظة أو نوع الغطاء ولا يفصل البذر عن الشتل.",
      "تُراجع الحرارة والصقيع والحر الشديد محلياً قبل الزراعة؛ اسم الشهر يدل على تداخل مع النافذة المكتوبة فقط."
    ],
    "sourceIds": [
      "samarra-winter"
    ]
  },
  {
    "id": "arugula-1",
    "cropId": "arugula",
    "cropName": "الجرجير",
    "aliases": [
      "جرجير"
    ],
    "category": "vegetable",
    "season": "winter",
    "method": "unspecified",
    "operation": "plant",
    "months": [
      8,
      9,
      10,
      11,
      12,
      1,
      2
    ],
    "zones": [],
    "periodLabel": "نهاية آب إلى بداية شباط",
    "notes": [
      "مرجع عام؛ جدول المصدر لا يحدد المحافظة أو نوع الغطاء ولا يفصل البذر عن الشتل.",
      "تُراجع الحرارة والصقيع والحر الشديد محلياً قبل الزراعة؛ اسم الشهر يدل على تداخل مع النافذة المكتوبة فقط."
    ],
    "sourceIds": [
      "samarra-winter"
    ]
  },
  {
    "id": "spinach-1",
    "cropId": "spinach",
    "cropName": "السبانخ",
    "aliases": [
      "سبانخ"
    ],
    "category": "vegetable",
    "season": "winter",
    "method": "unspecified",
    "operation": "plant",
    "months": [
      9,
      10,
      11,
      12,
      1,
      2
    ],
    "zones": [],
    "periodLabel": "بداية أيلول إلى شباط",
    "notes": [
      "مرجع عام؛ جدول المصدر لا يحدد المحافظة أو نوع الغطاء ولا يفصل البذر عن الشتل.",
      "تُراجع الحرارة والصقيع والحر الشديد محلياً قبل الزراعة؛ اسم الشهر يدل على تداخل مع النافذة المكتوبة فقط."
    ],
    "sourceIds": [
      "samarra-winter"
    ]
  },
  {
    "id": "radish-1",
    "cropId": "radish",
    "cropName": "الفجل",
    "aliases": [
      "فجل"
    ],
    "category": "vegetable",
    "season": "winter",
    "method": "unspecified",
    "operation": "plant",
    "months": [
      8,
      9,
      10,
      11,
      12,
      1,
      2
    ],
    "zones": [],
    "periodLabel": "آب إلى شباط",
    "notes": [
      "مرجع عام؛ جدول المصدر لا يحدد المحافظة أو نوع الغطاء ولا يفصل البذر عن الشتل.",
      "تُراجع الحرارة والصقيع والحر الشديد محلياً قبل الزراعة؛ اسم الشهر يدل على تداخل مع النافذة المكتوبة فقط."
    ],
    "sourceIds": [
      "samarra-winter"
    ]
  },
  {
    "id": "parsley-1",
    "cropId": "parsley",
    "cropName": "البقدونس",
    "aliases": [
      "بقدونس",
      "معدنوس"
    ],
    "category": "herb",
    "season": "winter",
    "method": "unspecified",
    "operation": "plant",
    "months": [
      8,
      9,
      10,
      11,
      12,
      1,
      2
    ],
    "zones": [],
    "periodLabel": "نهاية آب إلى شباط",
    "notes": [
      "مرجع عام؛ جدول المصدر لا يحدد المحافظة أو نوع الغطاء ولا يفصل البذر عن الشتل.",
      "تُراجع الحرارة والصقيع والحر الشديد محلياً قبل الزراعة؛ اسم الشهر يدل على تداخل مع النافذة المكتوبة فقط."
    ],
    "sourceIds": [
      "samarra-winter"
    ]
  },
  {
    "id": "chamomile-1",
    "cropId": "chamomile",
    "cropName": "البابونج",
    "aliases": [
      "بابونج"
    ],
    "category": "herb",
    "season": "winter",
    "method": "unspecified",
    "operation": "plant",
    "months": [
      11,
      12
    ],
    "zones": [],
    "periodLabel": "تشرين الثاني وكانون الأول",
    "notes": [
      "مرجع عام؛ جدول المصدر لا يحدد المحافظة أو نوع الغطاء ولا يفصل البذر عن الشتل.",
      "تُراجع الحرارة والصقيع والحر الشديد محلياً قبل الزراعة؛ اسم الشهر يدل على تداخل مع النافذة المكتوبة فقط."
    ],
    "sourceIds": [
      "samarra-winter"
    ]
  },
  {
    "id": "coriander-1",
    "cropId": "coriander",
    "cropName": "الكزبرة",
    "aliases": [
      "كزبرة",
      "كسبرة"
    ],
    "category": "herb",
    "season": "winter",
    "method": "unspecified",
    "operation": "plant",
    "months": [
      10,
      11,
      12
    ],
    "zones": [],
    "periodLabel": "تشرين الأول إلى كانون الأول",
    "notes": [
      "مرجع عام؛ جدول المصدر لا يحدد المحافظة أو نوع الغطاء ولا يفصل البذر عن الشتل.",
      "تُراجع الحرارة والصقيع والحر الشديد محلياً قبل الزراعة؛ اسم الشهر يدل على تداخل مع النافذة المكتوبة فقط."
    ],
    "sourceIds": [
      "samarra-winter"
    ]
  },
  {
    "id": "fenugreek-1",
    "cropId": "fenugreek",
    "cropName": "الحلبة",
    "aliases": [
      "حلبة"
    ],
    "category": "herb",
    "season": "winter",
    "method": "unspecified",
    "operation": "plant",
    "months": [
      11,
      12
    ],
    "zones": [],
    "periodLabel": "تشرين الثاني وكانون الأول",
    "notes": [
      "مرجع عام؛ جدول المصدر لا يحدد المحافظة أو نوع الغطاء ولا يفصل البذر عن الشتل.",
      "تُراجع الحرارة والصقيع والحر الشديد محلياً قبل الزراعة؛ اسم الشهر يدل على تداخل مع النافذة المكتوبة فقط."
    ],
    "sourceIds": [
      "samarra-winter"
    ]
  },
  {
    "id": "okra-1",
    "cropId": "okra",
    "cropName": "الباميا",
    "aliases": [
      "باميا",
      "بامية"
    ],
    "category": "vegetable",
    "season": "summer",
    "method": "open",
    "operation": "sow",
    "months": [
      3,
      4,
      5,
      6
    ],
    "zones": [],
    "periodLabel": "آذار إلى حزيران",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "okra-2",
    "cropId": "okra",
    "cropName": "الباميا",
    "aliases": [
      "باميا",
      "بامية"
    ],
    "category": "vegetable",
    "season": "summer",
    "method": "protected",
    "operation": "sow",
    "months": [
      2
    ],
    "zones": [],
    "periodLabel": "شباط للتبكير",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء.",
      "الزراعة المحمية والمشتل قد يحتاجان إلى ضبط الحرارة والتهوية؛ الغطاء وحده لا يضمن ملاءمة الجو."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "pepper-1",
    "cropId": "pepper",
    "cropName": "الفلفل",
    "aliases": [
      "فلفل",
      "فليفلة"
    ],
    "category": "vegetable",
    "season": "spring",
    "method": "open",
    "operation": "transplant",
    "months": [
      3
    ],
    "zones": [],
    "periodLabel": "آذار",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "pepper-2",
    "cropId": "pepper",
    "cropName": "الفلفل",
    "aliases": [
      "فلفل",
      "فليفلة"
    ],
    "category": "vegetable",
    "season": "spring",
    "method": "protected",
    "operation": "transplant",
    "months": [
      2
    ],
    "zones": [],
    "periodLabel": "شباط للتبكير تحت الغطاء",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء.",
      "الزراعة المحمية والمشتل قد يحتاجان إلى ضبط الحرارة والتهوية؛ الغطاء وحده لا يضمن ملاءمة الجو."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "pepper-3",
    "cropId": "pepper",
    "cropName": "الفلفل",
    "aliases": [
      "فلفل",
      "فليفلة"
    ],
    "category": "vegetable",
    "season": "autumn",
    "method": "protected",
    "operation": "transplant",
    "months": [
      8,
      9
    ],
    "zones": [],
    "periodLabel": "آب إلى أيلول — شتل في البيوت المحمية",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "النافذة مذكورة للبيوت المحمية؛ لا تعمم على الحقول المكشوفة أو كل نوع من الأغطية.",
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء.",
      "الزراعة المحمية والمشتل قد يحتاجان إلى ضبط الحرارة والتهوية؛ الغطاء وحده لا يضمن ملاءمة الجو."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "eggplant-1",
    "cropId": "eggplant",
    "cropName": "الباذنجان",
    "aliases": [
      "باذنجان"
    ],
    "category": "vegetable",
    "season": "spring",
    "method": "open",
    "operation": "transplant",
    "months": [
      3
    ],
    "zones": [],
    "periodLabel": "آذار",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "eggplant-2",
    "cropId": "eggplant",
    "cropName": "الباذنجان",
    "aliases": [
      "باذنجان"
    ],
    "category": "vegetable",
    "season": "spring",
    "method": "protected",
    "operation": "transplant",
    "months": [
      2
    ],
    "zones": [],
    "periodLabel": "شباط للتبكير تحت الغطاء",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء.",
      "الزراعة المحمية والمشتل قد يحتاجان إلى ضبط الحرارة والتهوية؛ الغطاء وحده لا يضمن ملاءمة الجو."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "eggplant-3",
    "cropId": "eggplant",
    "cropName": "الباذنجان",
    "aliases": [
      "باذنجان"
    ],
    "category": "vegetable",
    "season": "autumn",
    "method": "protected",
    "operation": "transplant",
    "months": [
      8,
      9
    ],
    "zones": [],
    "periodLabel": "آب إلى منتصف أيلول — شتل في البيوت المحمية",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "النافذة مذكورة للبيوت المحمية؛ لا تعمم على الحقول المكشوفة أو كل نوع من الأغطية.",
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء.",
      "الزراعة المحمية والمشتل قد يحتاجان إلى ضبط الحرارة والتهوية؛ الغطاء وحده لا يضمن ملاءمة الجو."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "tomato-1",
    "cropId": "tomato",
    "cropName": "الطماطم",
    "aliases": [
      "طماطم",
      "طماطة",
      "بندورة"
    ],
    "category": "vegetable",
    "season": "spring",
    "method": "nursery",
    "operation": "nursery_sow",
    "months": [
      1
    ],
    "zones": [
      "center",
      "north"
    ],
    "periodLabel": "كانون الثاني: بذر الشتلات في بيت مدفأ",
    "notes": [
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء.",
      "الزراعة المحمية والمشتل قد يحتاجان إلى ضبط الحرارة والتهوية؛ الغطاء وحده لا يضمن ملاءمة الجو.",
      "هذه مرحلة بذر شتلات في المشتل وليست موعد زراعة مكشوفة في الحقل.",
      "المصدر يشترط بيتاً محمياً مدفأً لإنتاج شتلات كانون الثاني."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "tomato-2",
    "cropId": "tomato",
    "cropName": "الطماطم",
    "aliases": [
      "طماطم",
      "طماطة",
      "بندورة"
    ],
    "category": "vegetable",
    "season": "spring",
    "method": "open",
    "operation": "transplant",
    "months": [
      3
    ],
    "zones": [
      "center",
      "north"
    ],
    "periodLabel": "منتصف آذار: نقل الشتلات إلى الحقل",
    "notes": [
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء.",
      "نقل شتلات أُنتجت سابقاً في كانون الثاني داخل بيت مدفأ؛ يظل زوال خطر الصقيع شرطاً محلياً."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "tomato-3",
    "cropId": "tomato",
    "cropName": "الطماطم",
    "aliases": [
      "طماطم",
      "طماطة",
      "بندورة"
    ],
    "category": "vegetable",
    "season": "autumn",
    "method": "nursery",
    "operation": "nursery_sow",
    "months": [
      10
    ],
    "zones": [
      "center",
      "north"
    ],
    "periodLabel": "تشرين الأول: بذر شتلات الأنفاق",
    "notes": [
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء.",
      "الزراعة المحمية والمشتل قد يحتاجان إلى ضبط الحرارة والتهوية؛ الغطاء وحده لا يضمن ملاءمة الجو.",
      "هذه مرحلة بذر شتلات في المشتل وليست موعد زراعة مكشوفة في الحقل."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "tomato-4",
    "cropId": "tomato",
    "cropName": "الطماطم",
    "aliases": [
      "طماطم",
      "طماطة",
      "بندورة"
    ],
    "category": "vegetable",
    "season": "winter",
    "method": "protected",
    "operation": "transplant",
    "months": [
      1
    ],
    "zones": [
      "center",
      "north"
    ],
    "periodLabel": "كانون الثاني: شتل تحت الأنفاق الواطئة",
    "notes": [
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء.",
      "الزراعة المحمية والمشتل قد يحتاجان إلى ضبط الحرارة والتهوية؛ الغطاء وحده لا يضمن ملاءمة الجو.",
      "المقصود في المصدر الأنفاق الواطئة؛ تُنتج شتلاتها من بذر تشرين الأول في مشتل محمي."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "zucchini-1",
    "cropId": "zucchini",
    "cropName": "الكوسة",
    "aliases": [
      "كوسة",
      "كوسا",
      "قرع الكوسة"
    ],
    "category": "vegetable",
    "season": "spring",
    "method": "open",
    "operation": "sow",
    "months": [
      3
    ],
    "zones": [
      "center"
    ],
    "periodLabel": "آذار",
    "notes": [
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "zucchini-2",
    "cropId": "zucchini",
    "cropName": "الكوسة",
    "aliases": [
      "كوسة",
      "كوسا",
      "قرع الكوسة"
    ],
    "category": "vegetable",
    "season": "spring",
    "method": "open",
    "operation": "sow",
    "months": [
      4
    ],
    "zones": [
      "north"
    ],
    "periodLabel": "نيسان",
    "notes": [
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "zucchini-3",
    "cropId": "zucchini",
    "cropName": "الكوسة",
    "aliases": [
      "كوسة",
      "كوسا",
      "قرع الكوسة"
    ],
    "category": "vegetable",
    "season": "autumn",
    "method": "open",
    "operation": "sow",
    "months": [
      9
    ],
    "zones": [],
    "periodLabel": "بداية أيلول",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "zucchini-4",
    "cropId": "zucchini",
    "cropName": "الكوسة",
    "aliases": [
      "كوسة",
      "كوسا",
      "قرع الكوسة"
    ],
    "category": "vegetable",
    "season": "winter",
    "method": "protected",
    "operation": "sow",
    "months": [
      10,
      11
    ],
    "zones": [],
    "periodLabel": "تشرين الأول إلى تشرين الثاني",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء.",
      "الزراعة المحمية والمشتل قد يحتاجان إلى ضبط الحرارة والتهوية؛ الغطاء وحده لا يضمن ملاءمة الجو."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "cucumber-1",
    "cropId": "cucumber",
    "cropName": "الخيار",
    "aliases": [
      "خيار"
    ],
    "category": "vegetable",
    "season": "spring",
    "method": "open",
    "operation": "sow",
    "months": [
      3
    ],
    "zones": [
      "center"
    ],
    "periodLabel": "بداية آذار",
    "notes": [
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "cucumber-2",
    "cropId": "cucumber",
    "cropName": "الخيار",
    "aliases": [
      "خيار"
    ],
    "category": "vegetable",
    "season": "spring",
    "method": "open",
    "operation": "sow",
    "months": [
      3
    ],
    "zones": [
      "north"
    ],
    "periodLabel": "منتصف آذار",
    "notes": [
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "cucumber-3",
    "cropId": "cucumber",
    "cropName": "الخيار",
    "aliases": [
      "خيار"
    ],
    "category": "vegetable",
    "season": "autumn",
    "method": "open",
    "operation": "sow",
    "months": [
      8
    ],
    "zones": [
      "center"
    ],
    "periodLabel": "بداية آب",
    "notes": [
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "cucumber-4",
    "cropId": "cucumber",
    "cropName": "الخيار",
    "aliases": [
      "خيار"
    ],
    "category": "vegetable",
    "season": "winter",
    "method": "protected",
    "operation": "sow",
    "months": [
      11
    ],
    "zones": [],
    "periodLabel": "تشرين الثاني: بذر في البيوت البلاستيكية",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء.",
      "الزراعة المحمية والمشتل قد يحتاجان إلى ضبط الحرارة والتهوية؛ الغطاء وحده لا يضمن ملاءمة الجو.",
      "النافذة المذكورة لبذر البيوت البلاستيكية، ولا تعني شتلاً مكشوفاً في تشرين الثاني."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "cucumber-5",
    "cropId": "cucumber",
    "cropName": "الخيار",
    "aliases": [
      "خيار"
    ],
    "category": "vegetable",
    "season": "winter",
    "method": "protected",
    "operation": "plant",
    "months": [
      9,
      10,
      11,
      12,
      1
    ],
    "zones": [],
    "periodLabel": "منتصف أيلول إلى كانون الثاني: بيوت زجاجية",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء.",
      "الزراعة المحمية والمشتل قد يحتاجان إلى ضبط الحرارة والتهوية؛ الغطاء وحده لا يضمن ملاءمة الجو.",
      "نافذة البيوت الزجاجية تحديداً؛ لا تعمم على الحقول أو الأنفاق غير المدفأة."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "cowpea-1",
    "cropId": "cowpea",
    "cropName": "اللوبيا للقرون الخضراء",
    "aliases": [
      "لوبيا",
      "لوبيا خضراء"
    ],
    "category": "vegetable",
    "season": "summer",
    "method": "open",
    "operation": "sow",
    "months": [
      5,
      6,
      7
    ],
    "zones": [],
    "periodLabel": "أيار وحزيران وتموز",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "يشترط ملاءمة الحرارة وتجنب الصقيع؛ تختلف النتيجة بحسب الصنف والموقع وتوافر الماء.",
      "مخصص هنا لإنتاج القرون الخضراء؛ لا تستخدم النافذة كموعد مثبت لإنتاج بذور جافة."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "potato-1",
    "cropId": "potato",
    "cropName": "البطاطا",
    "aliases": [
      "بطاطا",
      "بطاطس"
    ],
    "category": "vegetable",
    "season": "autumn",
    "method": "open",
    "operation": "plant",
    "months": [
      8
    ],
    "zones": [
      "north"
    ],
    "periodLabel": "الأسبوعان الثاني والثالث من آب",
    "notes": [
      "زراعة تقاوي درنات العروة الخريفية؛ تحفظ حدود الأسابيع المذكورة ولا تعمم على كامل الشهر."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "potato-2",
    "cropId": "potato",
    "cropName": "البطاطا",
    "aliases": [
      "بطاطا",
      "بطاطس"
    ],
    "category": "vegetable",
    "season": "autumn",
    "method": "open",
    "operation": "plant",
    "months": [
      8,
      9
    ],
    "zones": [
      "center"
    ],
    "periodLabel": "نهاية آب إلى الأسبوع الأول من أيلول",
    "notes": [
      "زراعة تقاوي درنات العروة الخريفية؛ تحفظ حدود الأسابيع المذكورة ولا تعمم على كامل الشهر."
    ],
    "sourceIds": [
      "baghdad-summer"
    ]
  },
  {
    "id": "broad-bean-1",
    "cropId": "broad-bean",
    "cropName": "الباقلاء",
    "aliases": [
      "باقلاء",
      "باقلا",
      "فول عريض"
    ],
    "category": "field",
    "season": "winter",
    "method": "open",
    "operation": "sow",
    "months": [
      10,
      11
    ],
    "zones": [],
    "periodLabel": "تشرين الأول إلى نهاية تشرين الثاني",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق."
    ],
    "sourceIds": [
      "mosul-cereals"
    ]
  },
  {
    "id": "lentil-1",
    "cropId": "lentil",
    "cropName": "العدس",
    "aliases": [
      "عدس"
    ],
    "category": "field",
    "season": "winter",
    "method": "open",
    "operation": "sow",
    "months": [
      12
    ],
    "zones": [
      "north"
    ],
    "periodLabel": "في حدود كانون الأول، مع توافر أمطار الموسم",
    "notes": [
      "يرد الموعد ضمن سياق انتشار العدس شمالاً وفي الزراعة الديمية؛ يتوقف البدء على أمطار الموسم ويشترط صرف جيد."
    ],
    "sourceIds": [
      "mosul-cereals"
    ]
  },
  {
    "id": "maize-1",
    "cropId": "maize",
    "cropName": "الذرة الصفراء",
    "aliases": [
      "ذرة صفراء",
      "ذرة"
    ],
    "category": "field",
    "season": "spring",
    "method": "open",
    "operation": "sow",
    "months": [
      3
    ],
    "zones": [
      "center",
      "south"
    ],
    "periodLabel": "النصف الأول من آذار",
    "notes": [
      "يُشترط تأكيد توافر المياه وتوافق الزراعة مع الخطة المحلية؛ المرجع ليس موافقة على تخصيص مياه.",
      "يسمي المصدر الوسط والجنوب لهذه العروة؛ لا يثبت منه موعد شمالي مكافئ بعد إزاحة شهرية."
    ],
    "sourceIds": [
      "mosul-cereals"
    ]
  },
  {
    "id": "maize-2",
    "cropId": "maize",
    "cropName": "الذرة الصفراء",
    "aliases": [
      "ذرة صفراء",
      "ذرة"
    ],
    "category": "field",
    "season": "autumn",
    "method": "open",
    "operation": "sow",
    "months": [
      7
    ],
    "zones": [],
    "periodLabel": "النصف الأول من تموز؛ لا يؤخر عن نهاية تموز",
    "notes": [
      "مرجع عام؛ هذه الفقرة لا تقدم موعداً مفصلاً لكل منطقة من العراق.",
      "يُشترط تأكيد توافر المياه وتوافق الزراعة مع الخطة المحلية؛ المرجع ليس موافقة على تخصيص مياه."
    ],
    "sourceIds": [
      "mosul-cereals"
    ]
  }
];
