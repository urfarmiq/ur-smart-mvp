# Pinned Supabase browser SDK

`supabase-js-2.57.4.js` is the unmodified UMD browser bundle of `@supabase/supabase-js@2.57.4`, served from this site for the login and farmer dashboard. It removes their runtime dependency on the CDN ESM dependency graph. The SDK version, default session storage key, refresh behavior, RLS and account data are preserved.

Source: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.js

SHA-256: `7e94b62086deecef8c0ba3b38f514e2a1944ff6c81d92fb3ff967828c406c38f`

License: `supabase-js-2.57.4.LICENSE` (MIT, copied from the same package release).

Other pages keep their existing pinned SDK imports. Browser tests intercept network traffic and exercise both fixtures and this real local bundle. No service key is included.
