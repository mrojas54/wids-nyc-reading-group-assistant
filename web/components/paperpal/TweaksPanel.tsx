"use client";

// Floating Tweaks panel — bottom-right, hidden behind a small handle.
// Persists settings to `useGlobalLocalState("tweaks", DEFAULT_TWEAKS)`.
// Ported from design_handoff/design/tweaks-panel.jsx.
import { useCallback } from "react";
import { useGlobalLocalState } from "@/lib/paperpal/hooks";
import type { Lens } from "@/lib/paperpal/types";

export type AssessmentMode = "mcq" | "socratic";

export type Tweaks = {
  mode: AssessmentMode;
  lens: Lens;
  layers: {
    groupHighlights: boolean;
    marginNotes: boolean;
    explainSelection: boolean;
  };
  tiles: {
    citedPapers: boolean;
    mastery: boolean;
    diff: boolean;
  };
  surfaces: {
    presenter: boolean;
    review: boolean;
    reproduce: boolean;
    compare: boolean;
  };
  panelOpen: boolean;
};

export const DEFAULT_TWEAKS: Tweaks = {
  mode: "mcq",
  lens: "engineer",
  layers: {
    groupHighlights: true,
    marginNotes: true,
    explainSelection: true,
  },
  tiles: {
    citedPapers: true,
    mastery: true,
    diff: false,
  },
  surfaces: {
    presenter: true,
    review: false,
    reproduce: false,
    compare: false,
  },
  panelOpen: false,
};

const TWEAKS_KEY = "tweaks";

type Setter = (next: Tweaks | ((prev: Tweaks) => Tweaks)) => void;

