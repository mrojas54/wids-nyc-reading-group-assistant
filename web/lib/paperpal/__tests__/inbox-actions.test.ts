import { describe, it, expect, vi, beforeEach } from "vitest";

// inbox-actions.ts pulls in next/cache, the Supabase client factories and the
// command_log writer — all mocked so the test exercises only proposePaper's
// find-or-create-placeholder dedupe logic.
const { logServerAction, revalidatePath } = vi.hoisted(() => ({
  logServerAction: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/log", () => ({ logServerAction }));
vi.mock("next/cache", () => ({ revalidatePath }));

let rlsClient: any;
let serviceClient: any;
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve(rlsClient),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => serviceClient,
}));

import { proposePaper } from "../inbox-actions";

// Realistic Postgres 23505 payloads — the action matches on code + the
// constraint/index name embedded in the message.
const SUGGESTION_DUPLICATE = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "paper_suggestions_meeting_id_paper_id_key"',
};
const PLACEHOLDER_RACE = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "meetings_propose_placeholder_paper_unique"',
};

type Result<T> = { data: T; error: { code?: string; message: string } | null };

function setup(opts: {
  memberId?: number | null;
  memberIdError?: { message: string } | null;
  paper?: { id: number } | null;
  paperError?: { message: string } | null;
  // One Result per findPlaceholder() call, in order. Default: no placeholder.
  placeholderResults?: Result<{ id: number } | null>[];
  meetingInsert?: Result<{ id: number } | null>;
  meetingDeleteError?: { message: string } | null;
  suggestionInsertError?: { code: string; message: string } | null;
}) {
  const meetingInserts: any[] = [];
  const meetingDeletes: number[] = [];
  const suggestionInserts: any[] = [];
  const placeholderResults = opts.placeholderResults ?? [
    { data: null, error: null },
  ];
  let placeholderCalls = 0;

  // Self-returning chain for the findPlaceholder() query:
  // select(...).eq().eq().is().eq().maybeSingle()
  const meetingsSelectChain: any = {
    eq: () => meetingsSelectChain,
    is: () => meetingsSelectChain,
    maybeSingle: () => {
      const r =
        placeholderResults[placeholderCalls] ??
        placeholderResults[placeholderResults.length - 1];
      placeholderCalls += 1;
      return Promise.resolve(r);
    },
  };

  rlsClient = {
    rpc: vi.fn(() =>
      Promise.resolve({
        data: opts.memberIdError
          ? null
          : "memberId" in opts
            ? opts.memberId
            : 42,
        error: opts.memberIdError ?? null,
      }),
    ),
    from: (table: string) => {
      if (table === "papers") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data:
                    opts.paper === undefined ? { id: 1 } : opts.paper,
                  error: opts.paperError ?? null,
                }),
            }),
          }),
        };
      }
      if (table === "meetings") {
        return { select: () => meetingsSelectChain };
      }
      // paper_suggestions
      return {
        insert: (row: any) => {
          suggestionInserts.push(row);
          return Promise.resolve({ error: opts.suggestionInsertError ?? null });
        },
      };
    },
  };

  serviceClient = {
    from: () => ({
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
          return Promise.resolve({ error: opts.meetingDeleteError ?? null });
        },
      }),
    }),
  };

  return {
    meetingInserts,
    meetingDeletes,
    suggestionInserts,
    placeholderCalls: () => placeholderCalls,
  };
}

beforeEach(() => {
  logServerAction.mockClear();
  revalidatePath.mockClear();
});

describe("proposePaper — input + member guards", () => {
  it("rejects a non-integer paper id before touching the DB", async () => {
    const { meetingInserts } = setup({});
    await expect(proposePaper({ paperId: 1.5 })).rejects.toThrow(
      /invalid paper id/,
    );
    expect(meetingInserts).toEqual([]);
  });

  it("rejects when the caller is not on the roster", async () => {
    setup({ memberId: null });
    await expect(proposePaper({ paperId: 7 })).rejects.toThrow(/not on roster/);
  });

  it("rejects when the current_member_id RPC errors", async () => {
    setup({ memberIdError: { message: "rpc boom" } });
    await expect(proposePaper({ paperId: 7 })).rejects.toThrow(/rpc boom/);
  });
});

describe("proposePaper — paper validation", () => {
  it("rejects an unknown paper id without creating a meeting", async () => {
    const { meetingInserts } = setup({ paper: null });
    await expect(proposePaper({ paperId: 7 })).rejects.toThrow(/no such paper/);
    expect(meetingInserts).toEqual([]);
  });

  it("throws when the papers lookup itself errors", async () => {
    const { meetingInserts } = setup({
      paper: null,
      paperError: { message: "papers select failed" },
    });
    await expect(proposePaper({ paperId: 7 })).rejects.toThrow(
      /papers select failed/,
    );
    expect(meetingInserts).toEqual([]);
  });
});

describe("proposePaper — placeholder lookup", () => {
  it("throws when the placeholder lookup errors", async () => {
    const { meetingInserts } = setup({
      placeholderResults: [
        { data: null, error: { message: "meetings select failed" } },
      ],
    });
    await expect(proposePaper({ paperId: 7 })).rejects.toThrow(
      /meetings select failed/,
    );
    expect(meetingInserts).toEqual([]);
  });
});

