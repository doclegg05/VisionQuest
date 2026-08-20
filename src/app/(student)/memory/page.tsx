import PageIntro from "@/components/ui/PageIntro";
import { SageMemoryPanel } from "@/components/student/SageMemoryPanel";

export default function MemoryPage() {
  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Sage Memory"
        title="What Sage Remembers About You"
        description="Sage is your AI coach. It keeps short notes from your chats so it can help you better next time."
      />

      <div className="surface-section mb-6 p-6">
        <h2 className="page-eyebrow text-[var(--ink-muted)]">Where these notes come from</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
          Sage writes a short note after some of your chats. This helps Sage remember your goals
          and what you are working on, so it does not have to ask you the same question twice.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
          See something that is wrong below? Tell your teacher. They can fix it or take it out.
          Teachers can already see and correct these notes, the same way they can for every
          student.
        </p>
      </div>

      <SageMemoryPanel />
    </div>
  );
}
