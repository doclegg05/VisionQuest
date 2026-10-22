/** Serialize Mac inference and let chat interrupt an uncommitted extraction.
 * Only pure, non-streaming model computation may restart. Once response headers
 * are committed, or the caller disconnects/times out, it is never replayed.
 */
export function createInferenceQueue({ backgroundGraceMs = 10_000, preemptBackground = false } = {}) {
  const waiting = [];
  let running;
  let wakeup;

  function finish(job, error, value) {
    job.signal.removeEventListener("abort", job.cancel);
    if (error) job.reject(error); else job.resolve(value);
  }

  function drain() {
    clearTimeout(wakeup);
    if (running || waiting.length === 0) return;
    const interactive = waiting.findIndex((job) => job.interactive);
    if (interactive < 0) {
      const delay = waiting[0].readyAt - Date.now();
      if (delay > 0) {
        wakeup = setTimeout(drain, delay);
        wakeup.unref();
        return;
      }
    }
    const [job] = waiting.splice(interactive < 0 ? 0 : interactive, 1);
    running = job;
    job.attempt = new AbortController();
    job.preempted = false;
    job.committed = false;
    Promise.resolve().then(() => {
      job.signal.throwIfAborted();
      return job.task({
        signal: job.attempt.signal,
        commit: () => {
          job.attempt.signal.throwIfAborted();
          job.committed = true;
        },
      });
    }).then(
      (value) => finish(job, null, value),
      (error) => {
        if (job.preempted && !job.committed && !job.signal.aborted) {
          job.readyAt = Date.now() + backgroundGraceMs;
          waiting.unshift(job);
        } else finish(job, error);
      },
    ).finally(() => { running = undefined; drain(); });
  }

  return function enqueue(task, { signal, interactive }) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const job = { task, signal, interactive, resolve, reject,
        readyAt: Date.now() + (interactive ? 0 : backgroundGraceMs) };
      job.cancel = () => {
        const index = waiting.indexOf(job);
        if (index >= 0) {
          waiting.splice(index, 1);
          finish(job, signal.reason);
        }
        if (running === job) job.attempt.abort(signal.reason);
        drain();
      };
      signal.addEventListener("abort", job.cancel, { once: true });
      waiting.push(job);
      if (interactive && preemptBackground && running && !running.interactive && !running.committed) {
        running.preempted = true;
        running.attempt.abort(new Error("Interactive inference has priority"));
      }
      drain();
    });
  };
}
