import ChatWindow from "@/components/chat/ChatWindow";
import PageIntro from "@/components/ui/PageIntro";

export default function ChatPage() {
  return (
    <div className="page-shell page-shell-wide">
      <PageIntro
        eyebrow="Sage coaching"
        title="Talk through the next step"
        description="Use Sage to clarify goals, troubleshoot blockers, and turn intention into a plan you can act on today."
      />
      <div className="surface-section overflow-hidden p-0">
        <ChatWindow />
      </div>
    </div>
  );
}
