import { describe, it, expect, beforeEach } from "vitest";
import type { HintFlags } from "../types";

// Minimal browser shim so the module under test can touch `window` /
// `localStorage` / `dispatchEvent` without pulling in jsdom. Keeps the
// vitest env at the project's default ("node") and the test suite fast.
// `typeof window` inside hooks.ts is evaluated at call time, so installing
// the shim before the test bodies run is sufficient.
type Listener = (e: { type: string; detail?: unknown }) => void;
const listeners = new Map<string, Set<Listener>>();
const store = new Map<string, string>();

(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  },
  addEventListener: (type: string, fn: Listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: Listener) => {
    listeners.get(type)?.delete(fn);
  },
  dispatchEvent: (e: { type: string; detail?: unknown }) => {
    listeners.get(e.type)?.forEach((fn) => fn(e));
    return true;
  },
};
(globalThis as any).CustomEvent = class {
  type: string;
  detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
};

// eslint-disable-next-line import/first
import { recordHint, clearHintFlags } from "../hooks";

const PAPER = "42";

function rawFlags(paperId: string): HintFlags {
  const raw = store.get(`paperpal:v1:${paperId}:hintFlags`);
  return raw ? JSON.parse(raw) : {};
}

beforeEach(() => {
  store.clear();
});

describe("recordHint / clearHintFlags", () => {
  it("namespaces under paperpal:v1:<paperId>:hintFlags", () => {
    recordHint(PAPER, "method");
    expect(rawFlags(PAPER)).toEqual({
      method: { count: 1, sources: ["assessment"] },
    });
  });

  it("increments count when called repeatedly on the same section", () => {
    recordHint(PAPER, "method");
    recordHint(PAPER, "method");
    recordHint(PAPER, "method");
    expect(rawFlags(PAPER).method?.count).toBe(3);
  });

  it("tracks distinct sources without duplicating them", () => {
    recordHint(PAPER, "math", "assessment");
    recordHint(PAPER, "math", "assessment");
    recordHint(PAPER, "math", "socratic");
    expect(rawFlags(PAPER).math?.sources.sort()).toEqual([
      "assessment",
      "socratic",
    ]);
    expect(rawFlags(PAPER).math?.count).toBe(3);
  });

  it("does nothing when sectionRef is undefined", () => {
    recordHint(PAPER, undefined);
    expect(rawFlags(PAPER)).toEqual({});
  });

  it("scopes hints by paper id", () => {
    recordHint("1", "method");
    recordHint("2", "math");
    expect(rawFlags("1").method?.count).toBe(1);
    expect(rawFlags("1").math).toBeUndefined();
    expect(rawFlags("2").math?.count).toBe(1);
    expect(rawFlags("2").method).toBeUndefined();
  });

  it("clearHintFlags removes the entry for that paper only", () => {
    recordHint("1", "method");
    recordHint("2", "math");
    clearHintFlags("1");
    expect(rawFlags("1")).toEqual({});
    expect(rawFlags("2").math?.count).toBe(1);
  });

  it("dispatches paperpal:hint-flags-changed so listeners can refresh", () => {
    let fired = 0;
    const handler = () => {
      fired += 1;
    };
    (globalThis as any).window.addEventListener(
      "paperpal:hint-flags-changed",
      handler,
    );
    try {
      recordHint(PAPER, "method");
      recordHint(PAPER, "math");
      clearHintFlags(PAPER);
      expect(fired).toBe(3);
    } finally {
      (globalThis as any).window.removeEventListener(
        "paperpal:hint-flags-changed",
        handler,
      );
    }
  });
});
