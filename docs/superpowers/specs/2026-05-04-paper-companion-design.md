# Paper Companion (Phase 6) — Design

**Status:** Approved 2026-05-04
**Scope:** Plan §"Phase 6 — Paper Companion Page (Rendering Only)" in `docs/superpowers/plans/2026-05-03-wids-member-app.md`. This document specifies the rendering surface only. Content generation (Phase 7's `/wids-make-companion` slash command) is out of scope.
**Audience:** Members reading a paper before a meeting, plus anyone who got a forwarded link.

## Goal

Render a public, readable companion page for any paper at `/papers/<id>`. The companion gives a section-by-section walkthrough with a short summary, a Mermaid diagram, and a code illustration per section. A "Open notebook in Colab" CTA appears when the corresponding notebook file exists.

The page must:
- Read content from a JSON file under `web/content/papers/`. No DB call on the request path.
- Be reachable without signing in (middleware already excludes `/papers/*`).
- Look like a WiDS NYC page — branded but not buried under app chrome.
- Tolerate missing or malformed content with a clean 404, and missing notebooks by hiding the Colab CTA.

## Architecture

```
web/
  app/
    papers/
      layout.tsx              ← thin branded layout (Brandmark + Sign in link)
      [id]/
        page.tsx              ← server component: read JSON, fs-check notebook, render
  components/
    PaperCompanion.tsx        ← server: header, sections, footer
    MermaidDiagram.tsx        ← client: dynamic-imports mermaid, themed render
  content/
    papers/
      test.json               ← permanent fixture, powers /papers/test
  lib/
    paperContent.ts           ← PaperContent type, readPaperContent, listPaperContentIds
  public/
    notebooks/
      <id>.ipynb              ← produced by Phase 7; absent in Phase 6
```

**Why file-based content:** Companions are static once generated. Reads are cheap, deploys are atomic, git is the version history. No need for a DB table, no RLS to think about for a public surface.

**Why server component for the page:** `node:fs` runs at build/request time. `generateStaticParams()` enumerates fixture files so the route prerenders.

**Why client component for Mermaid:** The library accesses `document` to render SVG. It also adds ~500KB; isolating it to one component keeps the main bundle clean.

## Components and contracts

### `lib/paperContent.ts`

```ts
export type PaperSection = {
  title: string;
  summary: string;     // markdown-ready prose, 2–4 sentences
  mermaid: string;     // mermaid source
  code: string;        // python source
};

export type PaperContent = {
  paper_id: number;
  title: string;
  authors: string[];
  arxiv_url?: string;
  notebook_path: string;     // e.g. "/notebooks/42.ipynb" — relative to /public
  generated_at: string;       // ISO timestamp
  sections: PaperSection[];
};

export async function readPaperContent(id: string): Promise<PaperContent | null>;
export async function listPaperContentIds(): Promise<string[]>;
```

`readPaperContent` returns `null` on any read failure (missing file, bad JSON). Caller decides what to do — the page calls `notFound()`. `listPaperContentIds` returns `[]` if the directory doesn't exist (clean state on a fresh checkout).

### `components/MermaidDiagram.tsx`

Client component. Props: `{ source: string }`.

On mount, dynamic-imports `mermaid`, calls `mermaid.initialize(...)` with custom theme variables, then `mermaid.render(uniqueId, source)` and inserts the SVG into a ref'd `<div>`. On parse error, renders an inline `<pre>` with the error message instead — the rest of the page is unaffected.

Theme config:
```ts
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  themeVariables: {
    primaryColor:        "#dde9e1",  // sage-100 (literal, not var() — mermaid eats SVG)
    primaryTextColor:    "#244338",  // sage-800
    primaryBorderColor:  "#467560",  // sage-600
    lineColor:           "#a89c81",  // paper-400
    textColor:           "#3f3a2e",  // paper-700
    fontFamily:          "Geist, system-ui, sans-serif",
  },
});
```

Token literals are duplicated here because Mermaid renders SVG strings outside the CSS cascade — `var(--color-sage-100)` resolves to nothing. Tokens are commented inline; if `globals.css` ever changes, these need to follow. Acceptable duplication for a single, isolated component.

### `components/PaperCompanion.tsx`

Server component. Props: `{ content: PaperContent; colabUrl: string | null }`.

Renders:
1. Title block — `content.title` (h1), `content.authors.join(", ")`, optional arXiv link.
2. Optional Colab `<Button>` (uses the existing `Button` primitive). Hidden when `colabUrl` is `null`.
3. For each section: numbered h2, summary paragraph, `<MermaidDiagram>`, code block. Code block uses `<pre><code>` with `bg-paper-100`, `font-mono`, `text-sm`, `overflow-x-auto`, `rounded`, `p-3`. No syntax highlighting.
4. Footer: "Generated `<date>`. The paper itself is the source of truth."

No per-section Colab anchor links in this phase — Phase 7 hasn't pinned cell ids yet. We'll revisit when notebooks exist.

### `app/papers/layout.tsx`

```tsx
export default function PapersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-paper-50)] text-[var(--color-paper-800)]">
      <header className="border-b border-[var(--color-paper-200)] bg-white/60 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <Brandmark />
          <a href="/" className="text-sm text-[var(--color-sage-700)] hover:underline">Sign in</a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
```

Important: this layout does NOT inherit the dashboard's auth-aware header. `/papers/*` is intentionally separate from the app shell so anonymous readers don't see broken sign-in state or "Welcome back" greetings.

### `app/papers/[id]/page.tsx`

```tsx
import { promises as fs } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { readPaperContent, listPaperContentIds } from "@/lib/paperContent";
import { PaperCompanion } from "@/components/PaperCompanion";

export async function generateStaticParams() {
  const ids = await listPaperContentIds();
  return ids.map((id) => ({ id }));
}

export default async function PaperPage({ params }: { params: { id: string } }) {
  const content = await readPaperContent(params.id);
  if (!content) notFound();

  const repo = process.env.NEXT_PUBLIC_GITHUB_REPO;
  let colabUrl: string | null = null;
  if (repo) {
    const notebookFsPath = path.join(process.cwd(), "public", content.notebook_path.replace(/^\//, ""));
    try {
      await fs.access(notebookFsPath);
      colabUrl = `https://colab.research.google.com/github/${repo}/blob/main/web/public${content.notebook_path}`;
    } catch {
      colabUrl = null;
    }
  }

  return <PaperCompanion content={content} colabUrl={colabUrl} />;
}
```

The `fs.access` call is the only IO beyond `readPaperContent`. Cheap and synchronous-ish on the local FS. Acceptable per-render cost for a static-feeling page.

## Data flow

```
Request /papers/test
        ↓
