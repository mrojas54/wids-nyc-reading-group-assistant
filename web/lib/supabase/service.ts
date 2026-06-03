// Service-role client. Bypasses RLS. Use ONLY for trusted server-side operations
// like writing to command_log or upserting member.auth_user_id during sign-in.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export function createSupabaseServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
