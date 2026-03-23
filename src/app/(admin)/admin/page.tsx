import ClassRosterManager from "@/components/teacher/ClassRosterManager";
import PageIntro from "@/components/ui/PageIntro";

export default function AdminSettingsPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Admin settings"
        title="Program Classes"
        description="Create SPOKES classes, assign instructors, manage orientation invites, and archive class enrollments without deleting student history."
      />
      <ClassRosterManager adminMode />
    </div>
  );
}
