// The lockup: cream tile + Codex Board glyph + WiDS NYC wordmark.
// The Codex Board mark (open book in deep indigo, circuit traces with circle
// endpoints, magenta accent on the tallest center pair) is the chosen app
// mark from the design bundle generated 2026-05-05. When `inverted`, the
// glyph drops to a single-color white "mono" treatment for use on dark
// surfaces — sage-900, indigo-900, magenta — per the Codex Identity sheet.
export function Brandmark({ inverted = false }: { inverted?: boolean } = {}) {
  return (
    <div className={`brandmark${inverted ? " brandmark-inverted" : ""}`}>
      <div className="dotmark" aria-hidden>
        {inverted ? <CodexBoardMonoMark /> : <CodexBoardMark />}
      </div>
      <div className="lockup">
        <span className="name">WiDS NYC</span>
        <span className="tag">AI Reading Group</span>
      </div>
    </div>
  );
}

// Standalone glyph — also used by web/app/icon.svg via a literal copy. Keep
// the two in sync if either changes.
export function CodexBoardMark() {
  const line = "#16205e";
  const book = "#16205e";
  const page = "#f3eee5";
  const accent = "#c8226d";
  return (
    <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="WiDS NYC">
      <g stroke={line} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M18 62 L 18 36 L 12 30 L 12 18" />
        <path d="M28 62 L 28 44 L 24 40" />
        <path d="M36 62 L 36 28 L 30 22 L 30 12" />
        <path d="M44 62 L 44 14" />
        <path d="M52 62 L 52 14" />
        <path d="M60 62 L 60 28 L 66 22 L 66 12" />
        <path d="M68 62 L 68 44 L 72 40" />
        <path d="M78 62 L 78 36 L 84 30 L 84 18" />
      </g>
      <g fill={page} stroke={line} strokeWidth={1.4}>
        <circle cx={12} cy={14} r={3} />
        <circle cx={24} cy={40} r={2.4} />
        <circle cx={30} cy={8} r={3} />
        <circle cx={66} cy={8} r={3} />
        <circle cx={72} cy={40} r={2.4} />
        <circle cx={84} cy={14} r={3} />
      </g>
      <circle cx={44} cy={10} r={3.4} fill={accent} stroke={line} strokeWidth={1.2} />
      <circle cx={52} cy={10} r={3.4} fill={page} stroke={line} strokeWidth={1.4} />
      <path
        d="M48 62 C 36 58, 22 58, 8 64 L 10 68 C 24 64, 36 64, 48 68 Z"
        fill={book}
        stroke={line}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <path
        d="M48 62 C 60 58, 74 58, 88 64 L 86 68 C 72 64, 60 64, 48 68 Z"
        fill={book}
        stroke={line}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <g stroke={page} strokeWidth={0.6} strokeLinecap="round" opacity={0.6}>
        <path d="M14 64 C 24 61, 34 61, 44 64" />
        <path d="M52 64 C 62 61, 72 61, 82 64" />
      </g>
      <line x1={48} y1={62} x2={48} y2={68} stroke={line} strokeWidth={1.4} />
      <path
        d="M44 66 L 52 66 L 50 72 L 46 72 Z"
        fill={accent}
        stroke={line}
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Mono variant — single-color white mark for dark surfaces. Same geometry,
// no accent magenta or filled circles. Use only where contrast demands it.
export function CodexBoardMonoMark() {
  const stroke = "#ffffff";
  return (
    <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="WiDS NYC">
      <g stroke={stroke} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M18 62 L 18 36 L 12 30 L 12 18" />
        <path d="M28 62 L 28 44 L 24 40" />
        <path d="M36 62 L 36 28 L 30 22 L 30 12" />
        <path d="M44 62 L 44 14" />
        <path d="M52 62 L 52 14" />
        <path d="M60 62 L 60 28 L 66 22 L 66 12" />
        <path d="M68 62 L 68 44 L 72 40" />
        <path d="M78 62 L 78 36 L 84 30 L 84 18" />
      </g>
      <g fill="none" stroke={stroke} strokeWidth={1.4}>
        <circle cx={12} cy={14} r={3} />
        <circle cx={24} cy={40} r={2.4} />
        <circle cx={30} cy={8} r={3} />
        <circle cx={44} cy={10} r={3.4} />
        <circle cx={52} cy={10} r={3.4} />
        <circle cx={66} cy={8} r={3} />
        <circle cx={72} cy={40} r={2.4} />
        <circle cx={84} cy={14} r={3} />
      </g>
      <path
        d="M48 62 C 36 58, 22 58, 8 64 L 10 68 C 24 64, 36 64, 48 68 Z"
        stroke={stroke}
        strokeWidth={1.2}
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M48 62 C 60 58, 74 58, 88 64 L 86 68 C 72 64, 60 64, 48 68 Z"
        stroke={stroke}
        strokeWidth={1.2}
        strokeLinejoin="round"
        fill="none"
      />
      <line x1={48} y1={62} x2={48} y2={68} stroke={stroke} strokeWidth={1.4} />
      <path
        d="M44 66 L 52 66 L 50 72 L 46 72 Z"
        stroke={stroke}
        strokeWidth={0.8}
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
