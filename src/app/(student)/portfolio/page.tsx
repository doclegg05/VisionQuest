import PortfolioPage from "@/components/portfolio/PortfolioPage";
import PageIntro from "@/components/ui/PageIntro";

export default function Portfolio() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Career story"
        title="Portfolio"
        description="Showcase your work, certifications, and build a resume you can share with confidence."
      />
      <PortfolioPage />
    </div>
  );
}
