import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { logServerAction } from "@/lib/log";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/", request.url));

  const sb = await createSupabaseServerClient();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    await logServerAction("authCallback", "failure", undefined, error.message);
    return NextResponse.redirect(new URL("/?err=auth", request.url));
  }

  // Link members.auth_user_id on first successful sign-in.
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (user?.email) {
    const svc = createSupabaseServiceClient();
    await svc
      .from("members")
      .update({ auth_user_id: user.id })
      .eq("email", user.email.toLowerCase())
      .is("auth_user_id", null);
  }

  await logServerAction("authCallback", "success", user?.email ?? "");
  return NextResponse.redirect(new URL("/dashboard", request.url));
}
