import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC_EXTENSIONS = new Set(['.html', '.css', '.mjs', '.js']);
const EXCLUDED_FILES = new Set(['satellite-staging-test.html']);

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
`;

export async function buildPublicSite({ sourceDir = PROJECT_ROOT, outDir = path.join(PROJECT_ROOT, 'dist-pages'), release = process.env.GITHUB_SHA || 'local' } = {}) {
  if (path.resolve(sourceDir) === path.resolve(outDir)) throw new Error('The public output must differ from the source directory.');
  if (release !== 'local' && !/^[a-f0-9]{40,64}$/i.test(release)) throw new Error('GITHUB_SHA must be a commit hash.');
  const rootEntries = await readdir(sourceDir, { withFileTypes: true });
  // Only browser source files directly in the project root are eligible.
  // Never recursively copy the repository, backend, tests, docs, or dotfiles.
  const publicFiles = rootEntries.filter(entry => entry.isFile() && !entry.name.startsWith('.') && PUBLIC_EXTENSIONS.has(path.extname(entry.name)) && !EXCLUDED_FILES.has(entry.name)).map(entry => entry.name).sort();
  if (!publicFiles.includes('index.html')) throw new Error('The public site requires index.html.');
  const vendorDir = path.join(sourceDir, 'vendor');
  const vendorFiles = (await readdir(vendorDir, { withFileTypes: true })).filter(entry => entry.isFile() && /(?:\.js|\.LICENSE)$/.test(entry.name)).map(entry => entry.name).sort();
  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, 'vendor'), { recursive: true });
  for (const file of publicFiles) await copyFile(path.join(sourceDir, file), path.join(outDir, file));
  for (const file of vendorFiles) await copyFile(path.join(vendorDir, file), path.join(outDir, 'vendor', file));
  await writeFile(path.join(outDir, '_headers'), HEADERS);
  await writeFile(path.join(outDir, 'release.txt'), `${release}\n`);
  return { directory: path.basename(outDir), files: publicFiles.length + vendorFiles.length + 2, release };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await buildPublicSite()));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
