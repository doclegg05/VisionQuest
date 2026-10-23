/** Prepare the real demo-role instruction/tool prefixes with synthetic inputs.
 * This never executes tools, reads student records, or stores a conversation.
 * stream:false makes preparation interruptible by interactive chat at the Mac.
 */
import { buildCacheableSystemPrompt } from "./system-prompts";
import { getEnabledTools, toolsForTurn } from "./agent/tools";
import { usesMacPromptCache, MAC_MLX_MODEL } from "@/lib/ai/local-model";
import { assertLocalDemoTarget } from "@/lib/ai/demo-local-only";
import { logAiAuditEvent } from "@/lib/ai/audit";
import { logLlmCall } from "@/lib/llm-usage";
import { logger } from "@/lib/logger";
import { errorForLog } from "@/lib/log-error";

export function buildMacWarmupRequests() {
  return (["student", "teacher"] as const).flatMap(role => ["Amber", "Boris"].map(name => {
    const prompt = buildCacheableSystemPrompt(role === "student" ? "discovery" : "teacher_assistant",
      { studentName: name, programType: "spokes", userMessage: "Hello" }, "compact");
    return {
      model: MAC_MLX_MODEL, think: false, stream: false, keep_alive: "-1s",
      messages: [
        { role: "system", content: prompt.text.slice(0, prompt.systemPrefixLength) },
        { role: "system", content: prompt.text.slice(prompt.systemPrefixLength) },
        { role: "user", content: `${name}: hello` },
      ],
      tools: toolsForTurn(getEnabledTools(role), { hasAttachment: false }).map(tool => ({ type: "function", function: {
        name: tool.name, description: tool.description, parameters: tool.parameters,
      } })),
      options: { num_ctx: 16384, num_predict: 1, temperature: 0 },
    };
  }));
}

export async function warmMacSage(): Promise<void> {
  if (!usesMacPromptCache()) return;
  const origin = "http://127.0.0.1:11437";
  assertLocalDemoTarget(origin, MAC_MLX_MODEL);
  const token = process.env.VQ_MAC_RELAY_APP_TOKEN;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error("Mac warmup relay authentication is unavailable");
  for (const body of buildMacWarmupRequests()) {
    const audit = { route: "background:mac-prompt-warmup", task: "sage_student_chat" as const,
      sensitivity: "system" as const, policyDecision: "local_only" as const, providerName: "ollama",
      providerClass: "local" as const, allowCloud: false };
    await logAiAuditEvent({ ...audit, status: "routed", reason: "Synthetic prompt preparation; no student records or tools executed." });
    try {
      const response = await fetch(`${origin}/api/chat`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(180_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Mac prompt preparation deferred"); }
      const result = await response.json();
      if (result.error || !result.done) throw new Error("Mac prompt preparation incomplete");
      await logAiAuditEvent({ ...audit, status: "completed" });
      await logLlmCall({ studentId: null, callSite: "sage_mac_warmup", model: MAC_MLX_MODEL,
        inputTokens: result.prompt_eval_count ?? 0, outputTokens: result.eval_count ?? 0,
        totalTokens: (result.prompt_eval_count ?? 0) + (result.eval_count ?? 0) });
    } catch {
      await logAiAuditEvent({ ...audit, status: "failed", errorCode: "LOCAL_WARMUP_DEFERRED" });
      throw new Error("Mac prompt preparation deferred");
    }
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Refresh after restart and periodically, so runner restarts/eviction recover.
 * Retry failures without creating overlapping work or blocking server startup.
 */
export function startMacWarmup(): void {
  if (timer || !usesMacPromptCache()) return;
  const run = async () => {
    let delay = 15 * 60_000;
    try { await warmMacSage(); logger.info("Sage demo prompt preparation complete"); }
    catch (error) { delay = 60_000; logger.warn("Sage demo prompt preparation deferred", { error: errorForLog(error) }); }
    timer = setTimeout(() => { void run(); }, delay); timer.unref();
  };
  timer = setTimeout(() => { void run(); }, 10_000); timer.unref();
}
