import { SettingsView } from "@/components/settings/SettingsView";

// Student settings. The view is shared with /teacher/settings — see
// SettingsView's doc block for why it cannot live in this route group.
export default function SettingsPage() {
  return <SettingsView />;
}
