// Keep requests recoverable after worker startup, execution, or message-decoding failures.
export function createWorkerClient(createWorker) {
  let worker = null;
  let nextId = 0;
  const pending = new Map();
  function dispose(error = new DOMException('Task cancelled', 'AbortError')) {
    const old = worker;
    worker = null;
    if (old) {
      old.onmessage = old.onerror = old.onmessageerror = null;
      old.terminate();
    }
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  }
  function ensureWorker() {
    if (worker) return worker;
    const current = createWorker();
    worker = current;
    current.onmessage = ({ data }) => {
      if (worker !== current) return;
      const { id, type, payload } = data || {};
      const entry = pending.get(id);
      if (!entry) return;
      if (type === 'progress') { entry.onProgress?.(payload); return; }
      pending.delete(id);
      if (type === 'result') entry.resolve(payload);
      else {
        const error = new Error(String(payload || `Unexpected worker response: ${type}`));
        // A simulation error is not evidence that workers are unavailable: do not rerun it locally.
        if (type === 'error') error.name = 'WorkerTaskError';
        entry.reject(error);
      }
    };
    current.onerror = (event) => {
      if (worker === current) dispose(new Error(event.message || 'Worker failed'));
    };
    current.onmessageerror = () => {
      if (worker === current) dispose(new Error('Could not decode the worker response'));
    };
    return current;
  }
  function ask(type, payload, onProgress) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      try {
        const current = ensureWorker();
        pending.set(id, { resolve, reject, onProgress });
        current.postMessage({ id, type, payload });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }
  return { ask, dispose };
}
