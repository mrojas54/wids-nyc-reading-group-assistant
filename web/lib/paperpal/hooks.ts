"use client";

// PaperPal browser state uses server defaults during hydration, then restores
// the member's saved state without replacing the server-rendered DOM.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { HintFlags, SectionRef } from "./types";

const NS = "paperpal:v1:";

const globalKey = (key: string) => `${NS}${key}`;
const paperKey = (paperId: string, key: string) => `${NS}${paperId}:${key}`;

const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function useHydrated(): boolean {
  return useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot);
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private-mode — silently ignore */
  }
}

export function useLocalState<T>(
  fullKey: string,
  initial: T | (() => T),
): [T, (v: T | ((prev: T) => T)) => void] {
  const hydrated = useHydrated();
  const [initialValue] = useState<T>(initial);
  const [value, setValue] = useState<T>(() => readJSON<T>(fullKey, initialValue));

  useEffect(() => {
    if (hydrated) writeJSON(fullKey, value);
  }, [fullKey, value, hydrated]);

  return [hydrated ? value : initialValue, setValue];
}

export function useGlobalLocalState<T>(
  key: string,
  initial: T | (() => T),
): [T, (v: T | ((prev: T) => T)) => void] {
  return useLocalState<T>(globalKey(key), initial);
}

export function usePaperLocalState<T>(
  paperId: string,
  key: string,
  initial: T | (() => T),
): [T, (v: T | ((prev: T) => T)) => void] {
  return useLocalState<T>(paperKey(paperId, key), initial);
}

// ---------- Hint flags ----------

const hintFlagsKey = (paperId: string) => paperKey(paperId, "hintFlags");
const HINT_EVENT = "paperpal:hint-flags-changed";
const EMPTY_HINT_FLAGS: HintFlags = {};

function readHintFlags(paperId: string): HintFlags {
  return readJSON<HintFlags>(hintFlagsKey(paperId), {});
}

export function recordHint(
  paperId: string,
  sectionRef: SectionRef | undefined,
  source = "assessment",
): void {
  if (!sectionRef || typeof window === "undefined") return;
  const flags = readHintFlags(paperId);
  const existing = flags[sectionRef] ?? { count: 0, sources: [] };
  existing.count += 1;
  if (!existing.sources.includes(source)) existing.sources.push(source);
  flags[sectionRef] = existing;
  writeJSON(hintFlagsKey(paperId), flags);
  window.dispatchEvent(new CustomEvent(HINT_EVENT, { detail: { paperId } }));
}

export function clearHintFlags(paperId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(hintFlagsKey(paperId));
    window.dispatchEvent(new CustomEvent(HINT_EVENT, { detail: { paperId } }));
  } catch {
    /* ignore */
  }
}

export function useHintFlags(paperId: string): HintFlags {
  const hydrated = useHydrated();
  const [flags, setFlags] = useState<HintFlags>(() => readHintFlags(paperId));

  // Re-read when the paper changes, during render rather than in an effect.
  const [trackedPaper, setTrackedPaper] = useState(paperId);
  if (paperId !== trackedPaper) {
    setTrackedPaper(paperId);
    setFlags(readHintFlags(paperId));
  }

  const refresh = useCallback(() => {
    setFlags(readHintFlags(paperId));
  }, [paperId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener(HINT_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(HINT_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  return hydrated ? flags : EMPTY_HINT_FLAGS;
}
