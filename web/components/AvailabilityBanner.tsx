import Link from "next/link";
import { Icon } from "@/components/ui";

const TYPE_LABEL: Record<string, string> = {
  admin: "admin",
  reading_group: "reading group",
};

export function AvailabilityBanner({ meetingType }: { meetingType: string }) {
  const label = TYPE_LABEL[meetingType] ?? meetingType.replace("_", " ");
  return (
    <Link href="/availability" className="banner banner-warning availability-banner">
      <div className="availability-banner-body">
        <strong className="banner-title">Submit your availability</strong>
        <span>for the {label} meeting</span>
      </div>
      <Icon name="arrowRight" size={16} aria-hidden />
    </Link>
  );
}
