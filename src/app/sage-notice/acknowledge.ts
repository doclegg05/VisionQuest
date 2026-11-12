/**
 * What the tap on "I Understand" came to. POST /api/sage-notice answers 400
 * when the version in the body is not the current one (the notice changed
 * after this tab loaded) and 401 when the session has ended.
 */
export type AckOutcome = "saved" | "stale" | "signed-out" | "failed";

/** The two router calls an outcome needs. Next's useRouter() satisfies it. */
export interface AckRouter {
  replace(path: string): void;
  refresh(): void;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function outcomeForStatus(status: number): AckOutcome {
  if (status >= 200 && status < 300) return "saved";
  if (status === 400) return "stale";
  if (status === 401) return "signed-out";
  return "failed";
}

/**
 * `version` is the one the server rendered this page with, passed down as a
 * prop, so a refresh after a stale answer sends what the student now reads.
 */
export async function postAcknowledgement(version: string, fetchImpl: FetchLike = fetch): Promise<AckOutcome> {
  try {
    const res = await fetchImpl("/api/sage-notice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    });
    return outcomeForStatus(res.status);
  } catch {
    // A network failure: the student sees SAGE_NOTICE_ACK_FAILED and can tap again.
    return "failed";
  }
}

/**
 * Saved: go on to the app, and refresh so nothing rendered for the held
 * session survives (the layout may ask for recovery questions next).
 * Stale: re-render this page so it shows the current notice.
 */
export function followOutcome(outcome: AckOutcome, router: AckRouter): void {
  if (outcome === "saved") {
    // replace() so Back does not return here.
    router.replace("/dashboard");
    router.refresh();
  } else if (outcome === "stale") {
    router.refresh();
  }
}
