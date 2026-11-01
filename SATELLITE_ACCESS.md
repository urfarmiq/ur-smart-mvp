# Paid satellite access

New satellite statistics and real per-pixel imagery require a paid activation for the owned field. Drawing boundaries, calculating Iraqi donum area and reading previously saved owner history remain available. No historic data is removed.

## Offer and activation

The customer opens `satellite-access.html`, chooses an owned field and proposes a duration. An MFA allowlisted administrator quotes the actual IQD price, scope and duration (1–365 days). No price is advertised or charged automatically. The customer accepts the exact quote version, including its duration, before arranging payment. The administrator verifies the actual receipt and approves the order. Client-entered payment references never activate access.

Activation begins at the actual server approval time and ends after the accepted number of 24-hour days. It is field-specific and does not renew automatically. A new order is required for another field or a later period. Overlapping approved periods do not stack automatically: each ends at its own approval time plus its accepted duration. Review existing dates before approving another order.

The duration is an access window, not a promise of a new satellite acquisition, cloud-free pixels or continuous monitoring. Copernicus coverage and existing free service quotas still govern availability. No billing, paid data source or new API key is enabled.

## Server enforcement

`satellite_access_orders` uses owner/MFA-admin RLS, named SELECT grants and checked private functions behind public SECURITY INVOKER wrappers. Clients cannot approve payment, modify amounts or change accepted durations. Field deletion preserves the order with a null field reference and prevents new access. Live field ownership is checked again for each access decision.

Every external satellite POST path, including statistics and imagery, checks the live authenticated user, field ownership and the database entitlement before contacting Copernicus. Expired, unpaid or unavailable entitlements fail closed. The browser does not control activation or expiry. A client-supplied header, hostname or body flag cannot mark a request as included in another paid service.

Existing paid research and comprehensive/periodic reports retain their agreed satellite inclusion. Only their already claimed server execution uses the private included-service callback. A saved paid research report can retrieve its NDVI image through `/research/imagery` with its order ID; the server verifies the paid owner-bound report and derives the field and acquisition date from the saved result. It does not grant general access to other fields, dates or indices.

The staging source re-exports the same production handler to avoid a future authorization drift. The old deployed staging service was unconfigured (HTTP 503) at the pre-change check; the normal release pipeline deploys production only.

## Verification

- Unit tests cover unpaid, expired, wrong-field and failed entitlement checks before provider requests, generic route and spoofed bypass attempts, internal paid report execution and owner-bound research imagery.
- `tests/satellite-access-rls.sql` uses synthetic data inside one transaction ending in ROLLBACK to verify owner isolation, MFA administration, immutable accepted quotes, duration/expiry, payment gates and deleted-field history.
- Customer/admin browser fixtures use the pinned Supabase SDK where applicable, with all network intercepted. They cover desktop/mobile order creation, quoted terms, payment, expiry, late replies and account cleanup.
- Existing satellite, field management, research images, paid field reports and administration regressions remain part of verification. Production checks confirm the published revision/files, CORS and the public paid-service status.

Fixture tests do not claim that a real customer paid or that an agricultural interpretation was independently validated. The administrator still verifies real transfers.