export function useTweaks(): [Tweaks, Setter] {
  return useGlobalLocalState<Tweaks>(TWEAKS_KEY, DEFAULT_TWEAKS);
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="twk-section">
      <div className="twk-sect">{label}</div>
      <div className="twk-rows">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="twk-row twk-row-h">
      <span className="twk-lbl-text">{label}</span>
      <button
        type="button"
        className="twk-toggle"
        data-on={value ? "1" : "0"}
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
      >
        <i />
      </button>
    </div>
  );
}

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="twk-row">
      <div className="twk-lbl-text">{label}</div>
      <div className="twk-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? "is-on" : ""}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function TweaksPanel() {
  const [tweaks, setTweaks] = useTweaks();

  const patch = useCallback(
    <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
      setTweaks((prev) => ({ ...prev, [key]: value }));
    },
    [setTweaks],
  );

  const patchNested = useCallback(
    <K extends "layers" | "tiles" | "surfaces">(
      key: K,
      sub: keyof Tweaks[K],
      value: boolean,
    ) => {
      setTweaks((prev) => ({
        ...prev,
        [key]: { ...prev[key], [sub]: value },
      }));
    },
    [setTweaks],
  );

  const toggleOpen = () => patch("panelOpen", !tweaks.panelOpen);

  return (
    <>
      <button
        type="button"
        className="twk-handle"
        aria-label={tweaks.panelOpen ? "Close tweaks" : "Open tweaks"}
        aria-expanded={tweaks.panelOpen}
        onClick={toggleOpen}
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 60,
          width: 36,
          height: 36,
          borderRadius: 999,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-2)",
          color: "var(--fg-2)",
          boxShadow: "var(--shadow-md)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        Tk
      </button>

      {tweaks.panelOpen && (
        <div
          className="twk-panel"
          role="dialog"
          aria-label="Tweaks"
          style={{
            position: "fixed",
            right: 16,
            bottom: 64,
            zIndex: 60,
            width: 300,
            maxHeight: "calc(100vh - 96px)",
            background: "rgba(250,249,247,0.92)",
            color: "var(--fg-1)",
            border: "1px solid var(--border-2)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            backdropFilter: "blur(20px) saturate(160%)",
            WebkitBackdropFilter: "blur(20px) saturate(160%)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            className="twk-hd"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 8px 10px 14px",
              borderBottom: "1px solid var(--border-1)",
            }}
          >
            <b style={{ fontSize: 12, letterSpacing: "0.01em" }}>Tweaks</b>
            <button
              type="button"
              className="twk-x"
              aria-label="Close tweaks"
              onClick={() => patch("panelOpen", false)}
              style={{
                border: 0,
                background: "transparent",
                color: "var(--fg-3)",
                width: 24,
                height: 24,
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>

          <div
            className="twk-body"
            style={{
              padding: "10px 14px 14px",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              fontSize: 12,
            }}
          >
            <Section label="Mode">
              <Seg
                label="Assessment"
                value={tweaks.mode}
                options={[
                  { value: "mcq", label: "MCQ" },
                  { value: "socratic", label: "Socratic" },
                ]}
                onChange={(v) => patch("mode", v)}
              />
            </Section>

            <Section label="Lens">
              <Seg
                label="Difficulty"
                value={tweaks.lens}
                options={[
                  { value: "beginner", label: "Beginner" },
                  { value: "engineer", label: "Engineer" },
                  { value: "expert", label: "Expert" },
                ]}
                onChange={(v) => patch("lens", v)}
              />
            </Section>

            <Section label="Reading layers">
              <Toggle
                label="Group highlights"
                value={tweaks.layers.groupHighlights}
                onChange={(v) => patchNested("layers", "groupHighlights", v)}
              />
              <Toggle
                label="Margin notes"
                value={tweaks.layers.marginNotes}
                onChange={(v) => patchNested("layers", "marginNotes", v)}
              />
              <Toggle
                label="Explain selection"
                value={tweaks.layers.explainSelection}
                onChange={(v) => patchNested("layers", "explainSelection", v)}
              />
            </Section>

            <Section label="Extra tiles">
              <Toggle
                label="Cited papers"
                value={tweaks.tiles.citedPapers}
                onChange={(v) => patchNested("tiles", "citedPapers", v)}
              />
              <Toggle
                label="Concept mastery"
                value={tweaks.tiles.mastery}
                onChange={(v) => patchNested("tiles", "mastery", v)}
              />
              <Toggle
                label="Diff vs follow-up"
                value={tweaks.tiles.diff}
                onChange={(v) => patchNested("tiles", "diff", v)}
              />
            </Section>

            <Section label="New surfaces">
              <Toggle
                label="Presenter"
                value={tweaks.surfaces.presenter}
                onChange={(v) => patchNested("surfaces", "presenter", v)}
              />
              <Toggle
                label="Review (SR)"
                value={tweaks.surfaces.review}
                onChange={(v) => patchNested("surfaces", "review", v)}
              />
              <Toggle
                label="Reproduce diagram"
                value={tweaks.surfaces.reproduce}
                onChange={(v) => patchNested("surfaces", "reproduce", v)}
              />
              <Toggle
                label="Compare PDF"
                value={tweaks.surfaces.compare}
                onChange={(v) => patchNested("surfaces", "compare", v)}
              />
            </Section>
          </div>
        </div>
      )}

      <style jsx>{`
        .twk-section {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .twk-sect {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--fg-3);
        }
        .twk-rows {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .twk-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .twk-row.twk-row-h {
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
        }
        .twk-lbl-text {
          color: var(--fg-2);
          font-weight: 500;
        }
        .twk-seg {
          display: flex;
          padding: 2px;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.06);
        }
        .twk-seg button {
          flex: 1;
          appearance: none;
          border: 0;
          background: transparent;
          font: inherit;
          font-weight: 500;
          color: var(--fg-2);
          padding: 5px 8px;
          border-radius: 6px;
          cursor: pointer;
        }
        .twk-seg button.is-on {
          background: var(--bg-surface);
          color: var(--fg-1);
          box-shadow: var(--shadow-xs);
        }
        .twk-toggle {
          position: relative;
          width: 32px;
          height: 18px;
          border: 0;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.18);
          padding: 0;
          cursor: pointer;
          transition: background 150ms;
        }
        .twk-toggle[data-on="1"] {
          background: var(--brand-primary);
        }
        .twk-toggle i {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
          transition: transform 150ms;
        }
        .twk-toggle[data-on="1"] i {
          transform: translateX(14px);
        }
      `}</style>
    </>
  );
}
