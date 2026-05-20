"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logServerAction } from "@/lib/log";

export async function signOut(): Promise<void> {
  const sb = await createSupabaseServerClient();
  const { error } = await sb.auth.signOut();
  if (error) {
    await logServerAction("signOut", "failure", undefined, error.message);
  } else {
    await logServerAction("signOut", "success");
  }
  redirect("/");
}
