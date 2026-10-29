// Paid service is offered on the commercial-capable platform hostname.
if(location.origin==='https://urfarmiq.github.io'){
 const target=new URL('https://ur-smart-urfarmiq.pages.dev/research.html');
 target.search=location.search;target.hash=location.hash;location.replace(target.href);
}
// Request details stay in page memory. Only explicit copy/download actions export them.
const form = document.getElementById('researchForm');
const fields = document.getElementById('requestFields');
const prepareButton = document.getElementById('prepareRequest');
const status = document.getElementById('requestStatus');
const review = document.getElementById('requestReview');
const reviewTitle = document.getElementById('reviewTitle');
const output = document.getElementById('preparedRequest');
const copyStatus = document.getElementById('copyStatus');
const topic = document.getElementById('researchTopic');
const topicCount = document.getElementById('topicCount');
const numberFormat = new Intl.NumberFormat('ar-IQ');
const controls = {
  name: document.getElementById('researchName'),
  university: document.getElementById('researchUniversity'),
  degree: document.getElementById('researchDegree'),
  specialization: document.getElementById('researchSpecialization'),
  type: document.getElementById('researchType'),
  topic,
  contact: document.getElementById('researchContact'),
};
let preparedText = '';
let revision = 0;

function updateCount() {
  topicCount.textContent = `${numberFormat.format(topic.value.length)} / ${numberFormat.format(2000)}`;
}

function invalidateReview() {
  revision += 1;
  if (preparedText) {
    status.textContent = 'تم تعديل المعلومات. جهّز النص مجدداً لمراجعة النسخة المحدّثة.';
  }
  preparedText = '';
  output.value = '';
  copyStatus.textContent = '';
  review.hidden = true;
  status.classList.remove('error');
}

function prepareRequest() {
  for (const control of Object.values(controls)) {
    control.setCustomValidity('');
    if (control.required && !control.value.trim()) {
      control.setCustomValidity('يرجى إكمال هذا الحقل.');
    } else if (control.maxLength > 0 && control.value.length > control.maxLength) {
      control.setCustomValidity(`الحد الأقصى ${numberFormat.format(control.maxLength)} حرف.`);
    }
  }
  if (!form.reportValidity()) {
    status.textContent = 'أكمل الحقول المطلوبة ضمن الحدود الموضحة لتجهيز نص الطلب.';
    status.classList.add('error');
    return;
  }

  const values = Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, control.value.trim()]));
  preparedText = [
    'طلب دعم بحثي زراعي – أور الزراعية',
    '',
    `الاسم: ${values.name}`,
    `الجامعة: ${values.university}`,
    `المرحلة الدراسية: ${values.degree}`,
    `التخصص الزراعي: ${values.specialization}`,
    `مجال الدعم: ${values.type}`,
    '',
    'موضوع البحث والمساعدة المطلوبة:',
    values.topic,
    '',
    ...(values.contact ? [`وسيلة تواصل إضافية: ${values.contact}`, ''] : []),
    'السعر الإجمالي: ٢٥٬٠٠٠ دينار عراقي فقط للطلب الواحد المتفق على تفاصيله.',
    'أرغب بمراجعة نطاق طلبي وتأكيد ما يمكن تقديمه وموعد التسليم مع إدارة أور قبل الاتفاق والدفع.',
    'يُنسّق الدفع يدوياً بعد الاتفاق. هذا النص طلب للمراجعة وليس تأكيد حجز أو دفع.',
  ].join('\n');
  output.value = preparedText;
  copyStatus.textContent = '';
  status.classList.remove('error');
  status.textContent = 'النص جاهز للمراجعة. لم يُرسل طلبك؛ انسخه وأرسله بنفسك إلى حساب أور الرسمي على إنستغرام.';
  review.hidden = false;
  reviewTitle.focus({preventScroll: true});
  review.scrollIntoView({block: 'start', behavior: 'auto'});
}

form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
    event.target.setCustomValidity('');
  }
  invalidateReview();
  updateCount();
});
form.addEventListener('change', invalidateReview);
prepareButton.addEventListener('click', prepareRequest);

document.getElementById('copyRequest').addEventListener('click', async () => {
  if (!preparedText || review.hidden) return;
  const copiedText = preparedText;
  const copiedRevision = revision;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(copiedText);
    if (revision === copiedRevision && preparedText === copiedText) {
      copyStatus.textContent = 'نُسخ النص. افتح حساب أور على إنستغرام وألصقه في رسالة وأرسلها بنفسك.';
    }
  } catch {
    if (revision !== copiedRevision || preparedText !== copiedText) return;
    output.focus();
    output.select();
    copyStatus.textContent = 'تعذّر النسخ التلقائي. النص محدد؛ انسخه من خيارات المتصفح أو نزّل الملف النصي.';
  }
});

document.getElementById('downloadRequest').addEventListener('click', () => {
  if (!preparedText || review.hidden) return;
  const blob = new Blob(['\ufeff', preparedText], {type: 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const download = document.createElement('a');
  download.href = url;
  download.download = 'ur-research-request.txt';
  document.body.append(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  copyStatus.textContent = 'جُهّز ملف نصي للتنزيل. لا يرسل التنزيل الطلب؛ أرسل محتواه بنفسك عبر إنستغرام.';
});

// No named controls: native form fallback cannot serialize personal details into a URL.
fields.disabled = false;
updateCount();
