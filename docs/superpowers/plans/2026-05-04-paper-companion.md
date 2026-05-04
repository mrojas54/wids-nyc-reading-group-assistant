# Paper Companion (Phase 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a public, readable companion page at `/papers/<id>` with a branded header, jump-list TOC, vocabulary glossary, and per-section walkthroughs (summary + Mermaid diagram + code block). Conditionally show a Colab link when the corresponding notebook exists.

**Architecture:** File-based content (JSON under `web/content/papers/`). Server component reads the file via `node:fs`, runs an `fs.access` check for the optional notebook, and hands the content to a server-rendered `PaperCompanion`. Mermaid runs only in a `"use client"` child (browser-only library; isolated to keep main bundle clean). Public route — `web/middleware.ts` already excludes `/papers/*` from auth.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind + design-system CSS (sage/magenta/paper tokens in `globals.css`), `mermaid` (already installed at `^11.14.0`), `node:fs/promises`.

**Spec:** [docs/superpowers/specs/2026-05-04-paper-companion-design.md](../specs/2026-05-04-paper-companion-design.md)

**File map:**

| Path | Action | Responsibility |
|------|--------|----------------|
| `web/lib/paperContent.ts` | Create | Types (`PaperSection`, `VocabularyEntry`, `PaperContent`) + `readPaperContent` / `listPaperContentIds` |
| `web/content/papers/test.json` | Create | Hand-authored fixture (powers `/papers/test` permanently) |
| `web/components/MermaidDiagram.tsx` | Create | Client component — dynamic-imports mermaid, applies sage/paper themeVariables |
| `web/components/PaperCompanion.tsx` | Create | Server component — title block + Colab CTA + TOC + Vocabulary + sections + footer |
| `web/app/papers/layout.tsx` | Create | Thin branded shell (Brandmark + "Sign in" link), no app chrome |
| `web/app/papers/[id]/page.tsx` | Create | Reads content, fs-checks notebook for conditional Colab URL, renders `PaperCompanion` |
| `web/.env.example` | Modify | Append `NEXT_PUBLIC_GITHUB_REPO=` |

**Working directory for all commands:** `web/` unless noted.

**Testing model:** No automated test framework in this repo (per spec). Each task's verification is `npx tsc --noEmit` (or `npm run build` at the end) plus a final browser hand-test in Task 5. Per-step "expected output" notes call out what success looks like.

---

## Task 1: Content schema + test fixture

**Files:**
- Create: `web/lib/paperContent.ts`
- Create: `web/content/papers/test.json`

