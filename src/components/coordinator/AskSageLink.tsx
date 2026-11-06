import Link from "next/link";
import { ChatCircle } from "@phosphor-icons/react/dist/ssr";

/** The coordinator workspace's way into Sage chat. Same page as the nav's Sage entry. */
export const COORDINATOR_CHAT_HREF = "/coordinator/chat";

export function AskSageLink() {
  return (
    <Link
      href={COORDINATOR_CHAT_HREF}
      className="primary-button inline-flex min-h-11 items-center gap-2 px-6 py-3 text-sm"
    >
      <ChatCircle size={18} weight="fill" aria-hidden="true" />
      Ask Sage
    </Link>
  );
}
