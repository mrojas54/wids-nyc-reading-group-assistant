"use client";

// Full-screen presenter view for the discussion lead.
// Keyboard: ← / → navigate, F fullscreen, T reset, O/G overview, Esc exit.
// Q&A per discussion slide is persisted via usePaperLocalState.
// Ported from design_handoff/design/ideas-screens.jsx · PresenterScreen.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePaperLocalState } from "@/lib/paperpal/hooks";
import type { Slide } from "@/lib/paperpal/presenter";
import "./presenter.css";

type QaMap = Record<string, string>;

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export type PresenterScreenProps = {
  paperId: string;
  slides: Slide[];
  paperTitle?: string;
  onExit?: () => void;
};

export default function PresenterScreen({
  paperId,
  slides,
  paperTitle,
  onExit,
}: PresenterScreenProps) {
  const router = useRouter();

  const [i, setI] = usePaperLocalState<number>(paperId, "presenter:idx", 0);
  const [qaNotes, setQaNotes] = usePaperLocalState<QaMap>(
    paperId,
    "presenter:qa",
    {},
  );

  const [overviewOpen, setOverviewOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [paused, setPaused] = useState(false);

  const [totalStart, setTotalStart] = useState<number>(() => Date.now());
  const [slideStart, setSlideStart] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  const iRef = useRef(i);
  iRef.current = i;

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [paused]);

  useEffect(() => {
    setSlideStart(Date.now());
  }, [i]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const goTo = useCallback(
    (n: number) => {
      const clamped = Math.max(0, Math.min(slides.length - 1, n));
      setI(clamped);
    },
    [slides.length, setI],
  );
  const next = useCallback(() => goTo(iRef.current + 1), [goTo]);
  const prev = useCallback(() => goTo(iRef.current - 1), [goTo]);

  const exit = useCallback(() => {
    if (onExit) onExit();
    else router.back();
  }, [onExit, router]);

  const resetTimers = useCallback(() => {
    setTotalStart(Date.now());
    setSlideStart(Date.now());
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLInputElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        prev();
      } else if (k === "f") {
        toggleFullscreen();
      } else if (k === "t") {
        resetTimers();
      } else if (k === "o" || k === "g") {
        setOverviewOpen((v) => !v);
      } else if (e.key === "Escape") {
        if (overviewOpen) setOverviewOpen(false);
        else exit();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next, prev, toggleFullscreen, resetTimers, overviewOpen, exit]);

  if (!slides.length) {
    return (
      <div className="presenter-shell">
        <div className="presenter-empty">No slides for this paper yet.</div>
      </div>
    );
  }

  const s = slides[Math.max(0, Math.min(i, slides.length - 1))];
  const totalElapsed = Math.floor((now - totalStart) / 1000);
  const slideElapsed = Math.floor((now - slideStart) / 1000);
  const targetSec = s.targetSeconds || 90;
  const pacePct = Math.min(1.2, slideElapsed / targetSec);

  const setQa = (qIdx: number, text: string) => {
    setQaNotes((prev) => ({ ...prev, [`${i}:${qIdx}`]: text }));
  };

  return (
    <div className="presenter-shell">
      <div className="presenter-bar">
        <div className="left">
          <div className="lockup">
            <span className="name">Presenter</span>
            {paperTitle && <span className="tag">{paperTitle}</span>}
          </div>
        </div>
        <div className="center">
          <div className="presenter-timers">
            <span className="timer total">{fmt(totalElapsed)}</span>
            <span
              className={`timer slide${
                pacePct >= 1 ? " is-over" : pacePct >= 0.85 ? " is-near" : ""
              }`}
            >
              <span className="dot" /> {fmt(slideElapsed)}{" "}
              <span className="muted">/ {fmt(targetSec)}</span>
            </span>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              style={{
                background: "transparent",
                border: 0,
                color: "inherit",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              {paused ? "play" : "pause"}
            </button>
            <button
              type="button"
              onClick={resetTimers}
              title="Reset timers (T)"
              style={{
                background: "transparent",
                border: 0,
                color: "inherit",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              reset
            </button>
          </div>
        </div>
        <div className="right">
          <button
            type="button"
            className={overviewOpen ? "is-on" : ""}
            onClick={() => setOverviewOpen((v) => !v)}
            title="Slide overview (O)"
          >
            Overview
          </button>
          <button type="button" onClick={toggleFullscreen} title="Fullscreen (F)">
            {isFullscreen ? "Exit FS" : "Fullscreen"}
          </button>
          <button type="button" onClick={exit}>
            Exit
          </button>
        </div>
      </div>

      <div className="presenter-stage">
        <SlideBody slide={s} idx={i} qaNotes={qaNotes} setQa={setQa} />
        <div className="presenter-nav">
          <button type="button" onClick={prev} aria-label="Previous slide">
            ←
          </button>
          <span className="num">
            {String(i + 1).padStart(2, "0")} /{" "}
            {String(slides.length).padStart(2, "0")}
          </span>
          <button type="button" onClick={next} aria-label="Next slide">
            →
          </button>
        </div>
      </div>

      {overviewOpen && (
        <div
          className="presenter-overview"
          role="dialog"
          aria-label="Slide overview"
        >
          <div className="po-bar">
            <div>
              <div className="po-eyebrow">Overview</div>
              <h3>{slides.length} slides · click to jump</h3>
            </div>
            <button type="button" onClick={() => setOverviewOpen(false)}>
              Close
            </button>
          </div>
          <div className="po-grid">
            {slides.map((sl, idx) => (
              <button
                key={idx}
                type="button"
                className={`po-card${idx === i ? " is-current" : ""}`}
                onClick={() => {
                  goTo(idx);
                  setOverviewOpen(false);
                }}
              >
                <div className="po-thumb">{slideHeadline(sl)}</div>
                <div className="po-meta">
                  <span>{String(idx + 1).padStart(2, "0")}</span>
                  <span>{sl.kind}</span>
                  {sl.targetSeconds ? <span>{fmt(sl.targetSeconds)}</span> : null}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function slideHeadline(s: Slide): string {
  switch (s.kind) {
    case "title":
    case "claim":
    case "diagram":
    case "end":
      return s.title;
    case "math":
      return s.formula;
    case "callout":
      return s.title;
    case "stats":
      return s.rows.map((r) => `${r.v} ${r.l}`).join(" · ");
    case "discussion":
      return s.items[0] ?? "Discussion";
  }
}

function SlideBody({
  slide: s,
  idx,
  qaNotes,
  setQa,
}: {
  slide: Slide;
  idx: number;
  qaNotes: QaMap;
  setQa: (qIdx: number, text: string) => void;
}) {
  if (s.kind === "title") {
    return (
      <div
        className="presenter-slide indigo"
        data-screen-label={`P${String(idx + 1).padStart(2, "0")} Title`}
      >
        <div className="eyebrow-slide">Paper companion</div>
        <h1>{s.title}</h1>
        <p>{s.sub}</p>
        <div className="lead-line">{s.lead}</div>
      </div>
    );
  }
  if (s.kind === "claim") {
    return (
      <div className="presenter-slide">
        <div className="eyebrow-slide">{s.eyebrow}</div>
        <h1>{s.title}</h1>
        <p>{s.body}</p>
      </div>
    );
  }
  if (s.kind === "math") {
    return (
      <div className="presenter-slide">
        <div className="eyebrow-slide">{s.eyebrow}</div>
        <div className="big-formula">{s.formula}</div>
        {s.cap && <div className="cap">{s.cap}</div>}
      </div>
    );
  }
  if (s.kind === "diagram") {
    return (
      <div className="presenter-slide">
        <div className="eyebrow-slide">{s.eyebrow}</div>
        <h2>{s.title}</h2>
        <p>{s.body}</p>
      </div>
    );
  }
  if (s.kind === "callout") {
    return (
      <div className="presenter-slide dark">
        <div className="eyebrow-slide">{s.eyebrow}</div>
        <h1>{s.title}</h1>
        <p>{s.body}</p>
      </div>
    );
  }
  if (s.kind === "stats") {
    return (
      <div className="presenter-slide dark">
        <div className="eyebrow-slide">{s.eyebrow}</div>
        <div className="stats-grid">
          {s.rows.map((r, j) => (
            <div key={j}>
              <div className="v">{r.v}</div>
              <div className="l">{r.l}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (s.kind === "discussion") {
    return (
      <div className="presenter-slide">
        <div className="eyebrow-slide">{s.eyebrow}</div>
        <h2>Open the floor.</h2>
        <ol className="discussion">
          {s.items.map((q, j) => {
            const noteVal = qaNotes[`${idx}:${j}`] ?? "";
            return (
              <li key={j}>
                <div>
                  <div className="q-text">{q}</div>
                  <div className="q-capture">
                    <textarea
                      placeholder="Capture what came up…"
                      value={noteVal}
                      onChange={(e) => setQa(j, e.target.value)}
                      rows={2}
                    />
                    {noteVal && <span className="q-capture-tag">Saved</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }
  // end
  return (
    <div className="presenter-slide indigo">
      <div className="eyebrow-slide">Fin</div>
      <h1>{s.title}</h1>
      <p>{s.body}</p>
    </div>
  );
}
