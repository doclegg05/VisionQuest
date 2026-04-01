import PageIntro from "@/components/ui/PageIntro";
import TeacherOrientationWorkspace from "@/components/teacher/TeacherOrientationWorkspace";

export default function TeacherOrientationPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Teacher tools"
        title="Student Orientation"
        description="Work through the student orientation experience from your account and save progress directly to a selected student."
      />
      <TeacherOrientationWorkspace />
    </div>
  );
}
