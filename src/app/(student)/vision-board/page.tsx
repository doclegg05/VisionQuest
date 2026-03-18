import PageIntro from "@/components/ui/PageIntro";
import VisionBoard from "@/components/vision-board/VisionBoard";

export default function VisionBoardPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Dream big"
        title="Vision Board"
        description="Pin your dreams, goals, and inspirations. Drag items to arrange them however you like."
      />
      <VisionBoard />
    </div>
  );
}
