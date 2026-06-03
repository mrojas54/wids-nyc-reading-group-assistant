// Server-side Supabase client bound to the request's session.
// Use this in Server Components and server actions for RLS-respecting reads.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: (name, value, options) => {
          try { cookieStore.set({ name, value, ...options }); } catch {}
        },
        remove: (name, options) => {
          try { cookieStore.set({ name, value: "", ...options }); } catch {}
        },
      },
    }
  );
}
