# Installable UR Smart application

UR Smart is an Arabic installable progressive web application on the existing production origin, `https://ur-smart-urfarmiq.pages.dev/`. Its manifest uses a stable root identity/scope, standalone display, first-party PNG icons including a maskable icon and an Apple touch icon, and shortcuts to fields, services, products and weather. The existing account, Supabase database, orders and paid-service checks are unchanged.

## Installation

Open `install.html` or choose **تثبيت التطبيق** on the home page, dashboard or services page. Chrome/Edge can show their native installation prompt after the user's click when the browser makes that prompt available. A missing prompt falls back to real instructions. On iPhone/iPad, open the site in Safari and use Share → Add to Home Screen → Add. Installed mode is reported only from the browser's standalone state or its installation event, not merely from accepting a prompt.

The operating system may require signing in with the existing UR account on first launch. Installing does not create a new account, change a price or enable billing. This release is distributed from the website; no store account or new paid API is involved.

## Connectivity and privacy

The service worker caches an explicit small list of public static files: home/services/install/offline pages, the PWA bootstrap/style, public service styles, manifest and icons. Public cached pages can open when connectivity fails. Accounts, private pages, products' inquiry UI, fields, orders, payments, reports, plant photographs, satellite rasters and API responses are never stored by this worker.

Requests to Supabase and the agricultural backend, non-GET requests, query/callback URLs and authorization-bearing requests bypass caching. Private document navigation uses the live network; a network failure shows a generic public offline message. Server HTTP errors, including 401 and 403, remain actual errors and are not replaced with cached content. Existing browser session storage and locally saved farm operations are neither copied nor cleared by the PWA.

Login, maps, satellite/AI analysis, report execution, current weather and sending orders require the internet. Offline support does not create a payment, reserve stock, run a paid service or replace current data with fabricated values.

## Updates and deployment

`scripts/build-public-site.mjs` publishes only explicit application icons, adds the manifest to the existing static allowlist and compiles `__UR_PWA_RELEASE__` in `sw.js` to the deployment commit. Worker and manifest headers require revalidation. The worker verifies MIME types, canonical paths and public HTML markers so a Cloudflare SPA fallback cannot be mistaken for a missing app asset.

An updated worker waits while the old app is open. The installation guide offers an explicit update action with a save-your-work message. No arriving update or first activation automatically reloads a form. Activating an update in another tab clears stale update controls without reloading that tab. Activation removes only old `ur-smart-pwa-` caches; it does not modify unrelated caches, Supabase sessions or local operations.

## Verification

- `tests/pwa-worker.test.mjs`: public allowlist, private/API/query isolation, offline fallback, strict response validation and opt-in worker activation.
- `tests/pwa-client.test.mjs`: installation gestures, Safari fallback, standalone state, optional updates, double clicks and cross-tab lifecycle behavior.
- `tests/browser_pwa.py`: real Chromium manifest/service-worker/cache/offline/update behavior on a local server using production build output, without real account/provider calls.
- Existing platform regressions and `tests/check_pages.py` check integration. Deployment verification requires a valid Arabic standalone manifest, decodable-size PNG headers, release-bound worker, update headers and the existing paid backend gates.

Headless browser checks cannot press the operating system's installation dialog on the owner's physical phone. The installation guide provides those final device steps.
