# UR Smart — openEO integration (staging only)

Status: investigation; NOT connected to production. No real NDVI/NDMI result should be claimed until a successful authenticated request and validation.

## Existing system
- Production web page: `satellite-analysis.html`, currently POSTs `{field_id}` with a Supabase session bearer token to `ur-smart-satellite.alialbatekh111.workers.dev`.
- Existing staging worker: `satellite-backend/worker.staging.js`; retains Sentinel Hub credentials. Do not deploy it as the production Worker.
- Boundary source: Supabase `field_boundaries`, protected by ownership/RLS. Geometry is EPSG:4326.
- Current `wrangler.jsonc` names the production Worker. **Do not run default `wrangler deploy` while testing.**

## openEO candidate
- Federation endpoint: https://openeofed.dataspace.copernicus.eu/
- CDSE endpoint: https://openeo.dataspace.copernicus.eu/
- Free-tier documentation mentions a limit of two concurrent synchronous requests and two concurrent batch jobs; other quotas and authentication terms must be checked.
- The API is not an anonymous replacement for Sentinel Hub: inspect OIDC authentication and backend supported processes/collections before implementation.

## Implementation acceptance criteria
1. Add a separate staging backend with its own Worker name; never overwrite `ur-smart-satellite`.
2. Authenticate server-side with supported openEO flow; never put credentials or refresh tokens in GitHub Pages or committed files.
3. Accept existing authenticated `field_id` requests, verify user ownership via Supabase, and read the saved polygon.
4. Select Sentinel-2 L2A collection and appropriate bands (B04, B08, B11) with cloud/scene classification masking; compute NDVI and NDMI using a documented openEO process graph.
5. Use an appropriate spatial reference and pixel resolution, not `resx:20` degrees with EPSG:4326. Record cloud coverage, date, pixel count, and valid area.
6. Reject inadequate samples; do not fabricate readings or prescribe fertilizer/irrigation solely from vegetation indices.
7. Verify real API response with a small authorized test field and compare against a known-good scene before changing the web page's API URL.
8. Keep production URL, Supabase data, and current login behavior unchanged until explicit cutover.

## Immediate blocker
A documented supported non-interactive openEO authorization flow suitable for a Cloudflare Worker must be established. A browser login alone is not enough to automate service-to-service requests. No secret should be requested in chat.
