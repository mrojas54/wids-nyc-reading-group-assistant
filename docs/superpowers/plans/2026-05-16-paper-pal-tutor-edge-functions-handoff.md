# Handoff — Socratic + hint Edge Functions

**Status:** Stub. Replaces the scripted-probes-only fallback that ships in PR #45 (`web/components/paperpal/assessment/SocraticMode.tsx`).

**Goal:** make the Socratic tutor and the MCQ hint button live LLM-backed, with the scripted fallback kept verbatim for offline / outage paths.

---

## Two functions, one shape

```
supabase/functions/analyze-hint/index.ts       → { topic, questionStem, transcript } → { reply: string }
supabase/functions/analyze-socratic/index.ts   → { topic, prompt, transcript, hintsUsed } → { converged: boolean, reply: string }
```

Both `verify_jwt: true`, both re-derive `current_member_id()` server-side (don't trust the client), both log to `command_log` with `command='analyze-hint'` / `analyze-socratic` and `source='server_action'`.

Same Gemini setup as `analyze-paper` (see that handoff). Model can be smaller — `gemini-2.5-flash` is fine; these are short single-shot completions, not 30k-token paper analyses.

---

## `analyze-hint` — MCQ hint button

Today: scripted nudge. After: 1–2 sentence nudge from Gemini that *doesn't* reveal the answer index. Strict cap: 1024 tokens.

System prompt sketch:

```
You are a Socratic-style tutor for a research-paper reading group. The learner is on a multiple-choice question and asked for a hint. Emit one or two sentences that gently redirect their thinking — name the relevant concept or the property to compare — but never reveal which option is correct, and never quote any option verbatim.
```

Request body includes `questionStem`, `options`, `correctIndex` (the server doesn't echo it), and the learner's `selectedOption` if any. Gemini sees `correctIndex` so it can craft a useful nudge but must follow the no-reveal rule.

**Fallback:** if the function fails or returns empty, the client uses the scripted `recordHint` path that already exists.

---

## `analyze-socratic` — convergence-aware tutor

This is the harder one. Today the tutor uses `scriptedProbes[i % length]` and a `3 + hintsUsed` turn floor (`SocraticMode.tsx`). After: Gemini emits a JSON block on every reply:

```ts
type Out = { converged: boolean; reply: string };
```

with the contract from the README:

> Convergence is declared when the learner has reasoned to the key insight in their own words. Turn count is a *floor* (won't synthesize too early), not a cap; hints extend the floor so taking two hints and typing twice doesn't trigger a premature wrap.

System prompt sketch:

```
You are running a Socratic dialogue toward a single goal insight (provided below). On every learner turn, emit exactly:

{ "converged": <bool>, "reply": "<your next question or the synthesis>" }

Rules:
- "converged": true ONLY if the learner has stated the goal insight in their own words. Restating your own question back does not count.
- Floor: don't set converged=true until at least 3 + hintsUsed turns have elapsed (the client enforces this too; you should still respect it).
- When converged=false: ask one short, pointed question that narrows the gap. No multi-question replies.
- When converged=true: emit a 2–3 sentence synthesis that names the insight explicitly.

GOAL INSIGHT:
{prompt.goalInsight}

TOPIC:
{prompt.topic}
```

Response: enforce JSON via `responseSchema` in `@google/genai`. Parse; if parsing fails or `reply` is empty, the client falls back to the scripted probe at index `transcript.length / 2`.

**"I've got it" override:** stays client-side — sends a final turn with `forceConvergence: true` flag the function passes through to the prompt as an extra instruction.

---

## Client wiring (`SocraticMode.tsx` diff sketch)

```ts
async function tutorReply(transcript, hintsUsed): Promise<Out> {
  try {
    const { data, error } = await supabase.functions.invoke("analyze-socratic", {
      body: { prompt, transcript, hintsUsed },
    });
    if (error || !data) throw error ?? new Error("empty");
    return data as Out;
  } catch {
    return scriptedFallback(transcript, hintsUsed);  // existing code
  }
}
```

Keep the 60s idle pulse and the I-got-it button unchanged.

---

## Test plan

- [ ] Airplane-mode (`supabase.functions.invoke` rejected) → tutor still runs via scripted probes. No console errors visible to the learner.
- [ ] Hint button: real Gemini hint contains no exact substring of `options[correctIndex]`.
- [ ] Socratic: `converged=true` never appears before turn `3 + hintsUsed`.
- [ ] "I've got it" forces a synthesis turn.
- [ ] `command_log` shows entries on each invocation.

---

## Risks

- **Cost.** Socratic is N round-trips per learner per paper. Cap budget at server level (e.g. 30 turns per learner per paper per day) or accept it as small.
- **JSON drift.** Gemini occasionally emits prose around the JSON. `responseSchema` mostly fixes it; have a parse-failure fallback.
- **Convergence false positives.** The model will over-declare success. The client-side floor catches early ones; for late ones, add a "Keep going" button next to "I've got it" so learners can reject a premature wrap.
