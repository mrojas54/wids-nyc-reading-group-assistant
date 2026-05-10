import { UnauthorizedError, ForbiddenError } from "@/lib/suggest/types";

export type LeaderRoleContext = {
  userId: string;
  role: "leader" | "admin";
};

export async function requireLeaderRole(): Promise<LeaderRoleContext> {
  // Import lazily inside the function so this module can be unit-tested
  // by stubbing the import (or simply not imported in non-server contexts).
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();

  const { data: member, error } = await supabase
    .from("members")
    .select("role")
    .eq("id", user.id)
    .single();
  if (error || !member) throw new ForbiddenError();
  if (!["leader", "admin"].includes(member.role)) throw new ForbiddenError();
  return { userId: user.id, role: member.role as "leader" | "admin" };
}
