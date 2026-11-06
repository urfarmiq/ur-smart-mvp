import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateMonetizationConfig, getAdsenseSeller } from '../monetization-core.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC_EXTENSIONS = new Set(['.html', '.css', '.mjs', '.js']);
const EXCLUDED_FILES = new Set(['satellite-staging-test.html']);
const PWA_ICONS = ['app-icon.svg', 'icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png'];
const PWA_FILES = ['manifest.webmanifest', 'sw.js', 'pwa-client.mjs', 'pwa.css', 'install.html', 'offline.html'];

const HEADERS = `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin

/auth
  Cache-Control: no-store, max-age=0
/auth.html
  Cache-Control: no-store, max-age=0
/admin
  Cache-Control: no-store, max-age=0
/admin.html
  Cache-Control: no-store, max-age=0
/release.txt
  Cache-Control: no-store, max-age=0
/sw.js
  Cache-Control: no-cache, max-age=0, must-revalidate
  Service-Worker-Allowed: /
  Content-Type: application/javascript; charset=utf-8
/manifest.webmanifest
  Cache-Control: no-cache, max-age=0, must-revalidate
  Content-Type: application/manifest+json; charset=utf-8
/pwa-client.mjs
  Cache-Control: no-cache, max-age=0, must-revalidate
/install
  Cache-Control: no-cache, max-age=0, must-revalidate
/install.html
  Cache-Control: no-cache, max-age=0, must-revalidate
/offline
  Cache-Control: no-cache, max-age=0, must-revalidate
/offline.html
  Cache-Control: no-cache, max-age=0, must-revalidate
/monetization-config.json
  Cache-Control: no-store, max-age=0
  Content-Type: application/json; charset=utf-8
/ads.txt
  Cache-Control: no-cache, max-age=0, must-revalidate
  Content-Type: text/plain; charset=utf-8
`;

export async function buildPublicSite({ sourceDir = PROJECT_ROOT, outDir = path.join(PROJECT_ROOT, 'dist-pages'), release = process.env.GITHUB_SHA || 'local' } = {}) {
  if (path.resolve(sourceDir) === path.resolve(outDir)) throw new Error('The public output must differ from the source directory.');
  if (release !== 'local' && !/^[a-f0-9]{40,64}$/i.test(release)) throw new Error('GITHUB_SHA must be a commit hash.');
  const rootEntries = await readdir(sourceDir, { withFileTypes: true });
  // Only browser source files directly in the project root are eligible.
  // Never recursively copy the repository, backend, tests, docs, or dotfiles.
  const publicFiles = rootEntries.filter(entry => entry.isFile() && !entry.name.startsWith('.') && (PUBLIC_EXTENSIONS.has(path.extname(entry.name)) || ['manifest.webmanifest','monetization-config.json'].includes(entry.name)) && !EXCLUDED_FILES.has(entry.name)).map(entry => entry.name).sort();
  if (!publicFiles.includes('index.html')) throw new Error('The public site requires index.html.');
  let monetization = null;
  if (publicFiles.includes('monetization-config.json')) {
    const configSource = await readFile(path.join(sourceDir,'monetization-config.json'),'utf8');
    if (Buffer.byteLength(configSource)>4096) throw new Error('Public advertising settings exceed the allowed size.');
    monetization = validateMonetizationConfig(JSON.parse(configSource));
  }
  const seller = monetization ? getAdsenseSeller(monetization) : null;
  const hasPwa = publicFiles.includes('sw.js') || publicFiles.includes('manifest.webmanifest');
  if (hasPwa && PWA_FILES.some(file => !publicFiles.includes(file))) throw new Error('The PWA requires its manifest, worker, client, styles and offline/install pages.');
  let iconFiles = [];
  if (hasPwa) {
    const entries = await readdir(path.join(sourceDir, 'icons'), { withFileTypes: true });
    iconFiles = PWA_ICONS.filter(name => entries.some(entry => entry.isFile() && entry.name === name));
    if (iconFiles.length !== PWA_ICONS.length) throw new Error('The PWA requires all explicit application icons.');
  }
  const vendorDir = path.join(sourceDir, 'vendor');
  const vendorFiles = (await readdir(vendorDir, { withFileTypes: true })).filter(entry => entry.isFile() && /(?:\.js|\.LICENSE)$/.test(entry.name)).map(entry => entry.name).sort();
  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, 'vendor'), { recursive: true });
  for (const file of publicFiles) {
    if (file === 'sw.js') {
      const source = await readFile(path.join(sourceDir, file), 'utf8');
      if (!source.includes('__UR_PWA_RELEASE__')) throw new Error('The service worker requires a build release marker.');
      await writeFile(path.join(outDir, file), source.replaceAll('__UR_PWA_RELEASE__', release));
    } else if (file === 'index.html' && seller) {
      const source = await readFile(path.join(sourceDir,file),'utf8');
      if (!source.includes('</head>')) throw new Error('The public home page needs a head for AdSense verification.');
      if (/name\s*=\s*["']google-adsense-account["']/i.test(source)) throw new Error('Manage the AdSense verification identifier only in the public advertising configuration.');
      await writeFile(path.join(outDir,file),source.replace('</head>','<meta name="google-adsense-account" content="'+monetization.google.publisher_id+'">\n</head>'));
    } else await copyFile(path.join(sourceDir, file), path.join(outDir, file));
  }
  if (iconFiles.length) await mkdir(path.join(outDir, 'icons'), { recursive: true });
  for (const file of iconFiles) await copyFile(path.join(sourceDir, 'icons', file), path.join(outDir, 'icons', file));
  for (const file of vendorFiles) await copyFile(path.join(vendorDir, file), path.join(outDir, 'vendor', file));
  await writeFile(path.join(outDir, '_headers'), HEADERS);
  await writeFile(path.join(outDir, 'release.txt'), `${release}\n`);
  await writeFile(path.join(outDir,'ads.txt'),seller ? `google.com, ${seller}, DIRECT, f08c47fec0942fa0\n` : '# No Google advertising seller configured.\n# Direct sponsorship enquiries: https://ur-smart-urfarmiq.pages.dev/advertise.html\n');
  return { directory: path.basename(outDir), files: publicFiles.length + vendorFiles.length + iconFiles.length + 3, release };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await buildPublicSite()));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
