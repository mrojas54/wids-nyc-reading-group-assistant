// Bottom action strip — Present + Open original PDF links.

import { Eyebrow } from "../primitives";

export function DashboardActionStrip({
  presentHref,
  pdfHref,
}: {
  presentHref?: string;
  pdfHref?: string | null;
}) {
  return (
    <div className="pp-actions-strip pp-col-12">
      <div>
        <Eyebrow tone="brand" dot>
          Active recall
        </Eyebrow>
        <h4 className="pp-actions-strip-title">Take it to the room.</h4>
        <div className="pp-actions-strip-sub">
          Present the synthesis or open the source PDF side-by-side.
        </div>
      </div>
      <div className="pp-action-chips">
        {presentHref && (
          <a className="pp-action-chip" href={presentHref}>
            Present
          </a>
        )}
        {pdfHref && (
          <a
            className="pp-action-chip"
            href={pdfHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open original PDF
          </a>
        )}
      </div>
    </div>
  );
}
