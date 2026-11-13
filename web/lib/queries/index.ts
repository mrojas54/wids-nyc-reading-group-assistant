// Server-side data accessors, split by subject: meetings.ts (the next and
// prep meetings), member.ts (the signed-in member's own rows) and papers.ts
// (paper catalog and the Paper Pal gate). Callers import from "@/lib/queries",
// which re-exports all three. Every query assumes the supplied client respects
// RLS (server.ts client).
//
// The rest of this note applies to every file in this directory.
//
// The `<Database>` generic is load-bearing, not decoration. `SupabaseClient`'s
// generic parameter defaults to `any`, so a bare annotation silently discards
// the schema types that lib/supabase/{server,browser,service}.ts attach at
// construction. Without it `tsc` accepted `.from("meetingz")` — a table that
// does not exist — with zero errors. Keep the generic on every accessor's
// client parameter.
//
// What it catches, as measured on these files: unknown table in .from(), unknown
// function in .rpc(), unknown column in filters (.eq/.gte/.order/...), and
// unknown column inside a .select("a, b, c") string.
//
// That last one has a catch worth knowing about. postgrest-js does detect it,
// but it reports it *in the result type* rather than at the call:
//
//   .select("id, bogus_col")
//     -> SelectQueryError<"column 'bogus_col' does not exist on 'meetings'."> | null
//
// which is only an error once something consumes `data` in a type-checked way.
// Row mappers and casts that widen back to `any` swallow that diagnostic, so
// it's computed and then discarded.
//
// So does `.returns<T>()`, which these files used until 2026-09. In postgrest-js
// 2.x it is a cast: `CheckMatchingArrayTypes<Result, T>` only checks array-vs-
// single shape and otherwise yields `T` verbatim, so a select-string typo
// compiled clean under it (verified by renaming a column and running tsc: zero
// errors). What actually engages the guard is letting the *inferred* result
// flow into a value or parameter typed off Tables<"..."> — the assignment
// fails when a field has become a SelectQueryError. Every embedded select
// in these files therefore lands in a typed mapper parameter or an annotated local,
// never a `.returns<T>()`. Re-verify after touching this: rename a column in
// one select string and confirm tsc rejects it.
export type { MeetingStatus, RsvpStatus } from "./shared";
export * from "./meetings";
export * from "./member";
export * from "./papers";
