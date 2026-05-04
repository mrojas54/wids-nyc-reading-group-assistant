// Append a row to command_log from a server action.
// Uses the service-role client because command_log isn't in any RLS policy.
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export async function logServerAction(
  name: string,
  status: "success" | "failure" | "no_action",
  summary?: string,
  error?: string,
) {
  const sb = createSupabaseServiceClient();
  await sb.from("command_log").insert({
    source: "server_action",
    name, status, summary, error,
  });
}
