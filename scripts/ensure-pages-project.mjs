import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PROJECT_NAME = 'ur-smart-urfarmiq';
const PRODUCTION_BRANCH = 'main';
const EXPECTED_HOST = 'ur-smart-urfarmiq.pages.dev';

function requestError(operation, status) {
  return new Error(`Cloudflare Pages ${operation} failed (HTTP ${status}). Ensure CLOUDFLARE_API_TOKEN has Account > Cloudflare Pages > Edit for CLOUDFLARE_ACCOUNT_ID.`);
}

async function requestProject(fetchImpl, url, token, method = 'GET') {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify({ name: PROJECT_NAME, production_branch: PRODUCTION_BRANCH }) } : {}),
    });
  } catch {
    // Fetch errors can contain request details. Never log their raw messages.
    throw new Error('Cloudflare Pages request failed before receiving an HTTP response. Check network access and retry.');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

export async function ensurePagesProject({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new Error('Set the CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID GitHub Actions secrets before deploying.');
  }
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character Cloudflare account identifier.');
  }

  const projectsUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;
  let response = await requestProject(fetchImpl, `${projectsUrl}/${PROJECT_NAME}`, token);
  let created = false;
  // Wrangler also identifies a missing project by Cloudflare error 8000007.
  const missing = response.status === 404 || (Array.isArray(response.body?.errors) && response.body.errors.some(error => error.code === 8000007));
  if (missing) {
    response = await requestProject(fetchImpl, projectsUrl, token, 'POST');
    created = true;
  }
  if (!response.ok || response.body?.success !== true) {
    throw requestError(created ? 'project creation' : 'project lookup', response.status);
  }

  const project = response.body.result;
  if (project?.name !== PROJECT_NAME || project.production_branch !== PRODUCTION_BRANCH) {
    throw new Error('Cloudflare Pages returned an unexpected project or production branch. Check the project settings before deploying.');
  }
  if (project.subdomain !== EXPECTED_HOST) {
    throw new Error('Cloudflare Pages did not assign the expected ur-smart-urfarmiq.pages.dev hostname. Stop before publishing the GitHub Pages redirect.');
  }

  const result = { project: PROJECT_NAME, pages_host: EXPECTED_HOST, app_url: `https://${EXPECTED_HOST}`, created };
  if (env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, `pages_host=${result.pages_host}\napp_url=${result.app_url}\n`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await ensurePagesProject()));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  }
}
