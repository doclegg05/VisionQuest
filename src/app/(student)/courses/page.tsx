import CoursesHub from "@/components/lms/CoursesHub";
import PageIntro from "@/components/ui/PageIntro";

export default function CoursesPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Learning hub"
        title="Courses"
        description="Training programs, certifications, and learning resources curated by your teacher."
      />
      <CoursesHub />
    </div>
  );
}
