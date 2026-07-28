export { getProvider, getPromptTier, resolveAiProvider } from "./provider";
export { LocalQualityFallbackProvider } from "./local-quality-fallback-provider";
export {
  classifyStudentChatTask,
  defaultTaskClass,
  isLocalTaskRoutingEnabled,
  isProtectedSensitivity,
  readLocalTaskRoutingConfig,
  selectLocalModel,
  DEFAULT_LOCAL_COACHING_MODEL,
  DEFAULT_LOCAL_SPEED_MODEL,
  DEFAULT_LOCAL_QUALITY_MODEL,
} from "./task-router";
export type {
  LocalModelDecision,
  LocalModelTier,
  LocalTaskRoutingConfig,
} from "./task-router";
export { checkOllamaHealth } from "./health";
export { detectModelCapabilities } from "./capabilities";
export type { ModelCapabilities, DetectCapabilitiesConfig } from "./capabilities";
export {
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  readLocalAiProviderConfig,
  toLocalAiAuthConfig,
  resolveLocalAiApiStyle,
} from "./local-config";
export { DEFAULT_LOCAL_AI_AUTH_MODE, resolveLocalAiAuthMode } from "./local-auth";
export { resolveEmbeddingProvider, getActiveEmbeddingModel } from "./embedding-provider";
export { EMBEDDING_DIMENSIONS } from "./embedding-types";
export { embedTexts, embedQuery, toVectorLiteral } from "./embeddings";
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
  LocalAiApiStyle,
  LocalRoutingContext,
  LocalRoutingMetadata,
  LocalTaskClass,
  PromptTier,
} from "./types";
export type { EmbeddingProvider, EmbeddingTaskType } from "./embedding-types";
export type { EmbeddingUsageContext } from "./embeddings";
