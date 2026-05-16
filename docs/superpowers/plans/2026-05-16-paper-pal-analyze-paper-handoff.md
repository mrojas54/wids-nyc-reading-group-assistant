# Handoff — `analyze-paper` upload-and-generate flow

**Status:** Drafted 2026-05-16. Successor to the SQL-block stub on `/new`. Builds out the Gemini Edge Function + browser PDF extraction + operator onboarding screen described in `paper-pal/project/design_handoff/tasks.md` (Tasks 1.1 + 5.1 + 5.2).

**Why a handoff:** The portal already has the read-render half of Paper Pal (PR #45). The remaining write half — operator uploads a PDF, Gemini analyses it, the result lands in `paper_companions` — is a self-contained slice that warrants its own PR.

---

## Scope (one PR)

1. **Supabase Edge Function `analyze-paper`** — receives `{ text, pdfBase64? }`, calls Gemini with a strict response schema, returns a `ResearchPaperAnalysis` JSON object.
2. **`web/lib/paperpal/pdf.ts`** — `extractPdfText(file: File): Promise<{ text: string; base64: string; pages: number }>` using `pdfjs-dist` in the browser.
3. **`web/app/new/page.tsx` (replace stub)** — drop zone + paste-text fallback + an Analyze button, gated on `members.role = 'operator'`.
4. **`web/app/new/actions.ts`** — server action `saveCompanion({ paperId?, payload })` that, if `paperId` is null, inserts a `papers` row (title/authors/venue/abstract/year from the payload), then upserts `paper_companions`, then sets `papers.companion_url = '/papers/<id>'`. Returns the new `paperId` so the client can route.
5. **Secrets**: `GEMINI_API_KEY` set on the Edge Function. Never in the browser bundle.

Everything else from PR #45 stays untouched.

---

## Edge Function (`analyze-paper/index.ts`)

```
supabase/functions/analyze-paper/index.ts
supabase/functions/analyze-paper/deno.json
```

Deploy with the Supabase MCP `deploy_edge_function` tool (or `supabase functions deploy analyze-paper` locally).

### Auth
- `verify_jwt: true` — the function is only callable by signed-in members. The frontend invokes via `supabase.functions.invoke(...)` which forwards the user session.
- Inside the function, **re-derive operator status server-side** before calling Gemini. Don't trust the client. Pattern:

```ts
const authHeader = req.headers.get("Authorization") ?? "";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: authHeader } },
});
const { data: memberId } = await sb.rpc("current_member_id");
if (!memberId) return new Response("unauthorized", { status: 401 });
const { data: m } = await sb.from("members").select("role").eq("id", memberId).maybeSingle();
if (m?.role !== "operator") return new Response("forbidden", { status: 403 });
```

### Request

```ts
type Req = {
  text: string;            // extracted PDF text or pasted paper body
  pdfBase64?: string;      // optional — only sent for multimodal future work
  lens?: "beginner" | "engineer" | "expert";  // hint to Gemini (does NOT branch UI)
};
```

Reject if `text.length < 200` (likely not a real paper).

### Gemini call

Use `@google/genai` from `npm:@google/genai` (Deno-supported). Model: `gemini-2.5-pro` (or whatever the org has access to — pull from env `GEMINI_MODEL`, default `gemini-2.5-pro`).

Structured output: pass `responseSchema` matching `ResearchPaperAnalysis` from `web/lib/paperpal/types.ts`. Inline the schema in `analyze-paper/schema.ts` (duplicate of `types.ts` shape, expressed in `@google/genai`'s `Schema` type) — Deno can't import from `web/lib/...`.

System prompt (sketch):

```
You are Paper Pal, a research-companion authoring assistant for the WiDS NYC AI Reading Group.
Given an academic paper, emit a single JSON object that conforms to the provided schema. Rules:
- Match the schema exactly. Do not add fields.
- `terminology`: 8–14 entries. Prefer terms a beginner won't know.
- `mathExplanations`: only equations that actually drive the method. Variable list is required.
- `diagrams[0]`: a single architecture flowchart in Mermaid syntax (`flowchart LR` or `flowchart TB`). Annotate the 4–8 most-important nodes with `jumpTo` pointing to a `term` or `math` you also defined.
- `assessmentQuiz`: 8 multiple-choice questions, 4 options each, exactly one correct. Tag each with `sectionRef`.
- `socraticPrompts`: 3 prompts: one per `sectionRef` ∈ {method, math, architecture}. Each has 4 `scriptedProbes`.
- No emoji. No marketing voice. Sage/restrained tone.
```

Token budget: leave at default; this call can take 30–60 s.

### Response

Return the parsed JSON directly. On Gemini error: 502 with the error message in the body. Log to `command_log` (`source='server_action'`, `command='analyze-paper'`, `payload={paperHash}`).

### Files

```
supabase/functions/analyze-paper/
├── index.ts        # Deno.serve handler (auth + Gemini + response)
├── schema.ts       # ResearchPaperAnalysis as @google/genai Schema
└── deno.json       # { "imports": { "@google/genai": "npm:@google/genai@^0.x" } }
```

---

## Browser PDF extraction (`web/lib/paperpal/pdf.ts`)

```ts
"use client";
import * as pdfjsLib from "pdfjs-dist";

// Vite/Next workers: import the bundled worker URL.
pdfjsLib.GlobalWorkerOptions.workerSrc =
  new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url).toString();

export async function extractPdfText(
  file: File,
): Promise<{ text: string; base64: string; pages: number }> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Y-coordinate line grouping — preserves reading order on multi-column papers.
    const grouped = new Map<number, string[]>();
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = Math.round(item.transform[5]);
      const bucket = grouped.get(y) ?? [];
      bucket.push(item.str);
      grouped.set(y, bucket);
    }
    const ySorted = [...grouped.keys()].sort((a, b) => b - a);
    for (const y of ySorted) lines.push(grouped.get(y)!.join(" "));
    lines.push(`\n--- page ${i} ---\n`);
  }
  return {
    text: lines.join("\n"),
    base64: Buffer.from(buf).toString("base64"),
    pages: doc.numPages,
  };
}
```

Add `pdfjs-dist` to `web/package.json`. Next 14 needs `next.config.mjs` to externalize the worker — pattern in the old `paperpal_-ai-research-companion` repo if it's still around.

---

## `/new` page UX

Replace the SQL-block stub. Match the prototype (`design/onboarding.jsx`).

```
┌──────────────────────────────────────────────────────────┐
│  Generate companion                                       │
│                                                           │
│  Drop a PDF here, or paste the body text.                 │
│  ┌──────────────────────────────────────────────────┐    │
│  │       [ drop zone — sage dashed border ]         │    │
│  │       or paste:                                   │    │
│  │       ┌────────────────────────────────────┐     │    │
│  │       │  <textarea>                        │     │    │
│  │       └────────────────────────────────────┘     │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  Lens hint:  ( Beginner | Engineer | Expert )            │
│                                                           │
│                                       [ Analyze ▶ ]      │
└──────────────────────────────────────────────────────────┘
```

States:
- `idle` → form visible
- `extracting` → "Reading PDF…" (1–3 s)
- `analyzing` → "Asking Gemini…" with a long-running spinner (30–60 s). Show the prototype's `animateLoading` step copy ("Identifying sections… extracting equations… building diagram…")
- `error` → red banner with retry
- `done` → route to `/papers/<id>` (server action returns the id)

Keep the operator gate from the existing stub.

---

## Server action (`web/app/new/actions.ts`)

```ts
"use server";
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ResearchPaperAnalysis } from "@/lib/paperpal/types";

export async function saveCompanion(args: {
  payload: ResearchPaperAnalysis;
  pdfDriveUrl?: string | null;
  existingPaperId?: number;
}): Promise<{ ok: true; paperId: number } | { ok: false; error: string }> {
  const sb = createSupabaseServerClient();
  const { data: memberId } = await sb.rpc("current_member_id");
  if (!memberId) return { ok: false, error: "Not signed in." };

  const { data: member } = await sb
    .from("members")
    .select("role")
    .eq("id", memberId)
    .maybeSingle();
  if (member?.role !== "operator") return { ok: false, error: "Operators only." };

  let paperId = args.existingPaperId ?? null;
  if (!paperId) {
    const { data: paper, error: insErr } = await sb
      .from("papers")
      .insert({
        title: args.payload.title,
        authors: args.payload.authors,
        venue: args.payload.venue ?? null,
        abstract: args.payload.abstractBreakdown.slice(0, 4000),
        pdf_drive_url: args.pdfDriveUrl ?? null,
      })
      .select("id")
      .single();
    if (insErr || !paper) return { ok: false, error: insErr?.message ?? "papers insert failed" };
    paperId = paper.id;
  }

  const { error: upErr } = await sb
    .from("paper_companions")
    .upsert({
      paper_id: paperId,
      payload: args.payload,
      generated_by: memberId,
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-pro",
    });
  if (upErr) return { ok: false, error: upErr.message };

  await sb
    .from("papers")
    .update({ companion_url: `/papers/${paperId}` })
    .eq("id", paperId);

  return { ok: true, paperId };
}
```

RLS already gates writes (migration 013) — the role check above is belt-and-suspenders and gives a clean error message.

---

## Wiring sequence (frontend)

```ts
// in /new client component
const file = ... // from dropzone
const { text, base64, pages } = await extractPdfText(file);
const { data, error } = await supabase.functions.invoke("analyze-paper", {
  body: { text, pdfBase64: base64, lens: tweaks.lens },
});
if (error) { /* surface */ return; }
const r = await saveCompanion({ payload: data, pdfDriveUrl: null });
if (r.ok) router.push(`/papers/${r.paperId}`);
```

The Supabase browser client (`@supabase/ssr` createBrowserClient) handles auth automatically.

---

## Secrets to set

```
GEMINI_API_KEY=<the key>
GEMINI_MODEL=gemini-2.5-pro   # optional; default in code
```

Via MCP: `update_function_secrets` (or via the Supabase dashboard → Project Settings → Functions → Secrets). **Don't** put these in `.env.local`; the Edge Function runtime reads them from the function-secrets store.

---

## Test plan

- [ ] Edge Function deploys; `supabase functions invoke analyze-paper --body '{"text":"..."}'` against a known short paper returns a valid `ResearchPaperAnalysis`.
- [ ] Non-operator member calling the function gets 403.
- [ ] Anonymous caller gets 401.
- [ ] Browser PDF extraction returns reasonable text on a real arXiv PDF (multi-column layout preserved).
- [ ] End-to-end on `/new`: drop PDF → extract → analyze → save → land on `/papers/<id>` with the synthesis dashboard rendered.
- [ ] Re-running on an existing paper id overwrites the companion row cleanly.
- [ ] `command_log` shows `command='analyze-paper'` entries on success and failure.

---

## Risks / open questions

- **Gemini cost.** A `gemini-2.5-pro` call on a 30-page paper is roughly 30k input + 5k output tokens. Worth a per-operator rate limit (e.g. 5 analyses / day) before exposing the button broadly.
- **Schema drift.** `analyze-paper/schema.ts` and `web/lib/paperpal/types.ts` must stay in sync. Add a vitest that asserts every field in `types.ts` appears in the Gemini schema (or generate one from the other).
- **PDF.js worker bundling.** Next 14 + `pdfjs-dist` is fiddly. If the worker import doesn't work, fall back to running PDF extraction in the Edge Function with a Deno-compatible parser — costs another roundtrip but sidesteps the bundler.
- **Long requests.** 60 s Gemini calls exceed Vercel's free-tier function timeout (10 s). The Edge Function runs on Supabase's Deno runtime which allows up to 150 s — good. But surface a clear "still working…" UI state to keep the operator from refreshing.
- **Paper deduplication.** No check against `papers.s2_paper_id` here. If the operator uploads a paper that's already in the catalog, this creates a duplicate row. Worth a "find existing first" query, but defer.

---

## Definition of done

- Operator can drop a real PDF on `/new` and end up on a populated `/papers/<id>` within ~90 s.
- Gemini key isn't in the browser bundle (`grep -r "GEMINI_API" web/.next/static/` returns nothing).
- Non-operator gets a clean error, not a crash.
- The Edge Function logs to `command_log` so failures are debuggable.