describe("proposePaper — create vs reuse", () => {
  it("creates a fresh placeholder with paper_id set on the first propose", async () => {
    const { meetingInserts, suggestionInserts } = setup({
      placeholderResults: [{ data: null, error: null }],
      meetingInsert: { data: { id: 99 }, error: null },
    });
    await proposePaper({ paperId: 7 });
    expect(meetingInserts).toEqual([
      { type: "reading_group", status: "prep", paper_id: 7 },
    ]);
    expect(suggestionInserts[0]).toMatchObject({
      meeting_id: 99,
      paper_id: 7,
      suggested_by: 42,
      source: "member",
    });
  });

  it("reuses an existing placeholder instead of minting a new meeting", async () => {
    const { meetingInserts, suggestionInserts } = setup({
      placeholderResults: [{ data: { id: 12 }, error: null }],
      suggestionInsertError: SUGGESTION_DUPLICATE,
    });
    await proposePaper({ paperId: 7 });
    expect(meetingInserts).toEqual([]);
    expect(suggestionInserts[0].meeting_id).toBe(12);
  });

  it("treats a repeat propose as an idempotent no-op", async () => {
    const { meetingDeletes } = setup({
      placeholderResults: [{ data: { id: 12 }, error: null }],
      suggestionInsertError: SUGGESTION_DUPLICATE,
    });
    await expect(proposePaper({ paperId: 7 })).resolves.toBeUndefined();
    expect(logServerAction).toHaveBeenCalledWith(
      "proposePaper",
      "no_action",
      expect.stringContaining("already proposed"),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/papers");
    // A no-op never deletes anything.
    expect(meetingDeletes).toEqual([]);
  });
});

describe("proposePaper — concurrent placeholder race", () => {
  it("reuses the winner when the meeting insert loses the unique-index race", async () => {
    const { meetingInserts, suggestionInserts, placeholderCalls } = setup({
      // 1st findPlaceholder: empty. 2nd (post-23505 re-query): the winner.
      placeholderResults: [
        { data: null, error: null },
        { data: { id: 55 }, error: null },
      ],
      meetingInsert: { data: null, error: PLACEHOLDER_RACE },
      suggestionInsertError: SUGGESTION_DUPLICATE,
    });
    await expect(proposePaper({ paperId: 7 })).resolves.toBeUndefined();
    // We attempted exactly one insert, then deferred to the winner.
    expect(meetingInserts).toHaveLength(1);
    expect(suggestionInserts[0].meeting_id).toBe(55);
    expect(placeholderCalls()).toBe(2);
  });

  it("throws if the race is lost but the winning placeholder cannot be found", async () => {
    setup({
      placeholderResults: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      meetingInsert: { data: null, error: PLACEHOLDER_RACE },
    });
    await expect(proposePaper({ paperId: 7 })).rejects.toThrow(
      /could not resolve placeholder meeting/,
    );
  });
});

describe("proposePaper — meeting insert failures", () => {
  it("throws on a non-unique meeting insert error", async () => {
    setup({
      placeholderResults: [{ data: null, error: null }],
      meetingInsert: {
        data: null,
        error: { code: "42501", message: "permission denied" },
      },
    });
    await expect(proposePaper({ paperId: 7 })).rejects.toThrow(
      /permission denied/,
    );
  });

  it("throws when the meeting insert returns no row and no error", async () => {
    setup({
      placeholderResults: [{ data: null, error: null }],
      meetingInsert: { data: null, error: null },
    });
    await expect(proposePaper({ paperId: 7 })).rejects.toThrow(
      /could not create meeting/,
    );
  });
});

describe("proposePaper — suggestion insert failures + cleanup", () => {
  it("deletes a freshly created meeting when the suggestion insert really fails", async () => {
    const { meetingDeletes } = setup({
      placeholderResults: [{ data: null, error: null }],
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
      placeholderResults: [{ data: { id: 12 }, error: null }],
      suggestionInsertError: { code: "23502", message: "not-null violation" },
    });
    await expect(proposePaper({ paperId: 7 })).rejects.toThrow(
      /not-null violation/,
    );
    expect(meetingDeletes).toEqual([]);
  });

  it("logs the orphan meeting id when the cleanup delete itself fails", async () => {
    setup({
      placeholderResults: [{ data: null, error: null }],
      meetingInsert: { data: { id: 99 }, error: null },
      suggestionInsertError: { code: "23502", message: "not-null violation" },
      meetingDeleteError: { message: "delete blocked" },
    });
    await expect(proposePaper({ paperId: 7 })).rejects.toThrow(
      /not-null violation/,
    );
    expect(logServerAction).toHaveBeenCalledWith(
      "proposePaper",
      "failure",
      expect.stringContaining("orphan meeting 99"),
      "delete blocked",
    );
  });
});

describe("proposePaper — success path", () => {
  it("logs success and revalidates /papers", async () => {
    setup({
      placeholderResults: [{ data: null, error: null }],
      meetingInsert: { data: { id: 99 }, error: null },
    });
    await proposePaper({ paperId: 7 });
    expect(logServerAction).toHaveBeenCalledWith(
      "proposePaper",
      "success",
      expect.stringContaining("paper 7, meeting 99, member 42"),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/papers");
  });

  it("trims a note and stores null for a whitespace-only note", async () => {
    const a = setup({
      placeholderResults: [{ data: null, error: null }],
      meetingInsert: { data: { id: 99 }, error: null },
    });
    await proposePaper({ paperId: 7, note: "  please pick me  " });
    expect(a.suggestionInserts[0].notes).toBe("please pick me");

    const b = setup({
      placeholderResults: [{ data: null, error: null }],
      meetingInsert: { data: { id: 99 }, error: null },
    });
    await proposePaper({ paperId: 7, note: "   " });
    expect(b.suggestionInserts[0].notes).toBeNull();
  });
});
