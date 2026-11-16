"use client";

// Full-screen presenter view for the discussion lead.
// Keyboard: ← / → navigate, F fullscreen, T reset, O/G overview, Esc exit.
// Q&A per discussion slide is persisted via usePaperLocalState.
// Ported from design_handoff/design/ideas-screens.jsx · PresenterScreen.

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { usePaperLocalState } from "@/lib/paperpal/hooks";
import {
  clampSlideIndex,
  DEFAULT_SLIDE_SECONDS,
  formatClock,
  presenterKeyAction,
  qaNoteKey,
  slideHeadline,
  slidePace,
  type Slide,
} from "@/lib/paperpal/presenter";
import { SlideBody, type QaMap } from "./SlideBody";
import "./presenter.css";

const timerButtonStyle: CSSProperties = {
  background: "transparent",
  border: 0,
  color: "inherit",
  cursor: "pointer",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
};

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

  const [storedIdx, setI] = usePaperLocalState<number>(paperId, "presenter:idx", 0);
  const i = clampSlideIndex(storedIdx, slides.length);
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

  // Reset the per-slide timer when the slide changes, during render. Uses
  // the `now` tick (state — pure to read) rather than Date.now(); the timer
  // displays whole seconds, so sub-tick skew is invisible.
  const [slideStartIdx, setSlideStartIdx] = useState(i);
  if (i !== slideStartIdx) {
    setSlideStartIdx(i);
    setSlideStart(now);
  }

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [paused]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const goTo = useCallback(
    (n: number) => setI(clampSlideIndex(n, slides.length)),
    [slides.length, setI],
  );
  const next = useCallback(() => goTo(i + 1), [goTo, i]);
  const prev = useCallback(() => goTo(i - 1), [goTo, i]);

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
      switch (presenterKeyAction(e.key)) {
        case "next":
          e.preventDefault();
          next();
          break;
        case "prev":
          prev();
          break;
        case "fullscreen":
          toggleFullscreen();
          break;
        case "reset":
          resetTimers();
          break;
        case "overview":
          setOverviewOpen((v) => !v);
          break;
        case "escape":
          if (overviewOpen) setOverviewOpen(false);
          else exit();
          break;
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

  const s = slides[i];
  const totalElapsed = Math.floor((now - totalStart) / 1000);
  const slideElapsed = Math.floor((now - slideStart) / 1000);
  const targetSec = s.targetSeconds || DEFAULT_SLIDE_SECONDS;
  const pace = slidePace(slideElapsed, targetSec);

  const setQa = (qIdx: number, text: string) => {
    setQaNotes((prev) => ({ ...prev, [qaNoteKey(i, qIdx)]: text }));
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
            <span className="timer total">{formatClock(totalElapsed)}</span>
            <span
              className={`timer slide${pace === "ok" ? "" : ` is-${pace}`}`}
            >
              <span className="dot" /> {formatClock(slideElapsed)}{" "}
              <span className="muted">/ {formatClock(targetSec)}</span>
            </span>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              style={timerButtonStyle}
            >
              {paused ? "play" : "pause"}
            </button>
            <button
              type="button"
              onClick={resetTimers}
              title="Reset timers (T)"
              style={timerButtonStyle}
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
                  {sl.targetSeconds ? <span>{formatClock(sl.targetSeconds)}</span> : null}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

