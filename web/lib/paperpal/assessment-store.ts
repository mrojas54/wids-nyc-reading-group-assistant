"use client";

import { useMemo, useSyncExternalStore } from "react";
import { z } from "zod";

const CHANGE = "paperpal:assessment-changed";
const COMPACT_AFTER = 64;
const COMPACT_BYTES = 64 * 1024;
export const ASSESSMENT_STORAGE_VERSION = "v3";

export function readSaved<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}

export function useAssessmentStore<S, A>(
  key: string,
  initial: S,
  legacy: () => S,
  reduce: (state: S, action: A) => S,
  mirror: (state: S) => void,
  schemas: { state: z.ZodType<S>; action: z.ZodType<A> },
): [S, (action: A) => S] {
  const store = useMemo(() => {
    const prefix = `paperpal:${ASSESSMENT_STORAGE_VERSION}:${encodeURIComponent(key)}:`;
    const checkpointKey = prefix + "checkpoint";
    const entrySchema = z.object({
      id: z.string(), clock: z.number().int().nonnegative(),
      action: schemas.action, base: schemas.state.optional(),
    });
    const checkpointSchema = z.object({
      revision: z.string(), clock: z.number().int().nonnegative(),
      state: schemas.state, covered: z.array(z.string()),
    });
    type Entry = z.infer<typeof entrySchema>;
    let cached: string | undefined;
    let lastState = initial;
    const pending: Entry[] = [];
    let compacting = false;

    const read = () => {
      for (;;) {
        const baseline = schemas.state.safeParse(legacy());
        const rawCheckpoint = localStorage.getItem(checkpointKey);
        const parsed = checkpointSchema.safeParse(readSaved(checkpointKey, null));
        const checkpoint = parsed.success ? parsed.data : undefined;
        const covered = new Set(checkpoint?.covered);
        const records: string[] = [];
        const entries: Entry[] = [];
        let bytes = 0;
        for (let i = 0; i < localStorage.length; i++) {
          const name = localStorage.key(i);
          if (!name?.startsWith(prefix) || name === checkpointKey) continue;
          records.push(name);
          const raw = localStorage.getItem(name);
          bytes += (raw?.length ?? 0) * 2;
          if (covered.has(name)) continue;
          const result = entrySchema.safeParse(readSaved(name, null));
          if (result.success && name === prefix + result.data.id) entries.push(result.data);
        }
        // Retry if compaction published while we enumerated its deleted actions.
        if (rawCheckpoint !== localStorage.getItem(checkpointKey)) continue;
        entries.sort((a, b) => a.clock - b.clock || a.id.localeCompare(b.id));
        let state = checkpoint?.state ?? entries.find(e => e.base !== undefined)?.base
          ?? (baseline.success ? baseline.data : initial);
        for (const entry of entries) {
          try { state = reduce(state, entry.action); }
          catch { /* An obsolete action cannot break the page. */ }
        }
        return { state, records, bytes, entries,
          clock: Math.max(checkpoint?.clock ?? 0, entries.at(-1)?.clock ?? 0) };
      }
    };
    const readCurrent = () => {
      const current = read();
      const savedIds = new Set(current.entries.map(entry => entry.id));
      for (const entry of pending) {
        if (!savedIds.has(entry.id)) current.state = reduce(current.state, entry.action);
      }
      return current;
    };
    const notify = () => window.dispatchEvent(new CustomEvent(CHANGE, { detail: key }));
    const compact = () => {
      // Compactors need cross-tab exclusion; writers use unique keys.
      if (compacting || !navigator.locks) return;
      compacting = true;
      void navigator.locks.request(prefix, () => {
        const current = read();
        if (current.records.length < COMPACT_AFTER && current.bytes < COMPACT_BYTES) return;
        localStorage.setItem(checkpointKey, JSON.stringify({
          revision: crypto.randomUUID(), clock: current.clock,
          state: current.state, covered: current.records,
        }));
        // Publish before deleting, and remove only records included in this
        // checkpoint. A concurrent writer's new key survives regardless of clock.
        for (const name of current.records) localStorage.removeItem(name);
        cached = undefined;
        notify();
      }).catch(() => {
        // Quota/private-mode errors leave the existing journal readable.
      }).finally(() => { compacting = false; });
    };
    return {
      getSnapshot: () => {
        if (cached === undefined) {
          try { lastState = readCurrent().state; }
          catch { /* Retain current-page state when storage is unavailable. */ }
          cached = JSON.stringify(lastState);
        }
        return cached;
      },
      subscribe: (onChange: () => void) => {
        const changed = (event: Event) => {
          if (event instanceof StorageEvent && event.key && !event.key.startsWith(prefix)) return;
          if (event instanceof CustomEvent && event.detail !== key) return;
          cached = undefined;
          onChange();
        };
        window.addEventListener("storage", changed);
        window.addEventListener(CHANGE, changed);
        return () => {
          window.removeEventListener("storage", changed);
          window.removeEventListener(CHANGE, changed);
        };
      },
      dispatch: (action: A) => {
        let current;
        try { current = readCurrent(); }
        catch { current = { state: lastState, clock: 0 }; }
        const validAction = schemas.action.parse(action);
        const next = reduce(current.state, validAction);
        if (next === current.state) return current.state;
        const entry: Entry = {
          id: crypto.randomUUID(), clock: current.clock + pending.length + 1,
          action: validAction, base: current.state,
        };
        try {
          if (localStorage.getItem(checkpointKey) || read().entries.length) delete entry.base;
        } catch { /* Keep a baseline while storage is unavailable. */ }
        pending.push(entry);
        let result = next;
        try {
          while (pending.length) {
            const first = pending[0];
            localStorage.setItem(prefix + first.id, JSON.stringify(first));
            pending.shift();
          }
          result = read().state;
        } catch { /* Retry unsaved actions on the next interaction. */ }
        cached = JSON.stringify(result);
        lastState = result;
        // v1 snapshots support rollback to the old components. Re-landing after
        // rollback writes requires a new storage version/import.
        try { mirror(result); } catch { /* Storage may be full or unavailable. */ }
        notify();
        compact();
        return result;
      },
    };
    // The key has fixed migration/reducer functions. Inline callbacks must not
    // discard the cache on every composer keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const serialized = useSyncExternalStore(store.subscribe, store.getSnapshot, () => JSON.stringify(initial));
  const state = useMemo(() => JSON.parse(serialized) as S, [serialized]);
  return [state, store.dispatch];
}
