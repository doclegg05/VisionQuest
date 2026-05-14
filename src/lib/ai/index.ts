export { getProvider, getPromptTier, resolveAiProvider } from "./provider";
export { checkOllamaHealth } from "./health";
export {
  DEFAULT_OLLAMA_MODEL,
  readLocalAiProviderConfig,
  toLocalAiAuthConfig,
} from "./local-config";
export { DEFAULT_LOCAL_AI_AUTH_MODE, resolveLocalAiAuthMode } from "./local-auth";
export type {
  AiTask,
  AIProvider,
  ChatMessage,
  AIProviderType,
  AIProviderConfig,
  AIProviderRequest,
  DataSensitivity,
  LocalAIAuthMode,
  LocalAIAuthConfig,
  PromptTier,
} from "./types";
