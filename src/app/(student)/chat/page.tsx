import ChatWindow from "@/components/chat/ChatWindow";
import PageIntro from "@/components/ui/PageIntro";

export default function ChatPage() {
  return (
    <div className="page-shell page-shell-wide">
      <PageIntro
        eyebrow="Sage coaching"
        title="Talk through the next step"
        description="Talk with Sage to sort out your goals and get past blockers. Leave with a plan for today."
      />
      <div className="surface-section overflow-hidden p-0">
        <ChatWindow />
      </div>
    </div>
  );
}
