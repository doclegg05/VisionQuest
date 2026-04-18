import ChatWindow from "@/components/chat/ChatWindow";
import PageIntro from "@/components/ui/PageIntro";

export default function AdminChatPage() {
  return (
    <div className="page-shell page-shell-wide">
      <PageIntro
        eyebrow="Sage for admins"
        title="Review program health with Sage"
        description="Check usage, explore outcomes, generate reports, and audit activity. Slash commands help — try /usage or /outcomes."
      />
      <div className="surface-section overflow-hidden p-0">
        <ChatWindow role="admin" defaultStage="admin_assistant" />
      </div>
    </div>
  );
}
