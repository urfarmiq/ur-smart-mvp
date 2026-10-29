import {MAX_BACKUP_BYTES, createLocalDataBackup, parseLocalDataBackup, restoreLocalDataBackup} from './local-data.mjs';

const byId = id => document.getElementById(id);
const status = message => { byId('status').textContent = message; };
let reviewedBackup = null;
let fileGeneration = 0;

function updateRestoreButton() {
  byId('restore').disabled = !reviewedBackup || reviewedBackup.entries.length === 0 ||
    (reviewedBackup.entries.some(entry => entry.key === 'ur-smart-fields') && !byId('legacy-consent').checked);
}

byId('export').addEventListener('click', () => {
  try {
    const backup = createLocalDataBackup(window.localStorage);
    if (!backup.entries.length) {
      status('لا توجد سجلات محلية قابلة للنقل على عنوان هذه الصفحة. جرّب الموقع القديم من المتصفح والجهاز الأصليين. حقول السحابة تبقى في حسابك.');
      return;
    }
    const blob = new Blob([JSON.stringify(backup)], {type: 'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ur-smart-local-backup-' + backup.created_at.slice(0, 10) + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('تم إعداد تنزيل نسخة تضم ' + backup.entries.length + ' سجلًا محليًا. احتفظ بالملف وافتحه في صفحة الاستعادة على الموقع الجديد. لم تتغير البيانات القديمة.');
  } catch {
    status('تعذر إنشاء النسخة. تحقق من إتاحة التخزين المحلي وصحة السجلات وحد النسخة (4 ميبيبايت و500 سجل). لم تتغير أي بيانات.');
  }
});

byId('backup-file').addEventListener('change', async () => {
  const generation = ++fileGeneration;
  reviewedBackup = null;
  byId('review').hidden = true;
  byId('legacy-consent').checked = false;
  updateRestoreButton();
  const file = byId('backup-file').files[0];
  if (!file) { status('لم يُختر ملف. لم تتغير أي بيانات.'); return; }
  status('جارٍ مراجعة الملف داخل المتصفح. لم تُحفظ أي سجلات.');
  try {
    if (file.size > MAX_BACKUP_BYTES) throw Error('حجم الملف أكبر من الحد الأقصى: 4 ميبيبايت.');
    const backup = parseLocalDataBackup(await file.text());
    if (generation !== fileGeneration) return;
    reviewedBackup = backup;
    byId('review-summary').textContent = 'النسخة صالحة وتضم ' + backup.entries.length + ' سجلًا محليًا. لم يُحفظ شيء بعد.';
    byId('legacy-notice').hidden = !backup.entries.some(entry => entry.key === 'ur-smart-fields');
    byId('review').hidden = false;
    updateRestoreButton();
    status(backup.entries.length ? 'راجع الملخص ثم اضغط زر الاستعادة للمتابعة.' : 'النسخة صالحة لكنها لا تحتوي سجلات لاستعادتها.');
  } catch (error) {
    if (generation !== fileGeneration) return;
    status('لم يُقبل الملف: ' + error.message + ' لم تُحفظ أي سجلات.');
  }
});

byId('legacy-consent').addEventListener('change', updateRestoreButton);
byId('restore').addEventListener('click', () => {
  if (!reviewedBackup || byId('restore').disabled) return;
  byId('restore').disabled = true;
  try {
    const result = restoreLocalDataBackup(window.localStorage, reviewedBackup);
    let message = 'استُعيد ' + result.restored + ' سجلًا. تُرك ' + result.skipped + ' سجلًا موجودًا دون استبدال.';
    if (result.stopped) message += ' تعذر إكمال الحفظ؛ لم يُستعد ' + result.failed + ' سجلًا. تحقق من مساحة التخزين أو صلاحيات المتصفح، ثم أعد اختيار الملف للمحاولة.';
    else message += ' يمكنك الآن فتح لوحة المزارع وتسجيل الدخول بحسابك الحالي نفسه.';
    status(message);
    reviewedBackup = null;
    byId('backup-file').value = '';
    byId('review').hidden = true;
    byId('legacy-consent').checked = false;
  } catch {
    status('تعذرت الاستعادة. لم يُقبل الملف أو لم يتوفر التخزين المحلي. احتفظ بالنسخة وأعد اختيارها للمراجعة.');
    reviewedBackup = null;
    byId('review').hidden = true;
  }
});
