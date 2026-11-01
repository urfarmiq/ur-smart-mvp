# Paid field services

The three paid offerings are researcher support, comprehensive field reports and periodic field reports. The existing researcher workflow and its stored payment amounts remain unchanged. Public cards say **مدفوعة**; new field services have no fixed advertised price.

## Customer and administrator flow

1. The signed-in customer opens `field-services.html`, selects an owned field and creates a report or monitoring request.
2. An allowlisted administrator with Supabase MFA at `aal2` quotes the actual amount in IQD and the agreed scope from the existing administration page.
3. The customer reviews the amount, scope, report count, interval and partial-report policy, then accepts the exact quote version. Editing an accepted quote is prohibited.
4. The administrator verifies receipt outside the platform, checks the actual amount and confirms payment. A reference entered by a customer does not approve payment.
5. The owner explicitly requests each report when it is due. A monitoring plan has 2–12 reports, separated by 7, 14 or 30 days. Its first report is due after approval; the next interval starts when the preceding report completes. Missed dates do not create historical reports or permit immediate catch-up runs.

There is no automatic payment collection, recurring billing, scheduler, notification delivery or continuous observation. A new satellite scene is not guaranteed. The interface states these limits before acceptance and execution. No additional paid API or billing setting is enabled.

## Report sources and quality

The backend rechecks the live Supabase identity, owned order, paid approval, field and boundary before claiming a run. It calls the existing authenticated Sentinel route and MET Norway weather service, loads owner-scoped irrigation logs, and optionally requests a text interpretation through the already configured free-tier Gemini gate. Source dates, coverage and limitations accompany the report. Repeated satellite acquisition dates are marked as the same scene and do not produce invented change values.

A partial report from available sources is labelled `needs_review` and counts toward the accepted plan, as disclosed before quote acceptance. Complete source failure is saved as `failed`, does not consume a report, and has bounded retries. Reports are automated and have not been reviewed by an agronomist. They do not certify disease, soil nutrients, pesticide doses or yield.

The customer can read previous reports and export JSON or use browser print/PDF. Deleting a field preserves order/report history with a null field reference, and prevents further quotation, payment approval or execution for that field.

## Database protections

`supabase/migrations/20261031160153_paid_field_services.sql` adds orders, reports, a private attempt audit and six checked RPCs. RLS limits reads to the owner or MFA allowlisted administrators. Named column grants exclude run capabilities and administrator identifiers. Clients have no direct table write grants. Public RPC wrappers are SECURITY INVOKER; private SECURITY DEFINER helpers use an empty search path and verify the current actor and each state transition. Existing users, fields and research orders are preserved.

An attempt has a 180-second lease, with at most three attempts per report, five attempts per user per UTC day and thirty attempts globally per UTC day, enforced by database locks and an immutable private audit. Owner-bound completion RPCs accept a bounded result envelope; stored results are not a cryptographic attestation of provider execution or independent review. Payment approval is always an administrator-only transition.

## Verification

- `node --test tests/*.test.mjs`: backend authorization, state gates, provider failures and comparison behavior, plus existing platform regressions.
- `python3 tests/check_pages.py`: local links, IDs and script syntax.
- `python3 tests/browser_field_services.py`: actual pinned Supabase SDK with isolated network fixtures, desktop/mobile customer flows and stale sessions.
- `python3 tests/browser_admin.py` and `python3 tests/browser_admin_field_services.py`: desktop/mobile MFA and payment administration, including late replies and role changes.
- `tests/field-services-rls.sql`: synthetic accounts and orders in one transaction ending in ROLLBACK; tests permissions, quote/payment transitions, leases, quotas and scheduling without changing real accounts.
- Deployment verification checks the published revision, required files, CORS and field-service status declarations. Anonymous requests must remain unauthorized.

Fixtures do not prove that a real transfer was received or validate an agricultural diagnosis. Final business acceptance uses the owner's own customer/admin sessions and a genuinely agreed order; no fabricated payment is recorded for a real customer.
