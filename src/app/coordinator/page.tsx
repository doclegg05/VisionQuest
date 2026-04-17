import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// Phase 1 stub — real coordinator dashboard ships in Phase 5.
// Exists so `getRoleHomePath("coordinator")` does not 404 when a coordinator
// logs in. Not linked from any NavBar; reachable only via role-based redirect.
// Delete this file in Phase 5 when the real route group is added.

export default async function CoordinatorStubPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "coordinator" && session.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-bold text-[var(--ink-strong)]">
        Coordinator workspace — coming soon
      </h1>
      <p className="mt-4 text-sm text-[var(--ink-muted)]">
        The regional coordinator dashboard is planned for Phase 5 of the VisionQuest
        redesign. You will see classroom rollups, instructor metrics, grant progress,
        and funder-ready exports here once it ships.
      </p>
    </main>
  );
}
