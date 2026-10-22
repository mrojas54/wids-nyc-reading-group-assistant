// Bottom action strip — Present + Open original PDF links.

import { Eyebrow } from "../primitives";
import { externalHttpUrl } from "@/lib/safeUrl";

export function DashboardActionStrip({
  presentHref,
  pdfHref,
}: {
  presentHref?: string;
  pdfHref?: string | null;
}) {
  // presentHref is an internal route the caller builds; pdfHref is
  // papers.pdf_drive_url straight out of the database, so it gets the scheme
  // check before it becomes an href.
  const pdfUrl = externalHttpUrl(pdfHref);
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
        {pdfUrl && (
          <a
            className="pp-action-chip"
            href={pdfUrl}
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
