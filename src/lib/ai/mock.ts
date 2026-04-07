import type { AIProvider, ChatMessage } from "./types";
import { validateMessages } from "./types";

const MOCK_RESPONSE =
  "I hear you, and that is completely valid. Let us work through this together, one step at a time. What feels most important to you right now?";

const MOCK_GOAL_EXTRACTION = JSON.stringify({
  goals_found: [],
  stage_complete: false,
});

const MOCK_MOOD_EXTRACTION = JSON.stringify({
  scores: [],
});

export class MockProvider implements AIProvider {
  readonly modelName = "mock";

  async generateResponse(
    _systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    validateMessages(messages);
    return MOCK_RESPONSE;
  }

  async *streamResponse(
    _systemPrompt: string,
    messages: ChatMessage[],
    _signal?: AbortSignal,
  ): AsyncGenerator<string> {
    validateMessages(messages);
    const words = MOCK_RESPONSE.split(" ");
    for (const word of words) {
      yield word + " ";
    }
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    validateMessages(messages);
    // Return goal extraction or mood extraction based on system prompt content
    if (systemPrompt.includes("mood") || systemPrompt.includes("motivation")) {
      return MOCK_MOOD_EXTRACTION;
    }
    return MOCK_GOAL_EXTRACTION;
  }
}
