export {
  AI_DEIDENTIFY_CONFIG_KEY,
  AI_DEIDENTIFY_ENV,
  getPromptTier,
  resolveAiProvider,
} from "./provider";
export { TokenVault, neutralizeTokenShapes } from "./deidentify";
export type { IdentityInput, DeidentifyOptions } from "./deidentify";
export { DEIDENTIFY_ALLOWLIST } from "./deidentify-allowlist";
export { withDeidentification } from "./with-deidentification";
export {
  IDENTITY_CACHE_TTL_SECONDS,
  MANAGED_ROSTER_CAP,
  listManagedRosterNames,
  loadIdentityInput,
} from "./identity";
export { checkOllamaHealth } from "./health";
export {
  detectModelCapabilities,
  findMissingRoleModels,
  isModelInstalled,
} from "./capabilities";
export type { ModelCapabilities, DetectCapabilitiesConfig } from "./capabilities";
export {
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  readLocalAiProviderConfig,
  readLocalAiRoleModel,
  readLocalAiRoleModels,
  resolveRoleModel,
  toLocalAiAuthConfig,
  resolveLocalAiApiStyle,
} from "./local-config";
export {
  AI_ROLES,
  AI_ROLE_MODEL_CONFIG_KEYS,
  AI_ROLE_PROFILES,
  isAiRole,
  roleForTask,
} from "./roles";
export type { AiRole, AiRoleProfile } from "./roles";
export {
  AI_CLOUD_POLICIES,
  AiCloudRefusedError,
  DEFAULT_AI_CLOUD_POLICY,
  TASK_LANES,
  cloudRefusalReason,
  isLocalOnlySensitivity,
  laneForTask,
  parseAiCloudPolicy,
  readAiCloudPolicy,
} from "./lanes";
export type { AiCloudPolicy, AiLane } from "./lanes";
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
  PromptTier,
} from "./types";
export type { EmbeddingProvider, EmbeddingTaskType } from "./embedding-types";
export type { EmbeddingUsageContext } from "./embeddings";
