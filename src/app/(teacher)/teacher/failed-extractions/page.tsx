import PageIntro from "@/components/ui/PageIntro";
import { FailedExtractionsPanel } from "@/components/teacher/FailedExtractionsPanel";

/**
 * Dead-letter review surface (P2-1). Lists Sage background extractions
 * that exhausted their retries so staff can replay goal extractions or
 * dismiss the failure. Reachable from the teacher nav ("AI Review",
 * last entry in STAFF_ITEMS) — a low-traffic operations page, but a
 * discoverable one.
 */
export default function FailedExtractionsPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Teacher tools"
        title="Failed AI extractions"
        description="When Sage's background analysis fails after retries, the conversation snapshot is saved here so nothing is lost. Replay goal extractions or dismiss failures you've handled."
      />
      <FailedExtractionsPanel />
    </div>
  );
}
