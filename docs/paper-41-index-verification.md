# October paper: live Supabase indexing verification

Completed October 12, 2026 (America/New_York) in Supabase project
`dmyulakudbdegwkqgelx`, following explicit operator authorization to apply
migration 035 and index the October Drive paper.

## Applied and indexed

- Applied the unchanged `migrations/035_paper_passage_search.sql` using
  `supabase db query --linked --project-ref dmyulakudbdegwkqgelx --file ...`.
  This executes the transaction without adding a migration-history row. Check
  the actual objects before attempting any future replay.
- Downloaded [paper.pdf](https://drive.google.com/file/d/1ow5nbrsflTHuxqXKlWFlQ_FrCynMPiIX/view)
  from Drive after account access was resolved. PDF metadata confirms **The Misery
  of Mechanistic Interpretability: A Formal Perspective**, 26 pages, 714,722 bytes.
- Filled `papers.pdf_drive_url` for paper 41, conditional on the value still being
  NULL. The returned row and subsequent independent read confirm the exact link.
- Indexed **119 passages covering pages 1–26**, with local GTE-small embeddings,
  384 dimensions, and the pinned model `gte-small-93b36ff-mean-normalized-v1`.
- Database indexing timestamp: `2026-10-12T04:17:42.644966Z` (12:17 AM EDT).

PDF SHA-256:
`9bc6de9ef9791d1edeec85f1b45a43df1d6cf851c1310a2d4f3c0cb21a7226ce`

Indexed source version (1,000-character chunks):
`4c8ac0dba78dafdda3238847e67e1b812e4c474a19ac16272e327c50fc5a38b6`

## Verification evidence

Independent REST readback compared **every stored passage** against the local
manifest: IDs, page numbers, exact text, and start/end offsets all matched.
Database readback confirmed 119 vectors of 384 dimensions across all 26 pages.

Both new tables have RLS enabled and authenticated SELECT policies. All three
new functions are SECURITY INVOKER. Grant checks confirmed anonymous reads,
member inserts, and member ingestion-RPC execution are denied; the service role
can execute ingestion. A rolled-back live role test confirmed the actual linked
meeting leader sees all 119 passages and an unlinked authenticated identity sees
zero. No member records were created or changed for this test.

The security advisor reported no warning against the new passage tables or
functions. Its warnings concern the already-existing public-schema vector
extension, existing SECURITY DEFINER member/gate/availability helpers, and Auth
leaked-password protection. Those settings were not changed.

Three live REST retrieval probes completed and returned canonical excerpts:

| Question | Observed top results | Assessment |
| --- | --- | --- |
| How is the faithfulness gap defined? | Chart fragments on pages 24–26 | Poor definition retrieval; ranking needs work. |
| What does verification-aware training improve? | Relevant page-6 passages; supporting page-21 result | Useful evidence, although chunk boundaries split a caption. |
| Which model families were evaluated? | Related discussion on pages 3, 8, and 1 | Top results do not directly enumerate the model families. |

This confirms storage, embeddings, RPC connectivity, canonical provenance, and
access controls. It does **not** establish answer quality or launch readiness.
Before enabling cited discussion, tune extraction/chunk boundaries and retrieval
ranking on a labeled question set. Formula and chart layout remains lossy in
text extraction; image-only evidence needs a separate path.

Local PDF, manifest, vectors, and retrieval probe output are retained under the
ignored `web/.paperpal-local/` directory. They are not committed to Git. The
existing companion, SPECTER2 recommendation cache, and Turbopuffer setup were not
changed. Member discussion and understanding-check UI remain planned.
