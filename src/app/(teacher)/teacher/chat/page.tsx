import ChatWindow from "@/components/chat/ChatWindow";
import PageIntro from "@/components/ui/PageIntro";

export default function TeacherChatPage() {
  return (
    <div className="page-shell page-shell-wide">
      <PageIntro
        eyebrow="Sage for instructors"
        title="Ask Sage about your class"
        description="Pull program details, plan interventions, or draft student communications. Slash commands help — try /class or /intervene."
      />
      <div className="surface-section overflow-hidden p-0">
        <ChatWindow role="teacher" defaultStage="teacher_assistant" />
      </div>
    </div>
  );
}
