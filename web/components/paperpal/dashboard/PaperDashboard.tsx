// Top-level synthesis dashboard. Server component; client subcomponents
// (SectionBreakdownTile, ArchitectureTile, Highlighted-tooltip prose) opt
// into `'use client'` themselves.

import "../paperpal.css";

import type {
  ResearchPaperAnalysis,
} from "@/lib/paperpal/types";
import { HeaderStrip, type NextMeetingHero } from "./HeaderStrip";
import { AbstractTile } from "./AbstractTile";
import { SectionBreakdownTile } from "./SectionBreakdownTile";
import { ArchitectureTile } from "./ArchitectureTile";
import { TakeawaysTile } from "./TakeawaysTile";
import { ResourcesTile } from "./ResourcesTile";
import { CodeBlockTile } from "./CodeBlockTile";
import { DashboardActionStrip } from "./DashboardActionStrip";

export type PaperDashboardPaperMeta = {
  title?: string;
  authors?: string[];
  venue?: string;
  pages?: number;
  uploadedAt?: string;
  pdf_drive_url?: string | null;
  presentHref?: string;
};

export function PaperDashboard({
  paperId,
  payload,
  paper,
  nextMeeting,
}: {
  paperId: string;
  payload: ResearchPaperAnalysis;
  paper?: PaperDashboardPaperMeta;
  nextMeeting?: NextMeetingHero | null;
}) {
  const title = paper?.title ?? payload.title;
  const authors = paper?.authors ?? payload.authors ?? [];
  const venue = paper?.venue ?? payload.venue;
  const pages = paper?.pages ?? payload.pages;
  const uploadedAt = paper?.uploadedAt ?? payload.uploadedAt;
  const pdfHref = paper?.pdf_drive_url ?? null;
  const firstDiagram = payload.diagrams?.[0];
  const firstCode = payload.codeSamples?.[0];

  return (
    <div className="pp-page">
      <HeaderStrip
        title={title}
        authors={authors}
        venue={venue}
        pages={pages}
        uploadedAt={uploadedAt}
        nextMeeting={nextMeeting ?? null}
      />

      <div className="pp-bento">
        <AbstractTile
          abstractBreakdown={payload.abstractBreakdown}
          methodBreakdown={payload.methodBreakdown}
          terminology={payload.terminology}
          mathExplanations={payload.mathExplanations}
          terminologyCount={payload.terminology.length}
          mathCount={payload.mathExplanations.length}
          diagramCount={firstDiagram?.nodes.length ?? 0}
        />

        <SectionBreakdownTile
          paperId={paperId}
          terminology={payload.terminology}
          mathExplanations={payload.mathExplanations}
        />

        {firstDiagram && <ArchitectureTile diagram={firstDiagram} />}

        {firstCode && <CodeBlockTile sample={firstCode} />}

        <TakeawaysTile takeaways={payload.keyTakeaways} />

        {payload.learningResources && payload.learningResources.length > 0 && (
          <ResourcesTile resources={payload.learningResources} />
        )}

        <DashboardActionStrip
          presentHref={paper?.presentHref}
          pdfHref={pdfHref}
        />
      </div>
    </div>
  );
}
