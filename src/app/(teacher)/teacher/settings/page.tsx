import { getSession } from "@/lib/auth";
import { SettingsView } from "@/components/settings/SettingsView";

// Staff settings. This route exists because the (teacher) layout admits
// teacher and admin — matching the withTeacherAuth gate on the MFA endpoints
// StaffMfaPanel calls — while the (student) layout redirects both roles away
// from /settings before the panel can render.
export default async function StaffSettingsPage() {
  const session = await getSession();
  return <SettingsView initialRole={session?.role ?? null} />;
}
