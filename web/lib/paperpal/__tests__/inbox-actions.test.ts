import { describe, it, expect, vi, beforeEach } from "vitest";

// inbox-actions.ts pulls in next/cache, the Supabase client factories and the
// command_log writer — all mocked so the test exercises only proposePaper's
// dedupe logic.
const { logServerAction } = vi.hoisted(() => ({ logServerAction: vi.fn() }));
vi.mock("@/lib/log", () => ({ logServerAction }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let rlsClient: any;
let serviceClient: any;
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve(rlsClient),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => serviceClient,
}));

import { proposePaper } from "../inbox-actions";

const UNIQUE_VIOLATION = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "paper_suggestions_meeting_id_paper_id_key"',
};

type ExistingSuggestion = {
  meeting_id: number;
  meeting: { type: string; status: string } | null;
};

function setup(opts: {
  memberId?: number | null;
  paperExists?: boolean;
  existing?: ExistingSuggestion[];
  suggestionInsertError?: { code: string; message: string } | null;
  meetingInsert?: { data: { id: number } | null; error: { message: string } | null };
}) {
  const meetingInserts: unknown[] = [];
  const meetingDeletes: number[] = [];
  const suggestionInserts: any[] = [];

  rlsClient = {
    rpc: () =>
      Promise.resolve({ data: opts.memberId ?? 42, error: null }),
    from: (table: string) => {
      if (table === "papers") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: opts.paperExists === false ? null : { id: 1 },
                  error: null,
                }),
            }),
          }),
        };
      }
      // paper_suggestions
      return {
        select: () => ({
          eq: () =>
            Promise.resolve({ data: opts.existing ?? [], error: null }),
        }),
        insert: (row: any) => {
          suggestionInserts.push(row);
          return Promise.resolve({
            error: opts.suggestionInsertError ?? null,
          });
        },
      };
    },
  };

  serviceClient = {
    from: (_table: string) => ({
      insert: (row: any) => {
        meetingInserts.push(row);
        return {
          select: () => ({
            single: () =>
              Promise.resolve(
                opts.meetingInsert ?? { data: { id: 99 }, error: null },
              ),
          }),
        };
      },
      delete: () => ({
        eq: (_col: string, val: number) => {
          meetingDeletes.push(val);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };

  return { meetingInserts, meetingDeletes, suggestionInserts };
}

beforeEach(() => {
  logServerAction.mockClear();
});

describe("proposePaper dedupe", () => {
  it("rejects a non-integer paper id before touching the DB", async () => {
    setup({});
    await expect(proposePaper({ paperId: 1.5 })).rejects.toThrow(
      /invalid paper id/,
    );
  });

  it("rejects an unknown paper id without creating a meeting", async () => {
    const { meetingInserts } = setup({ paperExists: false });
    await expect(proposePaper({ paperId: 7 })).rejects.toThrow(/no such paper/);
    expect(meetingInserts).toEqual([]);
  });

  it("creates a fresh placeholder meeting on the first propose", async () => {
    const { meetingInserts, suggestionInserts } = setup({
      existing: [],
      meetingInsert: { data: { id: 99 }, error: null },
    });
    await proposePaper({ paperId: 7 });
    expect(meetingInserts).toEqual([
      { type: "reading_group", status: "prep" },
    ]);
    expect(suggestionInserts[0].meeting_id).toBe(99);
  });

  it("reuses an existing prep placeholder instead of minting a new meeting", async () => {
    const { meetingInserts, suggestionInserts } = setup({
      existing: [
        { meeting_id: 12, meeting: { type: "reading_group", status: "prep" } },
      ],
      suggestionInsertError: UNIQUE_VIOLATION,
    });
    await proposePaper({ paperId: 7 });
    // No new meeting — the suggestion insert targets the existing placeholder.
    expect(meetingInserts).toEqual([]);
    expect(suggestionInserts[0].meeting_id).toBe(12);
  });

  it("treats a repeat propose as an idempotent no-op (no throw)", async () => {
    setup({
      existing: [
        { meeting_id: 12, meeting: { type: "reading_group", status: "prep" } },
      ],
      suggestionInsertError: UNIQUE_VIOLATION,
    });
    await expect(proposePaper({ paperId: 7 })).resolves.toBeUndefined();
    expect(logServerAction).toHaveBeenCalledWith(
      "proposePaper",
      "no_action",
      expect.stringContaining("already proposed"),
    );
  });

  it("does not reuse a non-prep meeting — mints a fresh placeholder", async () => {
    const { meetingInserts } = setup({
      existing: [
        {
          meeting_id: 5,
          meeting: { type: "reading_group", status: "scheduled" },
        },
      ],
      meetingInsert: { data: { id: 99 }, error: null },
    });
    await proposePaper({ paperId: 7 });
    expect(meetingInserts).toEqual([
      { type: "reading_group", status: "prep" },
    ]);
  });

  it("deletes a freshly created meeting when the suggestion insert really fails", async () => {
    const { meetingDeletes } = setup({
      existing: [],
      meetingInsert: { data: { id: 99 }, error: null },
      suggestionInsertError: { code: "23502", message: "not-null violation" },
    });
    await expect(proposePaper({ paperId: 7 })).rejects.toThrow(
      /not-null violation/,
    );
    expect(meetingDeletes).toEqual([99]);
  });

  it("never deletes a reused placeholder when the suggestion insert fails", async () => {
    const { meetingDeletes } = setup({
      existing: [
        { meeting_id: 12, meeting: { type: "reading_group", status: "prep" } },
      ],
      suggestionInsertError: { code: "23502", message: "not-null violation" },
    });
    await expect(proposePaper({ paperId: 7 })).rejects.toThrow(
      /not-null violation/,
    );
    expect(meetingDeletes).toEqual([]);
  });
});