middleware.ts (matcher excludes /papers — no auth check)
        ↓
app/papers/layout.tsx renders branded shell
        ↓
app/papers/[id]/page.tsx
   ├── readPaperContent("test") → web/content/papers/test.json
   ├── fs.access("public/notebooks/test.ipynb") → may throw → colabUrl = null
   └── PaperCompanion renders sections
        ↓
   Each section: server-rendered text/code
        ↓
   MermaidDiagram (client) hydrates → dynamic-imports mermaid → renders SVG
```

## Deviations from the original plan

The plan was written before the design bundle landed. These adaptations match Phase 3 and Phase 4 precedent:

| Plan ships | We ship | Why |
|------------|---------|-----|
| `theme: "neutral"` | `theme: "base"` + sage/paper themeVariables (Q2b) | Diagrams should feel like part of the page |
| `text-zinc-*`, `text-blue-700`, `bg-zinc-100` | `text-paper-*`, `text-sage-700`, `bg-paper-100` | Consistent with established design tokens |
| Raw `<a class="bg-zinc-900...">` for Colab | `<Button>` primitive | Reuse the established CTA component |
| Colab button always visible | Hidden when notebook file is missing (Q3b) | Don't promise a working link before Phase 7 lands |
| Per-section "Run cell N in Colab" anchor links | Omitted in this phase | Cell ids aren't pinned until Phase 7 |
| No layout file for `/papers` | Added `app/papers/layout.tsx` (Q1b) | Anonymous readers need branded shell, not app chrome |

## Error handling

- **Unknown id** (`/papers/999`): `readPaperContent` returns `null` → `notFound()` → Next.js default 404. Acceptable for this phase; can theme later if needed.
- **Malformed JSON** (someone hand-edits the file): caught in `readPaperContent`, returns `null`, treated same as unknown id.
- **Mermaid parse error**: caught in `MermaidDiagram`, renders inline `<pre className="text-sm" style={{ color: 'var(--color-magenta-700)' }}>Diagram error: ...</pre>`. Rest of the section (summary, code) still renders.
- **Missing notebook file**: `fs.access` throws → `colabUrl = null` → Colab button not rendered. Page is otherwise complete.
- **Missing `NEXT_PUBLIC_GITHUB_REPO`**: same as missing notebook — no Colab button. The companion still works without env config; Colab is enrichment.

## Testing

**Hand-test (after Task 6.3 lands):**

1. `cd web && npm run dev`
2. In an incognito window (so signed-out state is real), visit `http://localhost:3000/papers/test`.
3. Confirm:
   - Brandmark renders top-left, "Sign in" link top-right.
   - Title "Attention Is All You Need (test fixture)" + author line + arXiv link visible.
   - No Colab button (no `public/notebooks/test.ipynb` exists).
   - Two sections render with summary + sage-toned Mermaid diagram + code block.
   - Footer shows "Generated `<date>`".
   - No console errors.
4. Visit `http://localhost:3000/papers/999`. Confirm: 404 page.
5. Visit `http://localhost:3000/papers/test` while signed in (separate tab). Confirm: identical view (no auth-aware switching this phase).
6. Click "Sign in" link. Confirm: redirects to `/`.

**Build/typecheck:** `npm run build` must succeed. `npm run lint` must pass.

**Automated tests:** None this phase. The page is thin glue around file IO and a single client component; the value of unit tests is low relative to the hand-test. Revisit once Phase 7 generates content programmatically.

## Out of scope

- Notebook generation (`.ipynb` files) — Phase 7's `/wids-make-companion` slash command.
- Code syntax highlighting — paper-100 background is enough for v1; revisit if Phase 7 output looks dead.
- View-counting, comments, or any social/feedback layer.
- Paper index/search page (`/papers` with no id) — Phase 6 ships individual pages only.
- Auth-aware variants (e.g., "Sign in to RSVP" inline) — out of scope; the dashboard already has RSVP affordances.
- Mobile-specific layout work beyond `max-w-3xl` and standard responsive defaults.
- Print stylesheet for "read on the train" — system defaults are acceptable.

## Open risks

- **Mermaid theme variable coverage.** Some shape types (e.g., subgraphs, sequence participants) ignore `themeVariables`. We won't know which until Phase 7 ships real diagrams. Mitigation: this is a `theme` config tweak, not architectural — easy to revisit.
- **Hydration mismatch on Mermaid.** Mermaid renders entirely client-side, so the server output is an empty `<div>`. Should be fine, but watch the console on first hand-test.
- **Static generation surface.** `generateStaticParams()` will prerender every fixture in `web/content/papers/` at build time. Once Phase 7 produces dozens of files, build time grows linearly. Acceptable for now; revisit if it becomes a problem.
