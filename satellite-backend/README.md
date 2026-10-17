# UR Smart — Sentinel-2 automatic NDVI / NDMI
This Cloudflare Worker is a **separate backend**, not deployed by GitHub Pages. It verifies the farmer's Supabase access token and reads only their saved field boundary via existing RLS, then calls Sentinel Hub's Statistical API. Sentinel credentials stay on the server.

## Setup
1. Create a Sentinel Hub account and OAuth client credentials with Statistical API access (quota or charges may apply).
2. Deploy `worker.js` as a Cloudflare Worker.
3. Configure secrets `SENTINEL_CLIENT_ID` and `SENTINEL_CLIENT_SECRET`; variables `SUPABASE_URL=https://ynsmhtsktbubxfhsekjq.supabase.co`, `SUPABASE_PUBLISHABLE_KEY=<existing publishable key>`, and `ALLOWED_ORIGIN=https://urfarmiq.github.io`.
4. Set `SATELLITE_API_URL` in `satellite-analysis.html` to the Worker URL, commit and redeploy.
5. Set a Cloudflare rate limit and Sentinel Hub spending quota before public release.

The worker processes the latest available valid Sentinel-2 L2A image within 65 days using cloud/shadow masking (SCL) and returns mean NDVI/NDMI across the saved polygon. The cloud coverage of the scene is filtered but a precise **field cloud percentage is not currently returned**. No results are shown unless the actual API succeeds. No credentials should be committed.
