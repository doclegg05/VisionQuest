import { apiFetch } from "@/lib/api";

/** Poll serially so slow responses cannot overlap or outlive their owner. */
export function startGoalPolling(
  previousCount: number,
  onCaptured: (level: string) => void,
): () => void {
  const controller = new AbortController();
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout>;

  async function poll() {
    attempts++;
    try {
      const response = await apiFetch("/api/goals", { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.ok) {
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (Array.isArray(data.goals) && data.goals.length > previousCount) {
          onCaptured(data.goals[data.goals.length - 1].level);
          return;
        }
      }
    } catch {
      // Goal extraction is best-effort; retry within the bounded budget.
    }
    if (!controller.signal.aborted && attempts < 5) {
      timer = setTimeout(poll, 3000);
    }
  }

  timer = setTimeout(poll, 3000);
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
