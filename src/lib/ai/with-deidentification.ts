/**
 * De-identification decorator over `AIProvider`: a structural copy of
 * `withUsageLogging` (src/lib/llm-usage.ts) that pseudonymizes everything on
 * the way out and re-hydrates everything on the way back in, using one
 * per-request `TokenVault` (./deidentify.ts).
 *
 * Outbound: EVERYTHING the model is shown first passes through
 * `neutralizeTokenShapes`, then `pseudonymize`. That includes the system
 * prompt and the results a tool hands back, not only `role: "user"` messages.
 *
 * The original version neutralised user messages alone, on the reasoning that
 * the app authors the system prompt. That premise is false and the 2026-09-07
 * security audit executed it: the system prompt INTERPOLATES student-authored
 * free text — goal titles, memories, case-note bodies, recent-activity lines —
 * and `streamWithTools` hands the same student data back through the tool
 * result. A student who named a goal `[PERSON_1]` had forged a re-hydration
 * site, and the model's echo came back as a classmate's real name. The rule is
 * therefore about PROVENANCE, not about which parameter carries the string:
 * any text that can contain something a person typed is neutralised, and only
 * tokens this vault issued after that survive to be restored.
 *
 * `neutralizeTokenShapes` deliberately exempts `_START`/`_END` fences, which
 * the app's own grounding blocks use (`briefing.ts`, `tailor-application.ts`),
 * so applying it to the system prompt does not disturb them.
 *
 * Inbound: `generateResponse` re-hydrates the reply; `streamResponse` runs the
 * chunks through the vault's carry buffer so a token split across chunks is
 * still restored and a half token is never emitted; `generateStructuredResponse`
 * re-hydrates with JSON escaping so the reply stays parseable whatever the
 * values contain. `streamWithTools` re-hydrates tool args BEFORE the tool runs,
 * pseudonymizes what the tool hands back to the model, and gives the caller
 * the tool's own result (keyed by callId) on the `tool_result` event.
 *
 * On a provider error mid-stream the carry is dropped, never flushed: it can
 * only ever hold a partial token, and re-hydrated values never enter it.
 *
 * `streamWithTools` is capability-detected exactly like `withUsageLogging`, so
 * `Boolean(provider.streamWithTools)` stays truthful through the wrapper.
 * An empty vault returns the original provider object — the no-identity path
 * costs nothing.
 *
 * No logger, no Prisma: nothing here may ever log a vault value.
 */

import { neutralizeTokenShapes, type TokenVault } from "./deidentify";
import type {
  AIProvider,
  ChatMessage,
  GenerationOptions,
  OnUsage,
  ToolCallHandler,
  ToolDeclaration,
  ToolStreamEvent,
  ToolStreamOptions,
} from "./types";

type ToolHandlerResult = Awaited<ReturnType<ToolCallHandler>>;

export function withDeidentification(provider: AIProvider, vault: TokenVault): AIProvider {
  if (vault.isEmpty) return provider;

  /**
   * The one outbound transform: neutralise any token shape already in the
   * text, then substitute. Applied to every string the model is shown.
   */
  const outbound = (text: string): string => vault.pseudonymize(neutralizeTokenShapes(text));

  /** Same rule, over the string leaves of a JSON-ish tool result, one pass. */
  const outboundValue = (value: unknown): unknown => vault.mapStrings(value, outbound);

  const outboundMessages = (messages: ChatMessage[]): ChatMessage[] =>
    messages.map((message) => ({ ...message, content: outbound(message.content) }));

  const wrapped: AIProvider = {
    name: provider.name,

    async generateResponse(
      systemPrompt: string,
      messages: ChatMessage[],
      onUsage?: OnUsage,
      options?: GenerationOptions,
    ): Promise<string> {
      const reply = await provider.generateResponse(
        outbound(systemPrompt),
        outboundMessages(messages),
        onUsage,
        options,
      );
      return vault.rehydrate(reply);
    },

    async *streamResponse(
      systemPrompt: string,
      messages: ChatMessage[],
      onUsage?: OnUsage,
      options?: GenerationOptions,
    ): AsyncGenerator<string> {
      const carry = vault.createStreamRehydrator();
      for await (const chunk of provider.streamResponse(
        outbound(systemPrompt),
        outboundMessages(messages),
        onUsage,
        options,
      )) {
        const ready = carry.push(chunk);
        if (ready) yield ready;
      }
      // Reached only when the provider finished cleanly — a throw above
      // propagates past this line and the carry is dropped, never emitted.
      const rest = carry.flush();
      if (rest) yield rest;
    },

    async generateStructuredResponse(
      systemPrompt: string,
      messages: ChatMessage[],
      onUsage?: OnUsage,
      options?: GenerationOptions,
    ): Promise<string> {
      const raw = await provider.generateStructuredResponse(
        outbound(systemPrompt),
        outboundMessages(messages),
        onUsage,
        options,
      );
      return vault.rehydrate(raw, { json: true });
    },
  };

  if (provider.streamWithTools) {
    const innerStreamWithTools = provider.streamWithTools.bind(provider);
    wrapped.streamWithTools = async function* (
      systemPrompt: string,
      messages: ChatMessage[],
      tools: ToolDeclaration[],
      onToolCall: ToolCallHandler,
      options?: ToolStreamOptions,
    ): AsyncGenerator<ToolStreamEvent> {
      // The handler's own results, keyed by callId, so the caller's
      // tool_result carries exactly what the tool produced rather than a
      // pseudonymize/re-hydrate round trip of it.
      const handlerResults = new Map<string, ToolHandlerResult>();

      const guardedToolCall: ToolCallHandler = async (call) => {
        const result = await onToolCall({
          ...call,
          args: vault.rehydrateValue(call.args) as Record<string, unknown>,
        });
        handlerResults.set(call.callId, result);
        // A tool result is student data by another route: a goal titled
        // "[PERSON_1]" reaches the model here, not through a user message.
        return {
          ...result,
          response: outboundValue(result.response),
          summary: outbound(result.summary),
        };
      };

      const carry = vault.createStreamRehydrator();
      const stream = innerStreamWithTools(
        outbound(systemPrompt),
        outboundMessages(messages),
        tools,
        guardedToolCall,
        options,
      );

      for await (const event of stream) {
        if (event.kind === "text") {
          const ready = carry.push(event.text);
          if (ready) yield { kind: "text", text: ready };
          continue;
        }
        // Any non-text event ends the model's current text turn: release the
        // carry first so the caller sees text and tool cards in model order.
        const rest = carry.flush();
        if (rest) yield { kind: "text", text: rest };

        if (event.kind === "tool_call") {
          yield { ...event, args: vault.rehydrateValue(event.args) as Record<string, unknown> };
        } else if (event.kind === "tool_result") {
          const original = handlerResults.get(event.callId);
          yield original
            ? { ...event, summary: original.summary, response: original.response }
            : {
                ...event,
                summary: vault.rehydrate(event.summary),
                response: vault.rehydrateValue(event.response),
              };
        } else {
          yield event;
        }
      }
      const rest = carry.flush();
      if (rest) yield { kind: "text", text: rest };
    };
  }

  return wrapped;
}
