import ClassRosterManager from "@/components/teacher/ClassRosterManager";
import PageIntro from "@/components/ui/PageIntro";

export default function TeacherClassesPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Teacher tools"
        title="Classes"
        description="Invite new students during orientation, review who has claimed access, and archive class enrollments when students leave the roster."
      />
      <ClassRosterManager />
    </div>
  );
}
