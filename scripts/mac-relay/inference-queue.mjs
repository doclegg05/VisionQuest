/** Keep extraction fan-out out of Ollama's FIFO queue so chat can go next.
 * No work is replayed, cached, or discarded. The caller's existing deadline
 * and disconnect cancellation apply while waiting as well as while running.
 */
export function createInferenceQueue() {
  const waiting = [];
  let running = false;

  function drain() {
    if (running || waiting.length === 0) return;
    const interactive = waiting.findIndex((job) => job.interactive);
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
      const job = { task, signal, interactive, resolve, reject, cancel: undefined };
      job.cancel = () => {
        const index = waiting.indexOf(job);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason);
      };
      signal.addEventListener("abort", job.cancel, { once: true });
      waiting.push(job);
      drain();
    });
  };
}