- [ ] **Step 1: Write `web/lib/paperContent.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";

export type PaperSection = {
  title: string;
  summary: string;
  mermaid: string;
  code: string;
};

export type VocabularyEntry = {
  term: string;
  definition: string;
};

export type PaperContent = {
  paper_id: number;
  title: string;
  authors: string[];
  paper_url?: string;
  notebook_path: string;
  generated_at: string;
  vocabulary?: VocabularyEntry[];
  sections: PaperSection[];
};

const CONTENT_DIR = path.join(process.cwd(), "content", "papers");

export async function readPaperContent(id: string): Promise<PaperContent | null> {
  try {
    const raw = await fs.readFile(path.join(CONTENT_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw) as PaperContent;
  } catch {
    return null;
  }
}

export async function listPaperContentIds(): Promise<string[]> {
  try {
    const files = await fs.readdir(CONTENT_DIR);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Write `web/content/papers/test.json`**

```json
{
  "paper_id": 9999,
  "title": "Attention Is All You Need (test fixture)",
  "authors": ["Vaswani et al."],
  "paper_url": "https://arxiv.org/abs/1706.03762",
  "notebook_path": "/notebooks/9999.ipynb",
  "generated_at": "2026-05-04T07:00:00Z",
  "vocabulary": [
    {
      "term": "Token",
      "definition": "A discrete unit of input — typically a word piece or subword id the model operates on."
    },
    {
      "term": "Embedding",
      "definition": "A learned dense vector that maps a token id into the model's continuous representation space."
    },
    {
      "term": "Self-attention",
      "definition": "A mechanism where every token attends to every other token via learned query, key, and value projections."
    },
    {
      "term": "Query / Key / Value",
      "definition": "Three projections of each token used by attention: queries are matched against keys to produce weights that combine values."
    }
  ],
  "sections": [
    {
      "title": "Problem",
      "summary": "RNNs and CNNs were the dominant architectures for sequence modeling, but they struggled with long-range dependencies and forced sequential computation. The authors propose attention as the sole mechanism, removing recurrence entirely.",
      "mermaid": "flowchart LR\n  Input -->|tokens| Encoder\n  Encoder --> Decoder\n  Decoder -->|tokens| Output",
      "code": "import numpy as np\n# Tokens as integer ids — the model never sees raw text.\ntokens = np.array([1, 5, 3, 7])\nprint('shape:', tokens.shape)"
    },
    {
      "title": "Self-attention",
      "summary": "Each token attends to all others through learned query, key, and value projections. The dot-product attention formula scales by sqrt(d_k) for numerical stability before the softmax.",
      "mermaid": "flowchart TD\n  Q[Query] --> Score\n  K[Key] --> Score\n  Score -->|softmax| Weights\n  V[Value] --> Output\n  Weights --> Output",
      "code": "import numpy as np\nd_k = 4\nQ = np.random.randn(3, d_k); K = np.random.randn(3, d_k); V = np.random.randn(3, d_k)\nscores = Q @ K.T / np.sqrt(d_k)\nweights = np.exp(scores) / np.exp(scores).sum(axis=-1, keepdims=True)\nprint('attn out:\\n', weights @ V)"
    }
  ]
}
```

- [ ] **Step 3: Typecheck**

Run from `web/`: `npx tsc --noEmit`
Expected: PASS, no errors. (Nothing imports `paperContent.ts` yet but the file should compile.)

- [ ] **Step 4: Commit**

```bash
git add web/lib/paperContent.ts web/content/papers/test.json
git commit -m "feat: paper content schema + test fixture with vocabulary

Adds PaperContent / PaperSection / VocabularyEntry types and file-based
read helpers (readPaperContent / listPaperContentIds). The test fixture
hand-authors a small vocabulary; Phase 7 will need a subagent stage to
extract entries from real papers."
```

---

## Task 2: MermaidDiagram client component

**Files:**
- Create: `web/components/MermaidDiagram.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

// Note: hex literals duplicated from globals.css because mermaid renders SVG
// strings outside the CSS cascade — var(--color-...) resolves to nothing here.
// If globals.css tokens change, update these too.
const THEME_VARIABLES = {
  primaryColor: "#dde9e1",        // sage-100
  primaryTextColor: "#244338",    // sage-800
  primaryBorderColor: "#467560",  // sage-600
  lineColor: "#a89c81",           // paper-400
  textColor: "#3f3a2e",           // paper-700
  fontFamily: "Geist, system-ui, sans-serif",
};

