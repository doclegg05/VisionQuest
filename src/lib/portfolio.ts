export const PORTFOLIO_ITEM_TYPES = [
  "project",
  "resume",
  "achievement",
  "skill",
  "certification",
  "other",
] as const;

export type PortfolioItemType = (typeof PORTFOLIO_ITEM_TYPES)[number];

const CANONICAL_TYPES = new Set<string>(PORTFOLIO_ITEM_TYPES);

const TYPE_ALIASES: Record<string, PortfolioItemType> = {
  award: "achievement",
  cert: "certification",
  certificate: "certification",
  credential: "certification",
  document: "other",
};

export function normalizePortfolioItemType(value: unknown): PortfolioItemType | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (CANONICAL_TYPES.has(normalized)) return normalized as PortfolioItemType;
  return TYPE_ALIASES[normalized];
}

export function fileCategoryForPortfolioType(type: PortfolioItemType): "portfolio" | "certification" | "resume" {
  if (type === "certification") return "certification";
  if (type === "resume") return "resume";
  return "portfolio";
}
