// /papers — Paper Pal Inbox (chapter reading queue).
// Four sections: current reading, upcoming picks, want-to-lead suggestions,
// recently discussed. Reads live Supabase via the existing RLS-bound
// server client; no authentication beyond what the layout enforces.
import InboxScreen from "@/components/paperpal/inbox/InboxScreen";

export const dynamic = "force-dynamic";

export default async function PapersInboxPage() {
  return <InboxScreen />;
}
