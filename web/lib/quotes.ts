// Rotating women-in-STEM quote selection (shared spec, TypeScript side).
// Mirrors scripts/quotes.py — keep in sync. The fnv1a vectors pin the algorithm.
import bundleData from "./quotes.generated.json";

export interface QuoteAuthor {
  id: string;
  name: string;
  role: string;
  birthdate?: string;
  deathdate?: string;
  fields?: string[];
  notable_contributions?: string;
  wikipediaUrl?: string;
}

export interface Quote {
  id: string;
  text: string;
  verified: boolean;
  year?: number | null;
  source?: string;
  sourceUrl?: string;
}

export interface QuoteBundle {
  version: number;
  authors: { author: QuoteAuthor; quotes: Quote[] }[];
}

export interface Selection {
  author: QuoteAuthor;
  quote: Quote;
}

// Drift is guarded: scripts/build_quotes.py validates the source data and emits
// this file, and tests/build_quotes_test.py::test_committed_bundle_is_in_sync
// asserts it stays in sync — so this structural cast is safe at the boundary.
const BUNDLE = bundleData as QuoteBundle;

const FALLBACK: Selection = {
  author: {
    id: "grace-hopper",
    name: "Grace Hopper",
    role: "Computer scientist · US Navy rear admiral",
  },
  quote: {
    id: "hopper-always-done",
    text: "The most dangerous phrase in the language is, 'we've always done it this way.'",
    verified: true,
  },
};

// 32-bit FNV-1a. Inputs are ASCII (digit date keys + salt), so this agrees
// byte-for-byte with the UTF-8-byte Python implementation in scripts/quotes.py.
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function eligiblePairs(bundle: QuoteBundle = BUNDLE): Selection[] {
  const pairs: Selection[] = [];
  for (const entry of bundle.authors) {
    for (const quote of entry.quotes) {
      if (quote.verified) pairs.push({ author: entry.author, quote });
    }
  }
  pairs.sort((a, b) => (a.quote.id < b.quote.id ? -1 : a.quote.id > b.quote.id ? 1 : 0));
  return pairs;
}

export function selectQuote(dateKey: number, salt = "", bundle: QuoteBundle = BUNDLE): Selection {
  const pairs = eligiblePairs(bundle);
  if (pairs.length === 0) return FALLBACK;
  return pairs[fnv1a(`${dateKey}${salt}`) % pairs.length];
}

// Whole days since the Unix epoch in UTC — the quote rotates at UTC midnight,
// not the viewer's local midnight.
export function dayKey(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 86_400_000);
}

export function getQuoteOfDay(now: Date = new Date()): Selection {
  return selectQuote(dayKey(now));
}
