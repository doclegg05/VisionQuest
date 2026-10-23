export const DEFAULT_OLLAMA_MODEL = "gemma4:12b";
export const MAC_MLX_MODEL = "gemma4:12b-mlx";

/** Only two local variants of the approved 12B model; never a cloud tag. */
export function pinnedLocalModel(): string {
  if (process.env.VQ_MAC_RELAY_ENABLED !== "true") return DEFAULT_OLLAMA_MODEL;
  const selected = process.env.VQ_MAC_RELAY_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
  if (selected !== DEFAULT_OLLAMA_MODEL && selected !== MAC_MLX_MODEL) {
    throw new Error("Unsupported VisionQuest Mac model variant");
  }
  return selected;
}

export function usesMacPromptCache(): boolean {
  return process.env.VQ_MAC_RELAY_ENABLED === "true" && pinnedLocalModel() === MAC_MLX_MODEL;
}
