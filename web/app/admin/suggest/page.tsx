import { redirect } from "next/navigation";
import { requireLeaderRole } from "@/lib/auth/requireLeaderRole";
import { UnauthorizedError, ForbiddenError } from "@/lib/suggest/types";
import { SuggestForm } from "./SuggestForm";

export const dynamic = "force-dynamic";

export default async function SuggestPage() {
  try {
    await requireLeaderRole();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/auth");
    if (e instanceof ForbiddenError) redirect("/dashboard");
    throw e;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold mb-6">Suggest a paper</h1>
      <SuggestForm />
    </main>
  );
}
