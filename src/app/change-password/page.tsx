import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getRoleHomePath } from "@/lib/role-home";
import { ChangePasswordScreen } from "@/components/settings/ChangePasswordScreen";

// The forced password change. Staff create student accounts and reset
// passwords in person, so until the student picks a new one a staff member
// knows it. src/proxy.ts sends every page such a session asks for to this
// one, and refuses its API calls, until the password is changed
// (src/lib/password-change-gate.ts). This page lives OUTSIDE the (student)
// route group, as /recovery-setup does, so that layout's redirects cannot
// loop through it. Recovery questions come after: the student layout asks
// for them once this step is done.
export default async function ChangePasswordPage() {
  const session = await getSession();
  // The sign-in page is the one page a held session whose token has since
  // ended can still reach, so this cannot circle back here.
  if (!session) redirect("/");
  if (session.role !== "student") redirect(getRoleHomePath(session.role));
  // A demo account has no password to change.
  if (session.demoAccount !== undefined) redirect("/dashboard");
  // Nothing to force: the same form is a section of Settings.
  if (!session.mustChangePassword) redirect("/settings");

  return (
    <main id="main-content" className="min-h-screen bg-[var(--surface-muted)] px-4 py-10">
      <div className="mx-auto max-w-lg">
        <ChangePasswordScreen />
      </div>
    </main>
  );
}
