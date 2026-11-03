# Products and Wasit installation inquiries

`products.html` is a public Arabic catalog for drip-irrigation supplies, drip-irrigation installation within Wasit only, an agricultural weather station and an insect-control station. The owner requested the physical installation service on 3 November 2026, replacing the previous digital-only scope for this specific service.

Station models, original photos, specifications and prices will be supplied by the owner after this conversation. Until then, the catalog offers a request for details and a quotation. It does not invent inventory, product capabilities, effectiveness, delivery coverage, warranty terms, fixed prices or a connection to live station readings. The existing weather page continues to show model forecasts independently.

## Customer and administrator

Customers can browse the catalog without signing in. An existing UR account is required to save and follow a quotation inquiry. The customer chooses an item, quantity and governorate, with optional district, area, telephone and notes. The installation item requires Wasit and quantity one; other governorates are blocked in both the UI and the database. The location on a product inquiry is a proposed delivery location, not confirmed shipping coverage.

Private inquiries and administrator replies appear inside the customer's account. An allowlisted administrator with MFA reads and reviews inquiries in the existing administration page, replies and can provide an actual IQD quotation. This is a proposed quotation, not a payment confirmation, stock reservation or executed installation. Product supply, shipping and installation details are agreed before any payment or work. No money is collected automatically and no external messages are sent by this feature.

Customers can cancel their own new or reviewing inquiries. Quoted inquiries retain the displayed offer; closed and cancelled inquiries cannot be reopened through the review RPC. The administrator cannot edit a customer's original request or impersonate payment receipt through this flow.

## Database and privacy

`product_inquiries` is additive and leaves existing accounts, fields, research, paid reports and satellite access unchanged. Named SELECT grants exclude the administrator identity. RLS allows the owner or an MFA allowlisted administrator to read. Clients cannot insert or update table rows directly. Public RPCs use SECURITY INVOKER wrappers around checked private SECURITY DEFINER functions with an empty search path.

Creation is limited per confirmed owner to ten open inquiries and five inquiries per UTC day, with a transaction advisory lock. Item codes and governorates are validated; the Wasit restriction is also a table constraint. Optional contact details are private and used only for the inquiry; no password, token or payment-card data is requested.

## Verification

`tests/product-inquiries-rls.sql` checks permissions, MFA, ownership, Wasit enforcement, bounds, quotas, quoted replies and cancellation with synthetic rows inside a transaction ending in ROLLBACK. Customer and administrator browser fixtures cover desktop/mobile workflows, owner filtering, response handling, stale sessions and safe rendering. Existing platform tests, public-page checks and deployment file hashes verify integration.

Tests do not create a real purchase, supplier commitment, payment or installation booking. Those remain subject to the owner agreeing actual product details and execution terms with the customer.
