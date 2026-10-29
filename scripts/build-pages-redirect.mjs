import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));

export function getRedirectUrl({ pathname = '/', search = '', hash = '' } = {}) {
  const oldBase = '/ur-smart-mvp';
  let nextPath = pathname;
  if (nextPath === oldBase) nextPath = '/';
  else if (nextPath.startsWith(`${oldBase}/`)) nextPath = nextPath.slice(oldBase.length);
  // Assign pathname on a fixed origin so even //example.com stays a local path.
  const target = new URL('https://ur-smart-urfarmiq.pages.dev');
  target.pathname = nextPath;
  target.search = search;
  target.hash = hash;
  return target.href;
}

export async function buildPagesRedirect({ outDir = path.join(PROJECT_ROOT, 'dist-redirect') } = {}) {
  if (path.resolve(outDir) === path.resolve(PROJECT_ROOT)) throw new Error('The redirect output must differ from the source directory.');
  // Keep the migration helper local to the old origin. Only its allowlisted
  // application keys are considered; authentication storage is never exported.
  const migrationSource = (await readFile(new URL('../local-data.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');
  const redirectScript = `(() => {
${migrationSource}
    const getRedirectUrl = ${getRedirectUrl.toString()};
    const continueLink = document.getElementById('continueToSite');
    continueLink.href = getRedirectUrl(window.location);
    const notice = document.getElementById('migrationNotice');
    const message = document.getElementById('migrationMessage');
    const downloadButton = document.getElementById('downloadBackup');
    const backupStatus = document.getElementById('backupStatus');
    let storage;
    try {
      storage = window.localStorage;
      let hasLocalData = false;
      for (let index = 0; index < storage.length; index += 1) {
        if (isAllowedLocalDataKey(storage.key(index))) {
          hasLocalData = true;
          break;
        }
      }
      if (!hasLocalData) {
        window.location.replace(continueLink.href);
        return;
      }
      notice.hidden = false;
      downloadButton.hidden = false;
    } catch {
      notice.hidden = false;
      message.textContent = 'تعذر الوصول إلى السجلات المحلية في هذا المتصفح، لذلك لا يمكن التأكد من وجود بيانات لنسخها. يمكنك متابعة الانتقال، ولن تُحذف بيانات الموقع القديم.';
      return;
    }
    downloadButton.addEventListener('click', () => {
      let objectUrl;
      downloadButton.disabled = true;
      try {
        // Read app values and create a file only after this explicit click.
        const backup = createLocalDataBackup(storage);
        if (backup.entries.length === 0) {
          backupStatus.textContent = 'لا توجد سجلات أور محلية متاحة للنسخ الآن. يمكنك متابعة الانتقال.';
          return;
        }
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
        objectUrl = URL.createObjectURL(blob);
        const download = document.createElement('a');
        download.href = objectUrl;
        download.download = 'ur-smart-local-backup-' + backup.created_at.slice(0, 10) + '.json';
        document.body.append(download);
        download.click();
        download.remove();
        backupStatus.textContent = 'تم تجهيز تنزيل النسخة. تأكد من حفظ الملف، ثم تابع إلى الموقع الجديد. لا تشارك الملف إذا كان يحتوي على معلومات خاصة.';
      } catch {
        backupStatus.textContent = 'تعذر تجهيز النسخة المحلية. لم تُحذف أي بيانات. يمكنك إعادة المحاولة أو متابعة الانتقال والعودة لهذا الرابط لاحقًا.';
      } finally {
        downloadButton.disabled = false;
        if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    });
  })();`;
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>انتقل موقع أور الزراعية</title>
  <style>body{margin:0;padding:32px 20px;background:#f5f8f5;color:#173c29;font:18px/1.8 system-ui,sans-serif}main{max-width:640px;margin:8vh auto;padding:28px;background:white;border:1px solid #dce7dd;border-radius:16px}h1{font-size:1.5rem;line-height:1.5}a{color:#176b45}button{padding:10px 18px;background:#176b45;color:white;border:0;border-radius:8px;font:inherit;cursor:pointer}button:disabled{opacity:.65}#migrationNotice{padding:18px;background:#f0f6ee;border-radius:10px}#backupStatus{font-size:.95rem}a:focus-visible,button:focus-visible{outline:3px solid #b77816;outline-offset:4px}</style>
</head>
<body>
  <main>
    <h1>انتقل موقع أور الزراعية إلى عنوانه الجديد</h1>
    <section id="migrationNotice" hidden aria-labelledby="migrationMessage">
      <p id="migrationMessage">بعض سجلاتك محفوظة على هذا الجهاز. نزّل نسخة قبل الانتقال.</p>
      <p>تبقى البيانات القديمة في هذا المتصفح. لا تُنقل جلسة تسجيل الدخول مع النسخة.</p>
      <button id="downloadBackup" type="button" hidden>تنزيل نسخة من سجلاتي المحلية</button>
      <p id="backupStatus" role="status" aria-live="polite"></p>
    </section>
    <p><a id="continueToSite" href="https://ur-smart-urfarmiq.pages.dev/">متابعة إلى موقع أور الزراعية</a></p>
    <p><a href="https://ur-smart-urfarmiq.pages.dev/local-data.html">تعليمات استعادة النسخة في الموقع الجديد</a></p>
    <noscript><p>لتجهيز نسخة من السجلات المحلية، فعّل JavaScript ثم أعد فتح الصفحة. لن يحذف الانتقال بيانات الموقع القديم.</p></noscript>
  </main>
  <script>${redirectScript.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'index.html'), html);
  await writeFile(path.join(outDir, '404.html'), html);
  await writeFile(path.join(outDir, '.nojekyll'), '');
  return { directory: path.basename(outDir), files: 3, app_url: 'https://ur-smart-urfarmiq.pages.dev/' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await buildPagesRedirect()));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
