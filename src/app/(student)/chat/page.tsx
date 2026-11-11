import ChatWindow from "@/components/chat/ChatWindow";
import PageIntro from "@/components/ui/PageIntro";
import { isChatProviderLocal } from "@/lib/ai/provider";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";

/**
 * Only a boolean reaches the client. If the setting cannot be read, the chat
 * keeps today's behavior (the canned opener) rather than failing the page.
 */
async function readLocalProvider(): Promise<boolean> {
  try {
    return await isChatProviderLocal();
  } catch (error) {
    logger.warn("Chat page could not read the AI provider setting", { error: errorForLog(error) });
    return false;
  }
}

export default async function ChatPage() {
  const localProvider = await readLocalProvider();
  return (
    <div className="page-shell page-shell-wide">
      <PageIntro
        eyebrow="Sage coaching"
        title="Talk through the next step"
        description="Talk with Sage to sort out your goals and get past blockers. Leave with a plan for today."
      />
      <div className="surface-section overflow-hidden p-0">
        <ChatWindow localProvider={localProvider} />
      </div>
    </div>
  );
}
