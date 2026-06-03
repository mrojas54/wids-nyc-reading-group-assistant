// Append a row to command_log from a server action.
// Uses the service-role client because command_log isn't in any RLS policy.
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// Optional enrichment columns added in migration 020. Each is written only
// when supplied so call sites that don't care keep the row (and the table
// defaults) untouched. `idempotencyKey` maps to a UNIQUE column — pass a stable
// key (e.g. `setRsvp:meeting=7:member=3`) to make a write at-most-once.
export type LogExtra = {
  durationMs?: number;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  actor?: string;
};

export async function logServerAction(
  name: string,
  status: "success" | "failure" | "no_action",
  summary?: string,
  error?: string,
  extra?: LogExtra,
) {
  const sb = createSupabaseServiceClient();
  const row: Record<string, unknown> = {
    source: "server_action",
    name, status, summary, error,
  };
  if (extra?.durationMs !== undefined) row.duration_ms = extra.durationMs;
  if (extra?.metadata !== undefined) row.metadata = extra.metadata;
  if (extra?.idempotencyKey !== undefined) row.idempotency_key = extra.idempotencyKey;
  if (extra?.actor !== undefined) row.actor = extra.actor;
  await sb.from("command_log").insert(row);
}
