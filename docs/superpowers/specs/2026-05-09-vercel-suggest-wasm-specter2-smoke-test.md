# Smoke Test Runbook — /admin/suggest with WASM SPECTER2 Fallback

Run on the Vercel **Preview** deployment created from PR-merge-candidate
before promoting to Production.

**Prereqs:**
- Logged in as a member with `role IN ('leader','admin')`.
- `S2_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SPECTER2_MODEL_BLOB_URL` set in Preview env.
- `EXPECTED_MODEL_SHA256` in code matches the file actually pushed to Blob.

## Scenario 1 — All papers in S2 corpus (happy path)

**Input:** 3 well-established arXiv IDs known to be in S2 with embeddings.
Examples: `arXiv:2106.11189`, `arXiv:2103.00020`, `arXiv:2010.11929`.

**Past picks:** "All papers from prior cycles" (default).

**Expected:**
- Response in <8s on warm Lambda.
- `diagnostics.fallback_used == 0`.
- `diagnostics.s2_fetched` reflects how many of those 3 weren't already cached.
- `ranked` contains 3 papers with non-empty titles.

## Scenario 2 — One arXiv preprint not in S2 (fallback fires)

**Input:** 1 candidate that's a brand-new arXiv preprint posted in the
last 24h (S2 hasn't ingested it yet) + 2 stable papers.

**Past picks:** "All papers from prior cycles".

**Expected:**
- Response in 10–20 s on warm, 20–30 s on cold (first cold start of the day).
- `diagnostics.fallback_used == 1` (the new preprint).
- `diagnostics.s2_fetched` shows the other 2.
- `diagnostics.cold_start == true` if first call after deploy/quiet period.
- `ranked` includes all 3 papers; the new preprint has its WASM-generated
  embedding cached in Supabase (verify via SQL after the test).

## Scenario 3 — S2 simulated down (fallback covers everything)

**Setup:** Temporarily set `S2_API_KEY` to an obviously-invalid value
(e.g. `BROKEN_KEY_TEST`) in Vercel Preview. Wait 60s for the change to
take effect.

**Input:** 2 candidates.

**Expected:**
- The 401 Auth error from S2 should NOT silently fall back; the route
  should return `502 s2_auth`. (This is the spec's carve-out.)
- After confirming, restore the real key.
- Repeat with a *transient* simulation: temporarily revoke the key in
  the S2 dashboard if possible (which yields 429), or change Vercel
  preview env to a key that's valid but rate-limited.
- Expected: `fallback_used == N` (covered all candidates).

## Post-test verification (SQL)

```sql
-- Confirm the new preprint from Scenario 2 has a cached embedding:
SELECT pe.paper_id, pe.model, pe.cached_at
FROM paper_embeddings pe
JOIN papers p ON p.id = pe.paper_id
WHERE p.s2_paper_id = '<the preprint id>' AND pe.model = 'specter_v2';
```

Expect 1 row, `cached_at` within the last few minutes.

## Pass/fail criteria

All three scenarios produce the expected diagnostics and SQL state.
Failures block promotion to Production.
