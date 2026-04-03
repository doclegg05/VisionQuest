export type Role = "student" | "teacher" | "admin";

export type AuditLevel = "none" | "basic" | "full";

export type ToolNamespace =
  | "auth"
  | "sage"
  | "goals"
  | "orientation"
  | "certifications"
  | "portfolio"
  | "career"
  | "advising"
  | "files"
  | "learning"
  | "notifications"
  | "progression"
  | "admin"
  | "reports"
  | "classes"
  | "spokes";

export interface ToolDefinition {
  /** Unique identifier: "namespace.action" (e.g., "sage.chat", "goals.create") */
  id: string;

  /** Feature area this belongs to */
  namespace: ToolNamespace;

  /** Human-readable name */
  name: string;

  /** What this capability does */
  description: string;

  /** HTTP method + path pattern */
  endpoint?: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
  };

  /** Which roles can use this capability */
  requiredRoles: Role[];

  /** Optional feature flag — if set and disabled, capability is unavailable */
  featureFlag?: string;

  /** Max tokens per invocation (for AI-powered capabilities) */
  tokenBudget?: number;

  /** Compliance logging tier */
  auditLevel: AuditLevel;

  /** Per-user rate limit */
  rateLimit?: {
    maxPerHour?: number;
    maxPerDay?: number;
  };

  /** Whether this capability is currently enabled */
  enabled: boolean;

  /** What data context must be loaded before invoking */
  requiresContext?: string[];

  /** Tags for filtering and grouping */
  tags?: string[];
}
