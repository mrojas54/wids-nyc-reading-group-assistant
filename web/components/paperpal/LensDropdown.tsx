"use client";

// Topbar difficulty-lens dropdown.
// Reads/writes tweaks.lens via the same useGlobalLocalState key as TweaksPanel.
// Ported from design_handoff/design/app.jsx · LensDropdown.
import { useEffect, useRef, useState } from "react";
import type { Lens } from "@/lib/paperpal/types";
import { useTweaks, DEFAULT_TWEAKS } from "./TweaksPanel";

type Option = { value: Lens; label: string; sub: string };

const OPTIONS: Option[] = [
  { value: "beginner", label: "Beginner", sub: "Conceptual intuition" },
  { value: "engineer", label: "Engineer", sub: "Implementation logic" },
  { value: "expert", label: "Expert", sub: "Theory & nuance" },
];

export default function LensDropdown() {
  const [tweaks, setTweaks] = useTweaks();
  const lens: Lens = tweaks?.lens ?? DEFAULT_TWEAKS.lens;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.value === lens) ?? OPTIONS[1];

  const pick = (v: Lens) => {
    setTweaks((prev) => ({ ...prev, lens: v }));
    setOpen(false);
  };

  return (
    <div className="lens-dd" ref={ref}>
      <button
        type="button"
        className={`lens-dd-trigger${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Difficulty lens: ${current.label}. Click to change.`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lens-dd-eyebrow">Lens</span>
        <span className="lens-dd-value">{current.label}</span>
        <span className={`lens-dd-chev${open ? " is-open" : ""}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="lens-dd-menu" role="listbox" aria-label="Difficulty lens">
          {OPTIONS.map((o, i) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === lens}
              className={`lens-dd-item${o.value === lens ? " is-active" : ""}`}
              onClick={() => pick(o.value)}
            >
              <span className="lens-dd-num">0{i + 1}</span>
              <span className="lens-dd-label">{o.label}</span>
              <span className="lens-dd-sub">→ {o.sub}</span>
              {o.value === lens && <span className="lens-dd-check">✓</span>}
            </button>
          ))}
          <div className="lens-dd-foot">
            Changes the quiz set, hint budget, and copy lens.
          </div>
        </div>
      )}
      <style jsx>{`
        .lens-dd {
          position: relative;
          display: inline-block;
        }
        .lens-dd-trigger {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          border: 1px solid var(--border-2);
          border-radius: var(--radius-md);
          background: var(--bg-surface);
          color: var(--fg-1);
          font-family: inherit;
          cursor: pointer;
          transition: background 150ms, border-color 150ms;
        }
        .lens-dd-trigger:hover,
        .lens-dd-trigger.is-open {
          background: var(--bg-surface-sage);
          border-color: var(--color-sage-300);
        }
        .lens-dd-eyebrow {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--fg-3);
        }
        .lens-dd-value {
          font-size: 13px;
          font-weight: 500;
        }
        .lens-dd-chev {
          font-size: 10px;
          color: var(--fg-3);
          transition: transform 150ms;
        }
        .lens-dd-chev.is-open {
          transform: rotate(180deg);
        }
        .lens-dd-menu {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          min-width: 280px;
          background: var(--bg-surface);
          border: 1px solid var(--border-2);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-lg);
          padding: 4px;
          z-index: 40;
        }
        .lens-dd-item {
          display: grid;
          grid-template-columns: 28px 1fr auto auto;
          gap: 8px;
          align-items: center;
          padding: 8px 10px;
          border: 0;
          background: transparent;
          width: 100%;
          text-align: left;
          font: inherit;
          color: var(--fg-1);
          border-radius: var(--radius-sm);
          cursor: pointer;
        }
        .lens-dd-item:hover {
          background: var(--bg-surface-sage);
        }
        .lens-dd-item.is-active {
          background: var(--color-sage-50);
        }
        .lens-dd-num {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--fg-3);
        }
        .lens-dd-label {
          font-weight: 500;
        }
        .lens-dd-sub {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--fg-3);
        }
        .lens-dd-check {
          color: var(--brand-primary);
          font-weight: 700;
        }
        .lens-dd-foot {
          padding: 8px 10px;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--fg-3);
          border-top: 1px solid var(--border-1);
          margin-top: 4px;
        }
      `}</style>
    </div>
  );
}
