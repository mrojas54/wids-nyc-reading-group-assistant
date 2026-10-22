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

/**
 * `value` when it is safe as an `href`, else `null`: either an absolute
 * http(s) URL or a site-relative path such as `/papers/2`.
 *
 * `papers.companion_url` holds either form — the legacy filesystem-backed
 * companions are stored as `/papers/<id>`. `//host/…` and `/\host/…` are
 * refused: both read as protocol-relative, so neither is the same-origin path
 * it looks like.
 */
export function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\/[/\\]/.test(value)) return null;
  if (value.startsWith("/")) return value;
  return externalHttpUrl(value);
}
