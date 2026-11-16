// One presenter slide, by kind. Discussion slides carry a Q&A pad per question.
import { qaNoteKey, type Slide } from "@/lib/paperpal/presenter";

export type QaMap = Record<string, string>;

export function SlideBody({
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
  switch (s.kind) {
    case "title":
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
    case "claim":
      return (
        <div className="presenter-slide">
          <div className="eyebrow-slide">{s.eyebrow}</div>
          <h1>{s.title}</h1>
          <p>{s.body}</p>
        </div>
      );
    case "math":
      return (
        <div className="presenter-slide">
          <div className="eyebrow-slide">{s.eyebrow}</div>
          <div className="big-formula">{s.formula}</div>
          {s.cap && <div className="cap">{s.cap}</div>}
        </div>
      );
    case "diagram":
      return (
        <div className="presenter-slide">
          <div className="eyebrow-slide">{s.eyebrow}</div>
          <h2>{s.title}</h2>
          <p>{s.body}</p>
        </div>
      );
    case "callout":
      return (
        <div className="presenter-slide dark">
          <div className="eyebrow-slide">{s.eyebrow}</div>
          <h1>{s.title}</h1>
          <p>{s.body}</p>
        </div>
      );
    case "stats":
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
    case "discussion":
      return (
        <div className="presenter-slide">
          <div className="eyebrow-slide">{s.eyebrow}</div>
          <h2>Open the floor.</h2>
          <ol className="discussion">
            {s.items.map((q, j) => {
              const noteVal = qaNotes[qaNoteKey(idx, j)] ?? "";
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
    case "end":
      return (
        <div className="presenter-slide indigo">
          <div className="eyebrow-slide">Fin</div>
          <h1>{s.title}</h1>
          <p>{s.body}</p>
        </div>
      );
  }
}
