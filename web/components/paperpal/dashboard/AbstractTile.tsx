// Abstract synthesis tile — serif "reading context" body that mixes the
// abstract + method breakdowns with inline term + math-variable highlights.

import { Eyebrow, Tile } from "../primitives";
import { Highlighted, mathVarsFromExplanations } from "../Highlighted";
import type {
  MathExplanation,
  TerminologyItem,
} from "@/lib/paperpal/types";

export function AbstractTile({
  abstractBreakdown,
  methodBreakdown,
  terminology,
  mathExplanations,
  terminologyCount,
  mathCount,
  diagramCount,
}: {
  abstractBreakdown: string;
  methodBreakdown?: string;
  terminology: TerminologyItem[];
  mathExplanations: MathExplanation[];
  terminologyCount: number;
  mathCount: number;
  diagramCount: number;
}) {
  const mvars = mathVarsFromExplanations(mathExplanations);

  return (
    <Tile id="section-abstract" className="pp-col-12 pp-abstract-tile">
      <div className="pp-abstract-body">
        <Eyebrow tone="accent" dot>
          Abstract synthesis
        </Eyebrow>
        <div style={{ marginTop: 12 }}>
          <p className="pp-abstract-prose reading-context">
            <Highlighted
              text={abstractBreakdown}
              terms={terminology}
              mathVars={mvars}
            />
          </p>
          {methodBreakdown && (
            <p className="pp-abstract-prose reading-context">
              <Highlighted
                text={methodBreakdown}
                terms={terminology}
                mathVars={mvars}
              />
            </p>
          )}
        </div>
      </div>

      <aside className="pp-abstract-side">
        <div className="pp-abstract-side-row">
          <div className="v sage">{terminologyCount}</div>
          <div className="l">Terms · contextual</div>
        </div>
        <div className="pp-abstract-side-row">
          <div className="v accent">{mathCount}</div>
          <div className="l">Key equations</div>
        </div>
        <div className="pp-abstract-side-row">
          <div className="v">{diagramCount}</div>
          <div className="l">Diagram blocks</div>
        </div>
        <div className="pp-abstract-side-foot">
          Hover any <span className="pp-tx-term pp-tx-static">term</span> or{" "}
          <span className="pp-tx-mvar pp-tx-static">variable</span> above.
        </div>
      </aside>
    </Tile>
  );
}
