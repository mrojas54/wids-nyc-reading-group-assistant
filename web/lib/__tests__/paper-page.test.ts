// Unit tests for the /papers/<id> loader. The page used to make these
// decisions inline with no tests; each case below is one view it can render.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { PaperContent } from "@/lib/paperContent";
import type { PaperCatalogRow, SynthesisGate } from "@/lib/queries";
import { loadPaperPage } from "../paper-page";

const mocks = vi.hoisted(() => ({
  readPaperContent: vi.fn(),
  paperCatalogRow: vi.fn(),
  canSynthesizePaperPal: vi.fn(),
  access: vi.fn(),
}));

vi.mock("@/lib/paperContent", () => ({
  readPaperContent: mocks.readPaperContent,
}));
vi.mock("@/lib/queries", () => ({
  paperCatalogRow: mocks.paperCatalogRow,
  canSynthesizePaperPal: mocks.canSynthesizePaperPal,
}));
vi.mock("node:fs", () => ({ promises: { access: mocks.access } }));

type Rows = Partial<Record<"paper_companions" | "papers" | "meetings", unknown>>;

/** Fake client: every chain ends in maybeSingle() resolving that table's row. */
function buildSb(rows: Rows = {}) {
  const from = vi.fn((table: keyof Rows) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: rows[table] ?? null }),
    };
    return chain;
  });
  return { sb: { from } as unknown as SupabaseClient<Database>, from };
}

const catalog: PaperCatalogRow = {
  id: 12,
  title: "Attention Is All You Need",
  authors: ["Vaswani"],
  leader_name: "Ada",
};
const noGate: SynthesisGate = { canSynthesize: false, reason: "none" };
const payload = { title: "Synthesized" };
const content = {
  paper_id: 12,
  title: "Fixture",
  authors: [],
  notebook_path: "/notebooks/12.ipynb",
  generated_at: "2026-01-01",
  sections: [],
} as PaperContent;

beforeEach(() => {
  mocks.readPaperContent.mockResolvedValue(null);
  mocks.paperCatalogRow.mockResolvedValue(null);
  mocks.canSynthesizePaperPal.mockResolvedValue(noGate);
  mocks.access.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("loadPaperPage", () => {
  it("is not found when nothing knows the paper", async () => {
    const { sb } = buildSb();
    expect(await loadPaperPage(sb, "12")).toEqual({ kind: "not_found" });
  });

  it("skips the database for a non-numeric id", async () => {
    const { sb, from } = buildSb();
    mocks.readPaperContent.mockResolvedValue(content);
    vi.stubEnv("NEXT_PUBLIC_GITHUB_REPO", "");
    const view = await loadPaperPage(sb, "attention");
    expect(view).toEqual({ kind: "legacy", content, colabUrl: null });
    expect(from).not.toHaveBeenCalled();
    expect(mocks.paperCatalogRow).not.toHaveBeenCalled();
    expect(mocks.canSynthesizePaperPal).not.toHaveBeenCalled();
  });

  it("renders the dashboard with paper details and the next meeting", async () => {
    mocks.paperCatalogRow.mockResolvedValue(catalog);
    const { sb } = buildSb({
      paper_companions: { payload },
      papers: { venue: "NeurIPS", pdf_drive_url: "https://drive/x" },
      meetings: { scheduled_at: "2026-11-12T23:30:00Z", location: "Room 4" },
    });
    const view = await loadPaperPage(sb, "12");
    expect(view).toMatchObject({
      kind: "dashboard",
      paperId: 12,
      payload,
      paper: {
        title: catalog.title,
        authors: catalog.authors,
        venue: "NeurIPS",
        pdf_drive_url: "https://drive/x",
        presentHref: "/papers/12/present",
      },
      nextMeeting: { venue: "Room 4" },
    });
    if (view.kind !== "dashboard") throw new Error("expected dashboard");
    expect(view.nextMeeting?.whenLabel).toMatch(/Nov/);
  });

  it("leaves optional dashboard details empty when the rows are missing", async () => {
    mocks.paperCatalogRow.mockResolvedValue({ ...catalog, authors: null });
    const { sb } = buildSb({ paper_companions: { payload } });
    const view = await loadPaperPage(sb, "12");
    expect(view).toMatchObject({
      kind: "dashboard",
      paper: { authors: undefined, venue: undefined, pdf_drive_url: null },
      nextMeeting: null,
    });
  });

  it("offers synthesis to the owner or leader of an unsynthesized paper", async () => {
    mocks.paperCatalogRow.mockResolvedValue(catalog);
    mocks.canSynthesizePaperPal.mockResolvedValue({
      canSynthesize: true,
      reason: "leader",
    });
    const { sb } = buildSb();
    expect(await loadPaperPage(sb, "12")).toEqual({
      kind: "synthesize",
      catalog,
      reason: "leader",
    });
  });

  it("shows everyone else the read-only empty state", async () => {
    mocks.paperCatalogRow.mockResolvedValue(catalog);
    const { sb } = buildSb();
    expect(await loadPaperPage(sb, "12")).toEqual({ kind: "empty", catalog });
  });

  it("prefers a legacy fixture over the synthesis prompt", async () => {
    mocks.paperCatalogRow.mockResolvedValue(catalog);
    mocks.readPaperContent.mockResolvedValue(content);
    vi.stubEnv("NEXT_PUBLIC_GITHUB_REPO", "mrojas54/wids");
    const { sb } = buildSb();
    expect(await loadPaperPage(sb, "12")).toEqual({
      kind: "legacy",
      content,
      colabUrl:
        "https://colab.research.google.com/github/mrojas54/wids/blob/main/web/public/notebooks/12.ipynb",
    });
  });

  it("drops the Colab link when the notebook is not shipped", async () => {
    mocks.readPaperContent.mockResolvedValue(content);
    mocks.access.mockRejectedValue(new Error("ENOENT"));
    vi.stubEnv("NEXT_PUBLIC_GITHUB_REPO", "mrojas54/wids");
    const { sb } = buildSb();
    expect(await loadPaperPage(sb, "12")).toMatchObject({
      kind: "legacy",
      colabUrl: null,
    });
  });

  it("is not found for a payload with no catalog row and no fixture", async () => {
    const { sb } = buildSb({ paper_companions: { payload } });
    expect(await loadPaperPage(sb, "12")).toEqual({ kind: "not_found" });
  });
});
