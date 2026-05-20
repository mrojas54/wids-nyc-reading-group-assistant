"use server";

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { logServerAction } from "@/lib/log";

/**
 * Build the site URL for magic-link redirects from the *actual* request
 * the user is browsing on. This makes sign-in work transparently on
 * Vercel preview deployments, custom domains, and localhost — without
 * needing per-environment NEXT_PUBLIC_SITE_URL gymnastics.
 *
 * Falls back to NEXT_PUBLIC_SITE_URL (then localhost) if headers are
 * unavailable, but in any normal Next.js server-action invocation the
 * headers() call returns the request's host/protocol.
 *
 * NOTE: Supabase's Auth → URL Configuration → Redirect URLs allowlist
 * MUST include each domain you want to redirect to. Add a wildcard
 * like https://*-michellerojas.vercel.app/** to cover preview deploys.
 */
async function deriveSiteUrl(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    if (host) return `${proto}://${host}`;
  } catch {
    // headers() throws if called outside a request context (e.g., in tests)
  }
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

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
      message:
        "We don't have you on the roster — contact Michelle at mirojas1524@gmail.com to be added.",
    };
  }

  const sb = await createSupabaseServerClient();
  const siteUrl = await deriveSiteUrl();
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
