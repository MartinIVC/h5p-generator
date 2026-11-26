/**
 * frontend/js/editor/editorAutosave.js
 * Cola de autoguardado con debounce (350 ms), agrupación de ediciones repetidas,
 * serialización por expectedRevision, espera de flush y reintento ante errores.
 */
(function (root) {
  'use strict';

  const DEFAULT_DEBOUNCE_MS = 350;
  const MAX_BATCH_SIZE = 64;
  const STRUCTURAL_OPS = new Set(['addItem', 'removeItem', 'moveItem']);

  function coalesceKey(operation) {
    if (!operation || STRUCTURAL_OPS.has(operation.type)) return null;
    switch (operation.type) {
      case 'setTitle':
        return 'setTitle';
      case 'setItemText':
        return `setItemText:${operation.itemId}:${operation.field}`;
      case 'setOptionText':
        return `setOptionText:${operation.itemId}:${operation.optionId}`;
      case 'setCorrectOption':
        return `setCorrectOption:${operation.itemId}`;
      case 'setTrueFalseAnswer':
        return `setTrueFalseAnswer:${operation.itemId}`;
      case 'markItemReviewed':
        return `markItemReviewed:${operation.itemId}`;
      default:
        return null;
    }
  }

  function appendCoalesced(queue, operation) {
    const key = coalesceKey(operation);
    if (key) {
      // Solo agrupa con operaciones posteriores a la última operación estructural.
      for (let i = queue.length - 1; i >= 0; i--) {
        if (STRUCTURAL_OPS.has(queue[i].type)) break;
        if (coalesceKey(queue[i]) === key) {
          queue[i] = operation;
          return;
        }
      }
    }
    queue.push(operation);
  }

  function createAutosaveQueue({
    debounceMs = DEFAULT_DEBOUNCE_MS,
    getRevision,
    sendUpdate,
    onStateChange = () => {},
    onSynced = () => {},
    onError = () => {},
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id)
  }) {
    let pending = [];
    let failedBatch = [];
    let timerId = null;
    let inFlight = null;
    let destroyed = false;
    let generation = 0;

    function cancelTimer() {
      if (timerId !== null) {
        clearTimer(timerId);
        timerId = null;
      }
    }

    function schedule() {
      cancelTimer();
      timerId = setTimer(() => {
        timerId = null;
        void drain();
      }, debounceMs);
    }

    async function drain() {
      if (destroyed) return { ok: false, code: 'DESTROYED' };
      if (inFlight) return inFlight;

      const runGeneration = generation;
      inFlight = (async () => {
        let lastResult = { ok: true };
        while (!destroyed && runGeneration === generation) {
          const sourceQueue = failedBatch.length > 0 ? [...failedBatch, ...pending] : [...pending];
          if (sourceQueue.length === 0) break;

          const batch = sourceQueue.slice(0, MAX_BATCH_SIZE);
          const rest = sourceQueue.slice(MAX_BATCH_SIZE);
          failedBatch = [];
          pending = rest;

          onStateChange('saving');
          let response;
          try {
            response = await sendUpdate({
              expectedRevision: getRevision(),
              operations: batch
            });
          } catch {
            response = {
              status: 'error',
              code: 'PERSISTENCE_FAILED',
              message: 'No se pudo guardar el borrador editable. Conserva esta ventana abierta e inténtalo de nuevo.'
            };
          }

          if (destroyed || runGeneration !== generation) {
            return { ok: false, code: 'RESET' };
          }

          if (!response || response.status !== 'ok') {
            // Conserva el lote fallido por delante de cualquier edición nueva para reintentar sin perder texto.
            const combined = [...batch];
            for (const op of pending) appendCoalesced(combined, op);
            failedBatch = combined;
            pending = [];
            onStateChange('error', response?.message || 'No se pudo guardar el borrador.');
            onError(response || { status: 'error', code: 'PERSISTENCE_FAILED' });
            return { ok: false, error: response || { status: 'error', code: 'PERSISTENCE_FAILED' } };
          }

          onSynced(response, batch);
          lastResult = { ok: true, response };
        }

        if (!destroyed && runGeneration === generation && failedBatch.length === 0 && pending.length === 0) {
          onStateChange('saved');
        }
        return lastResult;
      })();

      try {
        return await inFlight;
      } finally {
        inFlight = null;
        if (!destroyed && runGeneration === generation && pending.length > 0 && failedBatch.length === 0 && timerId === null) {
          schedule();
        }
      }
    }

    function enqueue(operation, { immediate = false } = {}) {
      if (destroyed) return;
      appendCoalesced(pending, operation);
      onStateChange('pending');
      if (immediate || pending.length >= MAX_BATCH_SIZE) {
        cancelTimer();
        void drain();
      } else {
        schedule();
      }
    }

    async function flush() {
      if (destroyed) return { ok: false, code: 'DESTROYED' };
      cancelTimer();
      while (inFlight || pending.length > 0 || failedBatch.length > 0) {
        const res = inFlight ? await inFlight : await drain();
        if (!res.ok) return res;
        if (!inFlight && pending.length === 0 && failedBatch.length === 0) {
          return res;
        }
      }
      return { ok: true };
    }

    async function retry() {
      if (destroyed) return { ok: false, code: 'DESTROYED' };
      cancelTimer();
      return drain();
    }

    function reset() {
      generation++;
      cancelTimer();
      pending = [];
      failedBatch = [];
    }

    function destroy() {
      destroyed = true;
      reset();
    }

    return {
      enqueue,
      flush,
      retry,
      reset,
      destroy,
      hasPending: () => pending.length > 0 || failedBatch.length > 0 || timerId !== null,
      hasFailed: () => failedBatch.length > 0,
      isSaving: () => inFlight !== null,
      getPendingCount: () => pending.length + failedBatch.length
    };
  }

  const api = {
    DEFAULT_DEBOUNCE_MS,
    MAX_BATCH_SIZE,
    createAutosaveQueue
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.H5PEditorAutosave = api;
  }
})(typeof window !== 'undefined' ? window : null);