export function MermaidDiagram({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: THEME_VARIABLES,
      });
      try {
        const id = `m-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) setErr(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (err) {
    return (
      <pre
        className="text-sm my-4"
        style={{ color: "var(--color-magenta-700)" }}
      >
        Diagram error: {err}
      </pre>
    );
  }
  return <div ref={ref} className="my-4" />;
}
```

- [ ] **Step 2: Typecheck**

Run from `web/`: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/components/MermaidDiagram.tsx
git commit -m "feat: themed MermaidDiagram client component

Dynamic-imports mermaid, initializes with sage/paper theme variables,
renders SVG into a ref'd div. Parse errors render inline in magenta-700
without breaking the rest of the page."
```

---

## Task 3: PaperCompanion server component

**Files:**
- Create: `web/components/PaperCompanion.tsx`

- [ ] **Step 1: Write the component**

```tsx
import type { PaperContent } from "@/lib/paperContent";
import { MermaidDiagram } from "./MermaidDiagram";

export function PaperCompanion({
  content,
  colabUrl,
}: {
  content: PaperContent;
  colabUrl: string | null;
}) {
  const hasVocabulary = !!content.vocabulary && content.vocabulary.length > 0;

  return (
    <article className="space-y-10">
      <header className="space-y-3">
        <h1
          className="text-2xl font-semibold"
          style={{ color: "var(--color-paper-800)" }}
        >
          {content.title}
        </h1>
        <p
          className="text-sm"
          style={{ color: "var(--color-paper-600)" }}
        >
          {content.authors.join(", ")}
        </p>
        {content.paper_url && (
          <a
            href={content.paper_url}
            target="_blank"
            rel="noopener"
            className="inline-block text-sm hover:underline"
            style={{ color: "var(--color-sage-700)" }}
          >
            arXiv ↗
          </a>
        )}
      </header>

      {colabUrl && (
        <div>
          <a
            href={colabUrl}
            target="_blank"
            rel="noopener"
            className="btn btn-primary"
          >
            Open notebook in Colab ↗
          </a>
        </div>
      )}

      {content.sections.length > 0 && (
        <nav aria-labelledby="toc-heading" className="space-y-3">
          <h2
            id="toc-heading"
            className="text-lg font-semibold"
            style={{ color: "var(--color-paper-800)" }}
          >
            In this companion.
          </h2>
          <ol className="list-decimal list-inside space-y-1">
            {content.sections.map((s, i) => (
              <li key={i}>
                <a
                  href={`#section-${i + 1}`}
                  className="hover:underline"
                  style={{ color: "var(--color-sage-700)" }}
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {hasVocabulary && (
        <section aria-labelledby="vocab-heading" className="space-y-3">
          <h2
            id="vocab-heading"
            className="text-lg font-semibold"
            style={{ color: "var(--color-paper-800)" }}
          >
            Vocabulary.
          </h2>
          <dl className="space-y-2">
            {content.vocabulary!.map((v, i) => (
              <div key={i} className="flex flex-col sm:flex-row gap-1 sm:gap-3">
                <dt
                  className="font-semibold sm:min-w-[12rem]"
                  style={{ color: "var(--color-sage-700)" }}
                >
                  {v.term}
                </dt>
                <dd style={{ color: "var(--color-paper-700)" }}>
                  {v.definition}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {content.sections.map((s, i) => (
        <section
          key={i}
          id={`section-${i + 1}`}
          className="space-y-3 scroll-mt-24"
        >
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--color-paper-800)" }}
          >
            {i + 1}. {s.title}
          </h2>
          <p style={{ color: "var(--color-paper-700)" }}>{s.summary}</p>
          <MermaidDiagram source={s.mermaid} />
          <pre
            className="rounded p-3 text-sm overflow-x-auto"
            style={{
              background: "var(--color-paper-100)",
              color: "var(--color-paper-800)",
              fontFamily: "'Geist Mono', ui-monospace, monospace",
            }}
          >
            <code>{s.code}</code>
          </pre>
        </section>
      ))}

      <footer
        className="border-t pt-4 text-xs"
        style={{
          borderColor: "var(--color-paper-200)",
          color: "var(--color-paper-600)",
        }}
      >
        Generated{" "}
        {new Date(content.generated_at).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
        . The paper itself is the source of truth.
      </footer>
    </article>
  );
}
```

Why `scroll-mt-24` on each section: the branded header is sticky-feeling at the top; without scroll-margin, anchor jumps land with the heading hidden under the header. 6rem (24 in Tailwind) gives breathing room.

Why the inline `style={{ color: 'var(...)' }}` pattern: Tailwind's arbitrary values (`text-[var(--color-...)]`) work but generate longer class names; inline style stays close to the design tokens and matches the pattern established in dashboard components.

Why `<a className="btn btn-primary">` instead of `<Button>`: the existing `Button` primitive only renders `<button>` (not polymorphic). Reusing the `.btn` CSS classes on an anchor gives the same visual treatment without forcing Button to grow.

- [ ] **Step 2: Typecheck**

Run from `web/`: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/components/PaperCompanion.tsx
git commit -m "feat: PaperCompanion with TOC + Vocabulary blocks

Renders title block, conditional Colab anchor, jump-list TOC, optional
vocabulary glossary, sections (summary + MermaidDiagram + code), footer.
Sections use index-based ids (section-1, section-2) so anchors stay
stable across Phase 7 regenerations even if titles change."
```

---

## Task 4: Branded layout + page + env example

**Files:**
- Create: `web/app/papers/layout.tsx`
- Create: `web/app/papers/[id]/page.tsx`
- Modify: `web/.env.example`

- [ ] **Step 1: Write `web/app/papers/layout.tsx`**

```tsx
import type { ReactNode } from "react";
import { Brandmark } from "@/components/ui";

export default function PapersLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen"
      style={{
        background: "var(--color-paper-50)",
        color: "var(--color-paper-800)",
      }}
    >
      <header
        className="border-b"
        style={{
          borderColor: "var(--color-paper-200)",
          background: "rgba(255, 255, 255, 0.6)",
          backdropFilter: "blur(6px)",
        }}
      >
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <Brandmark />
          <a
            href="/"
            className="text-sm hover:underline"
            style={{ color: "var(--color-sage-700)" }}
          >
            Sign in
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
```

Why a separate layout: the `app/layout.tsx` root does NOT include any auth-aware header (auth pages live under their own folders). But `/papers/*` needs its own minimal-but-branded shell that's distinct from the dashboard shell. This file gives that shell exactly the scope of `/papers/*`.

- [ ] **Step 2: Write `web/app/papers/[id]/page.tsx`**

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

export default async function PaperPage({
  params,
}: {
  params: { id: string };
}) {
  const content = await readPaperContent(params.id);
  if (!content) notFound();

  const repo = process.env.NEXT_PUBLIC_GITHUB_REPO;
  let colabUrl: string | null = null;
  if (repo) {
    const notebookFsPath = path.join(
      process.cwd(),
      "public",
      content.notebook_path.replace(/^\//, ""),
    );
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

- [ ] **Step 3: Append to `web/.env.example`**

Open `web/.env.example`. At the end of the file, add:

```dotenv

# GitHub repo for the Colab "Open notebook" link (e.g. "mrojas54/wids-nyc-reading-group-assistant").
# Optional — when unset, the Colab button is never rendered.
NEXT_PUBLIC_GITHUB_REPO=
```

- [ ] **Step 4: Typecheck and build**

Run from `web/`:
```bash
npx tsc --noEmit
```
Expected: PASS.

Then:
```bash
npm run lint
```
Expected: no errors.

Then:
```bash
npm run build
```
Expected: build succeeds. Look for `/papers/[id]` in the output and confirm `/papers/test` was prerendered (because `generateStaticParams` returned `["test"]`).

- [ ] **Step 5: Commit**

```bash
git add web/app/papers web/.env.example
git commit -m "feat: /papers/[id] route with branded layout

Adds public /papers/[id] route with its own thin branded layout
(Brandmark + 'Sign in' link). Page reads JSON from
web/content/papers/, runs fs.access on the notebook path before
emitting a Colab URL, and prerenders one route per fixture file via
generateStaticParams. NEXT_PUBLIC_GITHUB_REPO documented in .env.example."
```

---

## Task 5: Hand-test in browser

No code changes. This task verifies the user-visible behavior described in the spec's "Hand-test" section.

- [ ] **Step 1: Set the env var (operator only — local dev)**

In `web/.env.local` (create if missing — `.env.local` is gitignored), set:
```dotenv
NEXT_PUBLIC_GITHUB_REPO=mrojas54/wids-nyc-reading-group-assistant
```

(Use whatever owner/repo string you want. The notebook file doesn't exist, so the URL is built but never used — but the env var must be set or `colabUrl` is always null and you can't tell whether the fs.access branch is working.)

- [ ] **Step 2: Boot the dev server**

From `web/`:
```bash
npm run dev
```
Expected: `Ready on http://localhost:3000`.

- [ ] **Step 3: Open `/papers/test` in incognito**

Open an incognito/private window (so signed-out state is real). Visit `http://localhost:3000/papers/test`.

Verify visually, in this order:
- [ ] Brandmark in top-left of the header bar.
- [ ] "Sign in" text link in top-right (sage-700 color).
- [ ] Title "Attention Is All You Need (test fixture)" as h1.
- [ ] Author line "Vaswani et al."
- [ ] arXiv link visible.
- [ ] **No Colab button** (the notebook file `web/public/notebooks/9999.ipynb` does not exist; the fs.access branch should keep `colabUrl === null`).
- [ ] "In this companion." TOC block lists "Problem" and "Self-attention" with hover underline.
- [ ] "Vocabulary." block renders with 4 entries (Token, Embedding, Self-attention, Query / Key / Value), terms in sage-700, definitions in paper-700.
- [ ] Two sections render — each with summary, a sage-toned Mermaid diagram, and a code block on a paper-100 background.
- [ ] Footer: "Generated May 4, 2026. The paper itself is the source of truth."
- [ ] Browser console: no errors. (A hydration warning on the empty Mermaid div would be a real bug — flag it if you see it.)

- [ ] **Step 4: Test the TOC anchors**

Click "Problem" in the TOC. Page jumps to the "1. Problem" section. The heading should NOT be hidden under the sticky-feeling header (the `scroll-mt-24` guards this). Click "Self-attention" — same check.

- [ ] **Step 5: Test the 404 path**

Visit `http://localhost:3000/papers/does-not-exist`.
Expected: Next.js default 404 page (still inside the branded layout — header visible above the 404 content, since `notFound()` renders within the nearest layout).

- [ ] **Step 6: Test the "Sign in" link**

From `/papers/test`, click "Sign in". Browser navigates to `/`. The sign-in page should render normally.

- [ ] **Step 7: Verify the Colab button conditional (negative test confirmation)**

Open `web/app/papers/[id]/page.tsx` in your editor. Temporarily add `console.log({ repo, colabUrl })` after the if-block, save, refresh `/papers/test`, and check the dev server console:
- `repo` should be your env var value.
- `colabUrl` should be `null`.

Then **revert** the console.log change. (Do not commit it.)

- [ ] **Step 8: Verify the Colab button positive case**

Create an empty placeholder notebook so the fs.access succeeds:
```bash
mkdir -p web/public/notebooks
echo '{}' > web/public/notebooks/9999.ipynb
```
Refresh `/papers/test`. The "Open notebook in Colab ↗" button should now appear above the TOC, styled with `.btn .btn-primary`. Hover state should match the dashboard buttons.

Then **delete** the placeholder so we don't ship it:
```bash
rm web/public/notebooks/9999.ipynb
```
(Keep the directory if you want — it's empty and gitignored by `.gitkeep` convention or just absent.)

- [ ] **Step 9: Stop the dev server**

`Ctrl+C` in the terminal running `npm run dev`.

- [ ] **Step 10: Final build sanity-check**

```bash
npm run build
```
Expected: success. `/papers/test` listed as a prerendered route.

- [ ] **Step 11: Update phase progress memory**

Hand-test passed. Update the project memory at `~/.claude/projects/-Users-michellerojas-wids-nyc-reading-group-assistant/memory/project_phase_progress.md`:
- Mark Phase 6 as **done** with a short note (deviation: added TOC + Vocabulary blocks not in original plan; design-system tokens; conditional Colab button; branded /papers layout).

- [ ] **Step 12: No commit needed**

If Steps 1–10 pass with no edits, no commit happens in this task. The work was committed in Tasks 1–4.

If you found and fixed something during hand-test, commit it as a separate `fix:` commit referencing what broke.
