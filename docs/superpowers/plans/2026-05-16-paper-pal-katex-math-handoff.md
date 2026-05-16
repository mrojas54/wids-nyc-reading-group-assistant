# Handoff — KaTeX math rendering

**Status:** Stub. Today `SectionBreakdownTile.tsx` renders `mathExplanation.formula` and `stepByStep[i]` as monospace `<code>` (TODO note inline). After: proper math via KaTeX.

---

## Scope

1. Install `katex` + `react-markdown` + `remark-math` + `rehype-katex`. Add KaTeX's CSS to globals.
2. New `<Math>` component that renders a LaTeX string inline or block. SSR-friendly.
3. Replace the `<code>` formulas in `SectionBreakdownTile.tsx` with `<Math>`.
4. Also use `<Math>` inside `<Highlighted>` when a math variable is annotated with a LaTeX form.

Nothing else. Don't refactor markdown rendering — Paper Pal text is plain prose with the optional inline term/var highlights already handled by `<Highlighted>`. KaTeX is just for formulas.

---

## Install

```sh
cd web
npm i katex react-markdown remark-math rehype-katex
```

`tailwind.config.ts` doesn't need changes — KaTeX brings its own CSS.

---

## Wire CSS

In `web/app/globals.css`, after the `@font-face` block but before the existing tokens:

```css
@import "katex/dist/katex.min.css";
```

Or, if the build doesn't follow `@import` from inside `globals.css`, add a top-level import in `web/app/layout.tsx`:

```ts
import "katex/dist/katex.min.css";
```

Both work; pick whichever matches the existing pattern.

---

## `<Math>` component

```tsx
// web/components/paperpal/Math.tsx
"use client";
import katex from "katex";
import { useMemo } from "react";

export function Math({ tex, block = false }: { tex: string; block?: boolean }) {
  const html = useMemo(
    () =>
      katex.renderToString(tex, {
        displayMode: block,
        throwOnError: false,         // bad LaTeX renders as red text, doesn't crash
        strict: "ignore",
        output: "html",              // mathml output bumps DOM size and isn't worth it here
      }),
    [tex, block],
  );
  return (
    <span
      className={block ? "pp-math-block" : "pp-math-inline"}
      // KaTeX-generated markup is trusted (we control the input).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

Two CSS rules in `paperpal.css`:

```css
.pp-math-block { display: block; margin: var(--space-2) 0; overflow-x: auto; }
.pp-math-inline { display: inline; }
```

---

## Replace the monospace formula

In `SectionBreakdownTile.tsx`, find the spot tagged `KaTeX TODO` and swap:

```tsx
// before
<code className="pp-math-code">{math.formula}</code>

// after
<Math tex={math.formula} block />
```

Same for `math.stepByStep[i]` in the derivation expander.

---

## SSR note

`katex.renderToString` is pure-JS, no DOM access — safe in server components. The `"use client"` directive above is precautionary because `useMemo` is a hook; you can drop it and make `<Math>` a server component if you'd rather skip the client boundary.

---

## Test plan

- [ ] A paper with `mathExplanations` containing `e = mc^2` and a multi-line `\frac{\partial L}{\partial w}` derivation renders both correctly.
- [ ] Malformed LaTeX (`\foo bar`) renders in red without breaking the page.
- [ ] KaTeX bundle size impact ≤ 80 KB gzipped on the `/papers/[id]` route (check `next build` output).
- [ ] Mobile width: long equations scroll horizontally inside the tile, don't break the bento grid.

---

## Risks

- **Bundle weight.** KaTeX is ~30 KB JS + 25 KB CSS gzipped. Acceptable for a research-paper app; flag it if Lighthouse complains.
- **Math source quality.** Gemini occasionally emits LaTeX with markdown wrappers (`$$...$$`). Strip leading/trailing `$` in `<Math>` before passing to KaTeX.
- **Fonts.** KaTeX self-hosts its WOFF2 fonts via the CSS import. Make sure `next.config.mjs` doesn't block the `katex/fonts/*.woff2` requests (it shouldn't by default).
