import CoursesHub from "@/components/lms/CoursesHub";
import PageIntro from "@/components/ui/PageIntro";

export default function CoursesPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="SPOKES Training Hub"
        title="Learning Platforms"
        description="Access certification prep, academic courses, and career training platforms. Platforms that match your goals are highlighted."
      />
      <CoursesHub />
    </div>
  );
}
