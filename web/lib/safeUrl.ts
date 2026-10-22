/**
 * Scheme checks for URLs that reach the browser out of the database.
 *
 * `papers.url`, `papers.pdf_drive_url`, `papers.companion_url` and the
 * `learningResources[].url` entries inside a `paper_companions` payload are all
 * operator- or model-supplied strings that get rendered straight into an
 * `href`. A row holding `javascript:…` or `data:text/html,…` is therefore
 * stored XSS against whoever opens the page — and on the operator-only
 * `/admin/schedule` rail, against the account most worth stealing.
 *
 * Every render site runs the stored value through here before it becomes an
 * `href`, and the write paths (`web/lib/suggest/resolve-helpers.ts`,
 * `web/lib/paperpal/providers/schema.ts`, `scripts/paper_urls.py`, plus the
 * `papers_*_scheme` CHECK constraints from migration 037) refuse the same
 * schemes so a bad value never lands in the first place.
 *
 * The checks parse with `new URL`, which strips the leading whitespace and the
 * embedded tabs and newlines that an `href` parser also strips — so a value
 * accepted here cannot mean something else to the browser.
 */

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * `value` when it parses as an absolute `http:`/`https:` URL, else `null`.
 * Use it for anything that leaves the site: paper links, Drive PDFs, Colab
 * notebooks, model-suggested reading.
 */
export function externalHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return HTTP_PROTOCOLS.has(parsed.protocol) ? value : null;
}

/** Whether `value` is an absolute `http:`/`https:` URL. */
export function isExternalHttpUrl(value: string | null | undefined): boolean {
  return externalHttpUrl(value) !== null;
}

// Resolving a relative path needs a base. Any origin does — what matters is
// only whether resolution stays on it — and `.invalid` can never be real.
const RELATIVE_BASE = "https://placeholder.invalid";

/** The normalized path of `value` when it resolves on-origin, else `null`. */
function sameOriginPath(value: string): string | null {
  let resolved: URL;
  try {
    resolved = new URL(value, RELATIVE_BASE);
  } catch {
    return null;
  }
  if (resolved.origin !== RELATIVE_BASE) return null;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

/**
 * A safe `href` for `value`, else `null`: the value itself when it is an
 * absolute http(s) URL, or the normalized path when it is site-relative, as
 * `papers.companion_url` stores the legacy filesystem-backed companions
 * (`/papers/<id>`).
 *
 * Anything that resolves off the current origin is refused. Checking the
 * leading characters is not enough: `//host/…` and `/\host/…` are the obvious
 * protocol-relative forms, but `/<tab>/host/…` is one too — an `href` parser
 * strips the tab and lands on `//host/…`. Resolving against a base and
 * comparing origins asks the parser the question directly, so no amount of
 * stripped whitespace turns an accepted value into an off-origin one.
 *
 * The check runs twice, because normalizing can manufacture the very form it
 * was asked about: `/.//host/…` and `/a/../..//host/…` both resolve on-origin,
 * yet their normalized paths are `//host/…`, which is protocol-relative all
 * over again. So the string that actually ships is checked the same way the
 * input was. A second pass would be redundant — normalization is idempotent
 * from here.
 */
export function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  if (externalHttpUrl(value)) return value;
  if (!value.startsWith("/")) return null;
  const path = sameOriginPath(value);
  if (path === null || sameOriginPath(path) !== path) return null;
  return path;
}
