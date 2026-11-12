import type { QueueReloadHooks } from "./queue-undo";

/** What one load of the intervention queue needs. The panel supplies these; nothing here touches React. */
export interface QueueLoadSteps<Rows> {
  /** The Undo flow's side of the load. */
  reload: QueueReloadHooks;
  /** False once a newer load, or a class change, has replaced this one. */
  isLatest: () => boolean;
  /** Fetches the rows. Rejects when the load fails. */
  fetchRows: () => Promise<Rows>;
  /** Puts the rows on screen. */
  show: (rows: Rows) => void;
  /** Shows that the load failed. */
  fail: () => void;
}

/**
 * One load of the intervention queue. Returns the rows, or null when the load failed.
 *
 * Only the newest load that worked shows its rows, and only that load tells the Undo flow, with the token it took
 * before its request left. So a load that began before a Resolved or Dismiss cannot clear that action's done line or
 * its Undo, and a load that was replaced, or failed, clears nothing at all.
 */
export async function runQueueLoad<Rows>(steps: QueueLoadSteps<Rows>): Promise<Rows | null> {
  const token = steps.reload.beginReload();
  let rows: Rows;
  try {
    rows = await steps.fetchRows();
  } catch {
    if (steps.isLatest()) steps.fail();
    return null;
  }
  if (steps.isLatest()) {
    steps.show(rows);
    steps.reload.reloaded(token);
  }
  return rows;
}
