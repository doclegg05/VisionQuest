/** Keep extraction fan-out out of Ollama's FIFO queue so chat can go next.
 * No work is replayed, cached, or discarded. The caller's existing deadline
 * and disconnect cancellation apply while waiting as well as while running.
 */
export function createInferenceQueue({ backgroundGraceMs = 10_000 } = {}) {
  const waiting = [];
  let running = false;
  let wakeup;

  function drain() {
    clearTimeout(wakeup);
    if (running || waiting.length === 0) return;
    const interactive = waiting.findIndex((job) => job.interactive);
    // Give the next chat a brief chance to arrive before extraction starts.
    // Each job's grace is measured from arrival, never reset by later chats.
    // This adds at most one grace period to an extraction burst, not one per
    // extractor, and never extends the request's original deadline.
    if (interactive < 0) {
      const delay = waiting[0].readyAt - Date.now();
      if (delay > 0) {
        wakeup = setTimeout(drain, delay);
        wakeup.unref();
        return;
      }
    }
    const [job] = waiting.splice(interactive < 0 ? 0 : interactive, 1);
    job.signal.removeEventListener("abort", job.cancel);
    running = true;
    Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
      running = false;
      drain();
    });
  }

  return function enqueue(task, { signal, interactive }) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const job = { task, signal, interactive, resolve, reject,
        readyAt: Date.now() + (interactive ? 0 : backgroundGraceMs), cancel: undefined };
      job.cancel = () => {
        const index = waiting.indexOf(job);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason);
        drain();
      };
      signal.addEventListener("abort", job.cancel, { once: true });
      waiting.push(job);
      drain();
    });
  };
}
