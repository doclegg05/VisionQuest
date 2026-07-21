import { redirect } from "next/navigation";

/**
 * The classic dashboard was retired after its one-release grace window
 * (chat-first home shipped 2026-06). The route stays as a redirect so old
 * bookmarks and links keep working.
 */
export default function ClassicDashboardRedirect() {
  redirect("/dashboard");
}
