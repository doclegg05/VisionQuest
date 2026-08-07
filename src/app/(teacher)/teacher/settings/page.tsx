import { getSession } from "@/lib/auth";
import { SettingsView } from "@/components/settings/SettingsView";

// The (teacher) layout admits teacher and admin only, matching the
// withTeacherAuth gate on the MFA endpoints StaffMfaPanel calls.
export default async function StaffSettingsPage() {
  const session = await getSession();
  return <SettingsView initialRole={session?.role ?? null} />;
}
