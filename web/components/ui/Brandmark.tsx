// The lockup: sage gradient tile + circuit-bloom-on-open-book glyph + WiDS NYC wordmark.
// Drop the simplified glyph into the dotmark — same iconography as the design bundle's app mark.
export function Brandmark() {
  return (
    <div className="brandmark">
      <div className="dotmark" aria-hidden>
        <svg viewBox="0 0 84 84" fill="none">
          <g
            stroke="#F6EFE2"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          >
            <path d="M42 60 L42 26" />
            <path d="M42 46 L28 46 L28 32" />
            <path d="M42 46 L56 46 L56 32" />
            <path d="M42 36 L34 36" />
            <path d="M42 36 L50 36" />
          </g>
          <g fill="#F6EFE2">
            <circle cx={34} cy={36} r={1.6} />
            <circle cx={50} cy={36} r={1.6} />
          </g>
          <g fill="#E94B86">
            <circle cx={42} cy={22} r={4} />
            <circle cx={28} cy={28} r={3} />
            <circle cx={56} cy={28} r={3} />
          </g>
          <circle cx={42} cy={22} r={1.4} fill="#F6EFE2" opacity={0.85} />
          <path d="M14 64 Q26 58 41 60 L41 70 Q26 68 14 71 Z" fill="#F6EFE2" />
          <path d="M70 64 Q58 58 43 60 L43 70 Q58 68 70 71 Z" fill="#F6EFE2" />
        </svg>
      </div>
      <div className="lockup">
        <span className="name">WiDS NYC</span>
        <span className="tag">AI Reading Group</span>
      </div>
    </div>
  );
}
