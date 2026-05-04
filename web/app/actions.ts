"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { logServerAction } from "@/lib/log";

export async function requestMagicLink(
  email: string,
): Promise<{ ok: boolean; message: string }> {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned.includes("@")) {
    return { ok: false, message: "Enter a valid email." };
  }

  // Check the email is in members without revealing existence in the error.
  const svc = createSupabaseServiceClient();
  const { data: member } = await svc
    .from("members")
    .select("id, active")
    .eq("email", cleaned)
    .maybeSingle();

  if (!member || !member.active) {
    await logServerAction("requestMagicLink", "no_action", `unknown email: ${cleaned}`);
    return {
      ok: false,
      message: "We don't have you on the roster — ask the operator to add you.",
    };
  }

  const sb = createSupabaseServerClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { error } = await sb.auth.signInWithOtp({
    email: cleaned,
    options: { emailRedirectTo: `${siteUrl}/auth/callback` },
  });

  if (error) {
    await logServerAction("requestMagicLink", "failure", cleaned, error.message);
    return { ok: false, message: "Could not send link — try again in a minute." };
  }

  await logServerAction("requestMagicLink", "success", cleaned);
  return { ok: true, message: "Check your inbox." };
}
