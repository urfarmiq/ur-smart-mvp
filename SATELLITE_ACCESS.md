# Satellite analysis access model

## Current public launch: free direct analysis

Direct Sentinel-2 field analysis is temporarily free during the public launch. The deployment workflow sets the server-only Cloudflare Worker variable `SATELLITE_FREE_LAUNCH=true`.

Free launch includes direct statistics and per-pixel Sentinel-2 imagery for authenticated owners of saved fields. The Worker still verifies the live Supabase session, field ownership, and saved boundary before contacting Copernicus. Browser-supplied flags, headers, hostnames, or account state cannot enable access. Copernicus coverage, cloud-free observations, provider quotas and service availability still apply.

The temporary flag bypasses only the per-field paid entitlement lookup for direct satellite analysis. It does not change paid research orders, comprehensive or periodic field reports, advertising orders, existing satellite access orders, or their stored payment history. No database migration or destructive data change is needed.

## Re-enable paid satellite access later

When UR is ready to monetize direct analysis:
1. Remove `--var SATELLITE_FREE_LAUNCH:true` from `.github/workflows/deploy-satellite-worker.yml`.
2. Remove `satellite-access-legacy.html` from the `EXCLUDED_FILES` set in `scripts/build-public-site.mjs`, then restore the paid request link to that page.
3. Deploy the Worker. Without the exact server-side value `true`, the existing owner-bound `satellite_access_status` RPC is required again.
4. Restore the paid access request link and pricing/quote language in the public pages.
5. Confirm the production status endpoint reports `paid_service=true` and that unpaid/expired/wrong-field access fails closed before any Copernicus request.

The existing `satellite_access_orders` table, owner/MFA-admin RLS, quote acceptance, payment verification and expiry logic remain available. Client-entered payment references never activate access. Super Qi may be considered later only after its official payment/verification workflow is confirmed; this release does not claim an automatic Super Qi integration.

## Limits and safety

The free launch does not mean unlimited satellite processing. Existing Copernicus quotas and data availability still govern requests. Authentication, live field ownership and boundary checks remain mandatory. Historical reports and user data are retained. The direct-analysis free launch is not a promise of daily new imagery or a field diagnosis.
