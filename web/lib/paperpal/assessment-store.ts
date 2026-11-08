"use client";

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

type Entry<S, A> = { id: string; clock: number; action: A; base?: S };
const CHANGE = "paperpal:assessment-changed";

export function readSaved<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}

// Each action has its own key. Concurrent tabs never replace each other's writes.
// The first action captures v1 state; later reads replay actions from that baseline.
export function useAssessmentStore<S, A>(
  key: string,
  initial: S,
  legacy: () => S,
  reduce: (state: S, action: A) => S,
  mirror: (state: S) => void,
): [S, (action: A) => S] {
  const prefix = `paperpal:v2:${encodeURIComponent(key)}:`;
  const volatile = useRef<{ key: string; state: S } | null>(null);
  const read = () => {
    // Read legacy state before enumerating actions, so a concurrent first writer
    // cannot make a new baseline out of its already-mirrored result.
    const baseline = legacy();
    const entries: Entry<S, A>[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const name = localStorage.key(i);
        if (!name?.startsWith(prefix)) continue;
        try {
          const entry = JSON.parse(localStorage.getItem(name)!) as Entry<S, A>;
          if (typeof entry.id === "string" && Number.isFinite(entry.clock) && entry.action) entries.push(entry);
        } catch { /* Ignore an incomplete or invalid record. */ }
      }
    } catch { /* Storage can be unavailable in private browsing. */ }
    entries.sort((a, b) => a.clock - b.clock || a.id.localeCompare(b.id));
    const base = entries.find(e => e.base !== undefined)?.base ?? baseline;
    return { entries, state: entries.reduce((state, e) => reduce(state, e.action), base) };
  };
  const getSnapshot = () => JSON.stringify(volatile.current?.key === key ? volatile.current.state : read().state);
  const subscribe = useCallback((notify: () => void) => {
    const changed = () => notify();
    window.addEventListener("storage", changed);
    window.addEventListener(CHANGE, changed);
    return () => { window.removeEventListener("storage", changed); window.removeEventListener(CHANGE, changed); };
  }, []);
  const serialized = useSyncExternalStore(subscribe, getSnapshot, () => JSON.stringify(initial));
  const state = useMemo(() => JSON.parse(serialized) as S, [serialized]);
  const dispatch = (action: A) => {
    const current = read();
    const before = volatile.current?.key === key ? volatile.current.state : current.state;
    const next = reduce(before, action);
    if (next === before) return before;
    const entry: Entry<S, A> = {
      id: crypto.randomUUID(), clock: (current.entries.at(-1)?.clock ?? 0) + 1, action,
      ...(current.entries.length ? {} : { base: before }),
    };
    let result = next;
    try {
      localStorage.setItem(prefix + entry.id, JSON.stringify(entry));
      result = read().state;
      volatile.current = null;
    } catch { volatile.current = { key, state: next }; }
    // v1 snapshots remain readable by existing progress consumers. The action
    // records, not these compatibility snapshots, are authoritative after migration.
    try { mirror(result); } catch { /* Keep the current page usable without storage. */ }
    window.dispatchEvent(new Event(CHANGE));
    return result;
  };
  return [state, dispatch];
}
