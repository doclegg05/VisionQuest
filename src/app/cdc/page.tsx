import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// Phase 1 stub — real CDC workspace ships after Phase 5.
// Exists so `getRoleHomePath("cdc")` does not 404 when a Career Development
// Consultant logs in. Not linked from any NavBar.
// Delete this file when the real CDC route group is added.

export default async function CdcStubPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "cdc" && session.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-bold text-[var(--ink-strong)]">
        Career Development Consultant workspace — coming soon
      </h1>
      <p className="mt-4 text-sm text-[var(--ink-muted)]">
        The CDC workspace is planned for a future phase of the VisionQuest redesign.
        You will see your rotation schedule, multi-classroom job-readiness views,
        and resume/interview support tools here once it ships.
      </p>
    </main>
  );
}
