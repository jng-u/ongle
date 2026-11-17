// Constructed only after a nonempty search has remained idle for the debounce.
const makeWorker = () => new Worker(new URL('./drugSearchWorker.js', import.meta.url), {type: 'module'});

export function createDrugSearchClient(onChange, {createWorker = makeWorker, debounceMs = 250, timeoutMs = 30000} = {}) {
  let worker;
  let debounce;
  let timeout;
  let requestId = 0;
  let query = '';
  let disposed = false;
  const publish = (results, busy = false, error = '') => onChange({query, results, busy, error});
  const fail = () => {
    clearTimeout(timeout);
    worker?.terminate(); worker = undefined;
    if (!disposed) publish([], false, '약 목록을 불러오지 못했어요. 직접 입력하거나 다시 검색해 주세요.');
  };
  return {
    search(value) {
      if (disposed) return;
      query = value;
      const id = ++requestId; // Invalidate in-flight results immediately, before debounce.
      clearTimeout(debounce); clearTimeout(timeout);
      publish([], !!query.trim());
      if (!query.trim()) return;
      debounce = setTimeout(() => {
        try {
          if (!worker) {
            worker = createWorker();
            worker.onmessage = ({data}) => {
              if (disposed || data.requestId !== requestId) return;
              clearTimeout(timeout);
              publish(data.results || [], false, data.error || '');
            };
            worker.onerror = fail;
            worker.onmessageerror = fail;
          }
          timeout = setTimeout(fail, timeoutMs);
          worker.postMessage({requestId: id, query});
        } catch {fail();}
      }, debounceMs);
    },
    dispose() {
      disposed = true; ++requestId;
      clearTimeout(debounce); clearTimeout(timeout);
      worker?.terminate(); worker = undefined;
    },
  };
}
