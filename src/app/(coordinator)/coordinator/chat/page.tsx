import ChatWindow from "@/components/chat/ChatWindow";
import PageIntro from "@/components/ui/PageIntro";

/**
 * Sage for both coordinator roles (owner decision, 2026-11-06). The
 * (coordinator) layout admits regional coordinators, program coordinators and
 * admins. The chat route picks the coordinator_assistant stage from the
 * session role, and coordinators get read-only tools only.
 */
export default function CoordinatorChatPage() {
  return (
    <div className="page-shell page-shell-wide">
      <PageIntro
        eyebrow="Sage for coordinators"
        title="Ask Sage about the program"
        description="Look up program rules, forms, and career facts, or see which students need attention. Sage cannot make changes from this account."
      />
      <div className="surface-section overflow-hidden p-0">
        <ChatWindow role="coordinator" defaultStage="coordinator_assistant" />
      </div>
    </div>
  );
}
