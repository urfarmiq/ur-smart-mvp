# Account connection recovery

The existing Supabase project, publishable key, default browser storage key and pinned SDK version remain unchanged. This patch does not change authentication policies, database schemas, accounts or saved field data. Session information is not copied between hostnames or browsers.

## Changes

- Weather now loads the same local `supabase-client.mjs` as login and dashboard. It resumes the browser session with a bounded `getSession()` read instead of requiring an additional unbounded `getUser()` network request. Database RLS continues to authorize all reads; local session claims do not grant access.
- Account import, session, field and boundary waits are bounded. A network failure offers retry and is distinct from a confirmed missing session. The UI does not call sign-out or clear storage on timeout.
- Weather subscribes to account events before loading fields. Callbacks stay synchronous; subsequent SDK work runs outside its auth lock. Account generations reject late old-account results, and sign-out immediately removes private field selection and weather.
- Login and dashboard no longer depend on a remote font stylesheet. A stalled external stylesheet can delay subsequent scripts, so critical account pages use the existing local font fallbacks.
- Dashboard recovery controls are present in the HTML, including a native reload form and sign-in link. The boot controller exposes help during a long wait and bounds total startup as well as individual requests. Successful initialization hides the help. Existing stale-result protections remain.

## Verification

`tests/browser_weather_session.py` runs the actual pinned SDK and production login, dashboard and weather files, intercepting all HTTP with synthetic responses. Desktop and mobile scenarios cover password login, existing sessions, expired-token refresh, the owner-filtered fields and boundaries, network failures, timeout/retry, missing sessions and public reference-city forecasts. It checks that no remote SDK/font request is needed and that credentials are not rendered or logged. Stored sessions survive simulated network timeouts.

The existing weather, login recovery, local SDK, authentication and field management browser suites remain relevant. These are controlled browser tests, not access to a real user's private session or an actual iPhone. Public deployment verification checks exact published file bytes and the release marker.

A session stored on `urfarmiq.github.io` or another browser cannot be shared automatically with `ur-smart-urfarmiq.pages.dev`. Sign in on the primary hostname using the existing account when no session exists there; do not create a replacement account or transfer tokens.
