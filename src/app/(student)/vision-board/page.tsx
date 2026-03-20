import PageIntro from "@/components/ui/PageIntro";
import VisionBoard from "@/components/vision-board/VisionBoard";

export default function VisionBoardPage() {
  return (
    <div className="page-shell page-shell-wide">
      <PageIntro
        eyebrow="Dream big"
        title="Vision Board"
        description="Pin your dreams, goals, and inspirations. Drag items to arrange them, then pull the corner grip to resize the board pieces the way you want."
      />
      <VisionBoard />
    </div>
  );
}
