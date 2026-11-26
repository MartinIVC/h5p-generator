/**
 * frontend/js/editor/editorController.js
 * Controlador del Paso 3 ("Revisar y exportar"): coordina estado, cola de autoguardado,
 * renderizado accesible, confirmación global, empaquetado y guardado seguro.
 */
(function (root) {
  'use strict';

  function getStateApi() {
    if (root && root.H5PEditorState) return root.H5PEditorState;
    if (typeof require === 'function') return require('./editorState');
    throw new Error('H5PEditorState no está cargado.');
  }

  function getAutosaveApi() {
    if (root && root.H5PEditorAutosave) return root.H5PEditorAutosave;
    if (typeof require === 'function') return require('./editorAutosave');
    throw new Error('H5PEditorAutosave no está cargado.');
  }

  function getFormsApi() {
    if (root && root.H5PEditorForms) return root.H5PEditorForms;
    if (typeof require === 'function') return require('./editorForms');
    throw new Error('H5PEditorForms no está cargado.');
  }

  function sanitizeSuggestedFileName(title, activityType) {
    const defaults = {
      questionset: 'cuestionario',
      multichoice: 'opcion-multiple',
      truefalse: 'verdadero-falso'
    };
    const fallback = defaults[activityType] || 'actividad';
    if (typeof title !== 'string') return fallback;
    const cleaned = title
      .replace(/\.h5p$/i, '')
      .replace(/[\\/:*?"<>|\x00-\x1f\x7f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    if (!cleaned || cleaned === '.' || cleaned === '..') return fallback;
    return cleaned;
  }

  function isItemNonEmpty(item) {
    if (!item) return false;
    if (typeof item.question === 'string' && item.question.trim()) return true;
    if (typeof item.feedback === 'string' && item.feedback.trim()) return true;
    if (Array.isArray(item.options) && item.options.some(opt => String(opt.text || '').trim())) return true;
    return false;
  }

  function createEditorController({ container, api = null, dialog = null, onBack = null, onExported = null, onSessionClosed = null } = {}) {
    const State = getStateApi();
    const Autosave = getAutosaveApi();
    const Forms = getFormsApi();

    let state = State.createEditorState(null);
    let autosave = null;
    let contextToken = 0;
    let resizeObserver = null;
    let backCallback = onBack;
    let preparingCancelRequested = false;

    function getApi() {
      return api || (root && root.academicAPI) || null;
    }

    function getDialog() {
      return dialog || (root && root.uiDialog) || null;
    }

    function notifyToast(message, type = 'info') {
      if (root && typeof root.uiMessage === 'function') root.uiMessage(message, type);
    }

    function focusControl(selectorOrEl) {
      if (!container) return;
      const dlg = getDialog();
      if (dlg && typeof dlg.isOpen === 'function' && dlg.isOpen()) return;
      if (typeof selectorOrEl === 'string') {
        Forms.focusSelector(container, selectorOrEl);
      } else if (selectorOrEl && typeof selectorOrEl.focus === 'function' && !selectorOrEl.disabled) {
        selectorOrEl.focus();
      }
    }

    function computeCompactMode() {
      if (!container) return false;
      const width = container.getBoundingClientRect?.().width || container.clientWidth || (root?.innerWidth || 1024);
      return width > 0 && width < Forms.COMPACT_BREAKPOINT_PX;
    }

    function syncCompactMode() {
      const nextCompact = computeCompactMode();
      if (nextCompact !== state.isCompact) {
        state.isCompact = nextCompact;
        const card = container?.querySelector('#editor-panel-card');
        if (card) card.classList.toggle('is-compact', nextCompact);
      }
    }

    function setupResizeObserver() {
      if (resizeObserver) {
        try { resizeObserver.disconnect(); } catch {}
        resizeObserver = null;
      }
      if (!container || typeof ResizeObserver !== 'function') return;
      resizeObserver = new ResizeObserver(() => syncCompactMode());
      resizeObserver.observe(container);
    }

    function renderStructural({ preserveFocus = true, focusSelectorAfter = null } = {}) {
      if (!container) return;
      const focusDesc = preserveFocus ? Forms.captureFocusDescriptor(container) : null;
      state.isCompact = computeCompactMode();
      container.innerHTML = Forms.renderEditorTemplate(state);
      if (focusSelectorAfter) {
        focusControl(focusSelectorAfter);
      } else if (focusDesc) {
        Forms.restoreFocusDescriptor(container, focusDesc);
      }
    }

    function syncIncremental() {
      if (!container) return;
      Forms.syncEditorIncremental(container, state);
    }

    function invalidatePreparedReview() {
      if (state.preparedPackage || state.exportState === 'ready' || state.exportState === 'error') {
        state.preparedPackage = null;
        if (state.exportState !== 'exported') {
          state.exportState = 'idle';
          state.exportMessage = '';
          state.exportTone = 'info';
        }
      }
    }

    function initAutosave(token) {
      if (autosave) autosave.destroy();
      autosave = Autosave.createAutosaveQueue({
        debounceMs: 350,
        getRevision: () => state.serverRevision,
        sendUpdate: async ({ expectedRevision, operations }) => {
          const bridge = getApi();
          if (!bridge?.updateEditor || !state.sessionId) {
            return { status: 'error', code: 'SESSION_NOT_FOUND', message: 'La sesión de edición no está disponible.' };
          }
          return bridge.updateEditor({
            sessionId: state.sessionId,
            expectedRevision,
            operations
          });
        },
        onStateChange: (nextSaveState, errorMessage = '') => {
          if (token !== contextToken) return;
          state.saveState = nextSaveState;
          state.saveError = nextSaveState === 'error' ? errorMessage : '';
          if (nextSaveState === 'saved') state.lastSavedAt = new Date().toISOString();
          syncIncremental();
        },
        onSynced: (response, batch) => {
          if (token !== contextToken) return;
          state.serverRevision = response.activity.revision;
          state.issues = Array.isArray(response.issues) ? response.issues : State.computeLocalIssues(response.activity);

          const hadStructural = batch.some(op => op.type === 'addItem' || op.type === 'removeItem' || op.type === 'moveItem');
          if (hadStructural) {
            const prevIds = new Set((state.activity?.items || []).map(item => item.id));
            state.activity = State.cloneValue(response.activity);
            if (batch.some(op => op.type === 'addItem')) {
              const added = state.activity.items.find(item => !prevIds.has(item.id));
              if (added) state.activeItemId = added.id;
              renderStructural({ preserveFocus: false, focusSelectorAfter: '#editor-question' });
            } else {
              if (!state.activity.items.some(item => item.id === state.activeItemId)) {
                state.activeItemId = state.activity.items[0]?.id || null;
              }
              renderStructural({ preserveFocus: true });
            }
          } else {
            // Conserva el valor en curso de los campos con ediciones pendientes o con foco,
            // sincronizando revisión y estado de aprobación desde el proceso principal.
            if (!autosave.hasPending()) {
              state.activity.revision = response.activity.revision;
              state.activity.reviewedRevision = response.activity.reviewedRevision;
              // Sincronizar marca reviewed por ítem sin sobrescribir espacios en blanco mientras el docente escribe.
              const serverById = new Map(response.activity.items.map(item => [item.id, item]));
              state.activity.items.forEach(localItem => {
                const srv = serverById.get(localItem.id);
                if (!srv) return;
                if (srv.reviewed) localItem.reviewed = true;
                else delete localItem.reviewed;
              });
            }
            syncIncremental();
          }
        },
        onError: (err) => {
          if (token !== contextToken) return;
          state.saveState = 'error';
          state.saveError = err?.message || 'No se pudo guardar el borrador editable. Conserva esta ventana abierta e inténtalo de nuevo.';
          if (err?.code === 'REVISION_CONFLICT' && Number.isSafeInteger(err.revision)) {
            state.serverRevision = err.revision;
          }
          syncIncremental();
        }
      });
    }

    function applyLocalEdit(operation, { immediate = false } = {}) {
      if (!state.activity) return;
      if (state.exportState === 'preparing' || state.exportState === 'saving_file') return;
      const { activity: nextActivity, changed } = State.applyOptimisticOperation(state.activity, operation);
      state.activity = nextActivity;
      state.issues = State.computeLocalIssues(state.activity);
      if (changed) {
        invalidatePreparedReview();
      }
      autosave?.enqueue(operation, { immediate });
      syncIncremental();
    }

    function selectItem(itemId, { focusField = null } = {}) {
      if (!state.activity || !itemId || itemId === state.activeItemId) {
        if (focusField) focusControl(focusField);
        return;
      }
      if (!state.activity.items.some(item => item.id === itemId)) return;
      state.activeItemId = itemId;
      renderStructural({ preserveFocus: !focusField, focusSelectorAfter: focusField });
    }

    function goToFirstError() {
      const target = State.getFirstIssueTarget(state);
      if (!target) return;
      if (target.itemId && target.itemId !== state.activeItemId) {
        selectItem(target.itemId, { focusField: target.selector });
      } else {
        focusControl(target.selector);
      }
    }

    async function handleAddItem() {
      if (!state.activity || state.activity.activityType !== 'questionset') return;
      if (state.activity.items.length >= 20) return;
      if (state.exportState === 'preparing' || state.exportState === 'saving_file') return;
      invalidatePreparedReview();
      autosave?.enqueue({ type: 'addItem' }, { immediate: true });
      await autosave?.flush();
    }

    async function handleMoveItem(delta) {
      if (!state.activity || state.activity.activityType !== 'questionset') return;
      if (state.exportState === 'preparing' || state.exportState === 'saving_file') return;
      const currentIdx = State.getActiveItemIndex(state);
      const nextIdx = currentIdx + delta;
      if (currentIdx < 0 || nextIdx < 0 || nextIdx >= state.activity.items.length) return;
      const item = state.activity.items[currentIdx];
      const op = { type: 'moveItem', itemId: item.id, index: nextIdx };
      const { activity: nextActivity } = State.applyOptimisticOperation(state.activity, op);
      state.activity = nextActivity;
      state.issues = State.computeLocalIssues(state.activity);
      invalidatePreparedReview();

      const preferredButton = delta < 0
        ? (nextIdx === 0 ? '#btn-editor-move-down' : '#btn-editor-move-up')
        : (nextIdx === state.activity.items.length - 1 ? '#btn-editor-move-up' : '#btn-editor-move-down');

      renderStructural({ preserveFocus: false, focusSelectorAfter: preferredButton });
      autosave?.enqueue(op, { immediate: true });
      await autosave?.flush();
    }

    async function handleRemoveItem() {
      if (!state.activity || state.activity.activityType !== 'questionset') return;
      if (state.activity.items.length <= 1) return;
      if (state.exportState === 'preparing' || state.exportState === 'saving_file') return;
      const currentIdx = State.getActiveItemIndex(state);
      const item = state.activity.items[currentIdx];
      if (!item) return;

      const dlg = getDialog();
      if (isItemNonEmpty(item) && dlg && typeof dlg.confirm === 'function') {
        const confirmed = await dlg.confirm({
          title: '¿Eliminar esta pregunta?',
          message: `Se quitará la pregunta ${currentIdx + 1} de este borrador. Podrás añadir nuevas preguntas si lo necesitas.`,
          confirmLabel: 'Eliminar pregunta'
        });
        if (!confirmed) return;
      }

      const nextActive = state.activity.items[currentIdx + 1] || state.activity.items[currentIdx - 1];
      if (nextActive) state.activeItemId = nextActive.id;
      invalidatePreparedReview();
      autosave?.enqueue({ type: 'removeItem', itemId: item.id }, { immediate: true });
      const res = await autosave?.flush();
      if (res?.ok) {
        focusControl('#editor-question');
      }
    }

    async function handleConfirmAndPrepare() {
      if (!state.activity || !state.sessionId) return;
      if (state.exportState === 'preparing' || state.exportState === 'saving_file') return;
      const token = contextToken;

      const flushed = await autosave.flush();
      if (token !== contextToken) return;
      if (!flushed.ok) {
        state.exportState = 'idle';
        state.exportTone = 'error';
        state.exportMessage = state.saveError || 'No se pudieron guardar los últimos cambios antes de preparar la actividad.';
        syncIncremental();
        focusControl('#btn-editor-retry-save');
        return;
      }

      state.issues = State.computeLocalIssues(state.activity);
      if (state.issues.length > 0) {
        state.exportState = 'idle';
        state.exportTone = 'error';
        state.exportMessage = 'Corrige los campos pendientes antes de confirmar y preparar la actividad H5P.';
        syncIncremental();
        goToFirstError();
        return;
      }

      const bridge = getApi();
      if (!bridge?.prepareReviewedH5P) {
        state.exportState = 'error';
        state.exportTone = 'error';
        state.exportMessage = 'La preparación de actividades no está disponible en este entorno.';
        syncIncremental();
        return;
      }

      preparingCancelRequested = false;
      state.exportState = 'preparing';
      state.exportTone = 'progress';
      state.exportMessage = 'Revisión confirmada. Empaquetando actividad H5P…';
      syncIncremental();

      try {
        const result = await bridge.prepareReviewedH5P({
          sessionId: state.sessionId,
          expectedRevision: state.serverRevision
        });
        if (token !== contextToken) return;

        if (result?.status !== 'ok') {
          if (result?.code === 'GENERATION_CANCELLED') {
            state.exportState = 'idle';
            state.exportTone = 'info';
            state.exportMessage = 'Empaquetado cancelado. Tu contenido se conservó; puedes volver a prepararlo cuando quieras.';
            syncIncremental();
            focusControl('#btn-editor-confirm-prepare');
            return;
          }
          if (result?.code === 'INVALID_CONTENT') {
            if (Array.isArray(result.issues)) state.issues = result.issues;
            state.exportState = 'idle';
            state.exportTone = 'error';
            state.exportMessage = result.message || 'Corrige los campos pendientes antes de exportar.';
            syncIncremental();
            goToFirstError();
            return;
          }
          if (result?.code === 'REVISION_CONFLICT' && Number.isSafeInteger(result.revision)) {
            state.serverRevision = result.revision;
          }
          state.exportState = 'error';
          state.exportTone = 'error';
          state.exportMessage = result?.message || 'No se pudo preparar el archivo H5P. Puedes reintentar sin volver a generar con Gemini.';
          syncIncremental();
          focusControl('#btn-editor-confirm-prepare');
          return;
        }

        state.activity.revision = result.revision;
        state.activity.reviewedRevision = result.reviewedRevision;
        state.serverRevision = result.revision;
        state.preparedPackage = {
          packageId: result.packageId,
          revision: result.revision,
          title: result.title
        };
        state.exportState = 'ready';
        state.exportTone = 'success';
        state.exportMessage = 'Revisión confirmada y archivo H5P preparado. Pulsa «Guardar archivo H5P» para elegir dónde guardarlo.';
        syncIncremental();
        focusControl('#btn-editor-save-file');
      } catch {
        if (token !== contextToken) return;
        state.exportState = 'error';
        state.exportTone = 'error';
        state.exportMessage = 'No se pudo preparar el archivo H5P. Puedes reintentar sin volver a generar con Gemini.';
        syncIncremental();
        focusControl('#btn-editor-confirm-prepare');
      } finally {
        preparingCancelRequested = false;
      }
    }

    async function handleCancelPrepare() {
      if (state.exportState !== 'preparing' || preparingCancelRequested) return;
      preparingCancelRequested = true;
      const cancelBtn = container?.querySelector('#btn-editor-cancel-prepare');
      const stepEl = container?.querySelector('#editor-progress-step');
      if (cancelBtn) cancelBtn.disabled = true;
      if (stepEl) stepEl.textContent = 'Cancelando empaquetado…';
      try {
        const res = await getApi()?.cancelGeneration?.();
        if (res?.status === 'ok' && res.cancelled) return;
      } catch {
        // Permite reintentar cancelar si el canal falló.
      }
      if (state.exportState === 'preparing') {
        preparingCancelRequested = false;
        if (stepEl) stepEl.textContent = 'No se pudo solicitar la cancelación. El empaquetado sigue en curso.';
        if (cancelBtn) {
          cancelBtn.disabled = false;
          focusControl(cancelBtn);
        }
      }
    }

    async function handleSaveFile() {
      if (!state.preparedPackage || !state.activity) return;
      if (state.exportState === 'preparing' || state.exportState === 'saving_file') return;
      if (state.preparedPackage.revision !== state.activity.revision) {
        invalidatePreparedReview();
        state.exportTone = 'error';
        state.exportMessage = 'Hubo cambios después de preparar el archivo. Confirma la revisión nuevamente antes de guardar.';
        syncIncremental();
        focusControl('#btn-editor-confirm-prepare');
        return;
      }

      const bridge = getApi();
      if (!bridge?.saveH5PFile) return;

      const saveContext = {
        token: contextToken,
        packageId: state.preparedPackage.packageId,
        draftId: state.draftId,
        courseId: state.courseId || 'unassigned'
      };
      const isCurrent = () => contextToken === saveContext.token;

      state.exportState = 'saving_file';
      state.exportTone = 'progress';
      state.exportMessage = 'Elige dónde guardar el archivo H5P…';
      syncIncremental();

      try {
        const suggestedName = sanitizeSuggestedFileName(state.activity.title, state.activity.activityType);
        const result = await bridge.saveH5PFile({
          packageId: saveContext.packageId,
          suggestedName,
          courseId: saveContext.courseId
        });

        const savedMessage = result?.projectSaved
          ? 'Archivo H5P guardado y añadido a tus proyectos.'
          : 'Archivo H5P guardado en tu equipo. Aviso: no se pudo registrar en tus proyectos; tu borrador editable se conservó.';
        const savedTone = result?.projectSaved ? 'success' : 'warning';

        // Protección de contexto H5P-27: si el docente salió del editor mientras el diálogo estaba abierto,
        // no muta la vista actual ni roba foco; informa con un único aviso accesible.
        if (!isCurrent()) {
          if (result?.status === 'ok') {
            notifyToast(savedMessage, savedTone);
            if (result.projectSaved) {
              if (typeof onExported === 'function') onExported(result, saveContext);
            }
          }
          return;
        }

        if (result?.status === 'cancelled') {
          state.exportState = 'ready';
          state.exportTone = 'info';
          state.exportMessage = 'Guardado cancelado. El paquete sigue listo; puedes intentarlo nuevamente.';
          syncIncremental();
          focusControl('#btn-editor-save-file');
          return;
        }

        if (result?.status !== 'ok') {
          if (result?.code === 'REVISION_CONFLICT' || result?.code === 'NOT_FOUND') {
            state.preparedPackage = null;
            state.exportState = 'idle';
            state.exportTone = 'error';
            state.exportMessage = result.message || 'La revisión cambió. Confirma y prepara el archivo nuevamente.';
            syncIncremental();
            focusControl('#btn-editor-confirm-prepare');
            return;
          }
          state.exportState = 'ready';
          state.exportTone = 'error';
          state.exportMessage = result?.message || 'No se pudo guardar el archivo. Inténtalo nuevamente.';
          syncIncremental();
          focusControl('#btn-editor-save-file');
          return;
        }

        if (result.projectSaved) {
          state.sessionId = null;
          state.preparedPackage = null;
          state.lastExportedProject = {
            projectId: result.projectId || null,
            fileName: result.fileName || ''
          };
          state.exportState = 'exported';
          state.exportTone = 'success';
          state.exportMessage = savedMessage;
          autosave?.reset();
          if (typeof onExported === 'function') onExported(result, saveContext);
          syncIncremental();
          focusControl(result.projectId ? '#btn-editor-reveal-file' : '#btn-editor-back-config');
        } else {
          // El archivo se guardó en disco pero falló el registro: el borrador y la sesión siguen disponibles.
          state.exportState = 'exported_warning';
          state.exportTone = 'warning';
          state.exportMessage = savedMessage;
          if (typeof onExported === 'function') onExported(result, saveContext);
          syncIncremental();
          focusControl('#btn-editor-save-file');
        }
      } catch {
        if (!isCurrent()) return;
        state.exportState = 'ready';
        state.exportTone = 'error';
        state.exportMessage = 'No se pudo guardar el archivo. Inténtalo nuevamente.';
        syncIncremental();
        focusControl('#btn-editor-save-file');
      }
    }

    async function handleRevealFile() {
      const projectId = state.lastExportedProject?.projectId;
      const bridge = getApi();
      if (!projectId || !bridge?.revealProjectFile) return;
      try {
        const res = await bridge.revealProjectFile(projectId);
        if (res?.status === 'ok') return;
        state.exportTone = 'error';
        state.exportMessage = res?.status === 'missing'
          ? 'El archivo .h5p ya no se encuentra en esa ubicación. Pudo moverse o eliminarse.'
          : 'No se pudo abrir la carpeta del archivo guardado.';
        syncIncremental();
      } catch {
        state.exportTone = 'error';
        state.exportMessage = 'No se pudo abrir la carpeta del archivo guardado.';
        syncIncremental();
      }
    }

    async function handleBack() {
      if (state.exportState === 'preparing' || state.exportState === 'saving_file') return;
      if (autosave && state.sessionId && (autosave.hasPending() || autosave.isSaving())) {
        await autosave.flush();
      }
      if (typeof backCallback === 'function') {
        await backCallback({
          origin: state.origin,
          courseId: state.courseId,
          draftId: state.draftId,
          sessionId: state.sessionId,
          hasSession: Boolean(state.sessionId)
        });
      }
    }

    function bindEvents() {
      if (!container || container.dataset.editorEventsBound === 'true') return;
      container.dataset.editorEventsBound = 'true';

      container.addEventListener('input', event => {
        const target = event.target;
        if (!target || !state.activity) return;
        const action = target.dataset?.action;
        if (!action) return;

        if (action === 'set-title') {
          const val = String(target.value || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, state.limits.title);
          if (target.value !== val) target.value = val;
          applyLocalEdit({ type: 'setTitle', title: val });
          return;
        }
        const activeItem = State.getActiveItem(state);
        if (!activeItem) return;

        if (action === 'set-item-text') {
          const field = target.dataset.field;
          const maxLen = field === 'question' || field === 'statement' ? state.limits.question : state.limits.feedback;
          const val = String(target.value || '').slice(0, maxLen);
          if (target.value !== val) target.value = val;
          applyLocalEdit({ type: 'setItemText', itemId: activeItem.id, field, text: val });
          return;
        }
        if (action === 'set-option-text') {
          const optionId = target.dataset.optionId;
          const val = String(target.value || '').slice(0, state.limits.option);
          if (target.value !== val) target.value = val;
          applyLocalEdit({ type: 'setOptionText', itemId: activeItem.id, optionId, text: val });
        }
      });

      container.addEventListener('change', event => {
        const target = event.target;
        if (!target || !state.activity) return;
        const action = target.dataset?.action;
        if (!action) return;

        if (action === 'select-item-dropdown') {
          selectItem(target.value, { focusField: '#editor-question-select' });
          return;
        }

        const activeItem = State.getActiveItem(state);
        if (!activeItem) return;

        if (action === 'set-correct-option') {
          applyLocalEdit({ type: 'setCorrectOption', itemId: activeItem.id, optionId: target.value }, { immediate: true });
          return;
        }
        if (action === 'set-truefalse-answer') {
          const boolVal = target.value === 'true' ? true : (target.value === 'false' ? false : null);
          applyLocalEdit({ type: 'setTrueFalseAnswer', itemId: activeItem.id, value: boolVal }, { immediate: true });
          return;
        }
        if (action === 'mark-item-reviewed') {
          applyLocalEdit({ type: 'markItemReviewed', itemId: activeItem.id, reviewed: Boolean(target.checked) }, { immediate: true });
        }
      });

      container.addEventListener('click', event => {
        const btn = event.target.closest('[data-action]');
        if (!btn || btn.disabled) return;
        const action = btn.dataset.action;

        switch (action) {
          case 'select-item':
            selectItem(btn.dataset.itemId, { focusField: `.editor-question-nav-btn[data-item-id="${btn.dataset.itemId}"]` });
            break;
          case 'prev-item': {
            const idx = State.getActiveItemIndex(state);
            if (idx > 0) selectItem(state.activity.items[idx - 1].id, { focusField: idx - 1 > 0 ? '#btn-editor-prev-item' : '#editor-question-select' });
            break;
          }
          case 'next-item': {
            const idx = State.getActiveItemIndex(state);
            if (idx >= 0 && idx < state.activity.items.length - 1) {
              selectItem(state.activity.items[idx + 1].id, { focusField: idx + 1 < state.activity.items.length - 1 ? '#btn-editor-next-item' : '#editor-question-select' });
            }
            break;
          }
          case 'add-item':
            void handleAddItem();
            break;
          case 'move-up':
            void handleMoveItem(-1);
            break;
          case 'move-down':
            void handleMoveItem(1);
            break;
          case 'remove-item':
            void handleRemoveItem();
            break;
          case 'go-first-error':
            goToFirstError();
            break;
          case 'retry-save':
            void autosave?.retry();
            break;
          case 'confirm-prepare':
            void handleConfirmAndPrepare();
            break;
          case 'cancel-prepare':
            void handleCancelPrepare();
            break;
          case 'save-file':
            void handleSaveFile();
            break;
          case 'reveal-file':
            void handleRevealFile();
            break;
          case 'back':
            void handleBack();
            break;
          default:
            break;
        }
      });
    }

    function mountSession(sessionDto, options = {}) {
      contextToken++;
      if (typeof options.onBack === 'function') backCallback = options.onBack;
      state = State.createEditorState({
        ...sessionDto,
        origin: options.origin || sessionDto?.origin || 'wizard'
      });
      state.lastSavedAt = new Date().toISOString();
      initAutosave(contextToken);
      bindEvents();
      setupResizeObserver();
      renderStructural({ preserveFocus: false, focusSelectorAfter: '#editor-panel-title' });
      return state;
    }

    async function flush() {
      if (!autosave || !state.sessionId) return { ok: true };
      return autosave.flush();
    }

    async function closeSession({ flushFirst = true } = {}) {
      const closingSessionId = state.sessionId;
      if (state.exportState === 'preparing') {
        try { await getApi()?.cancelGeneration?.(); } catch {}
      }
      if (flushFirst && autosave && closingSessionId && (autosave.hasPending() || autosave.isSaving())) {
        try { await autosave.flush(); } catch {}
      }
      contextToken++;
      if (autosave) {
        autosave.destroy();
        autosave = null;
      }
      if (resizeObserver) {
        try { resizeObserver.disconnect(); } catch {}
        resizeObserver = null;
      }
      state = State.createEditorState(null);
      if (closingSessionId) {
        try {
          await getApi()?.closeEditor?.({ sessionId: closingSessionId });
        } catch {
          // Sesión ya cerrada o ventana en cierre.
        }
        if (typeof onSessionClosed === 'function') onSessionClosed(closingSessionId);
      }
    }

    return {
      mountSession,
      flush,
      closeSession,
      getState: () => state,
      getSessionId: () => state.sessionId,
      getDraftId: () => state.draftId,
      hasActiveSession: () => Boolean(state.sessionId),
      goToFirstError,
      syncCompactMode
    };
  }

  // Instancia compartida para el renderer de Electron (#panel-export)
  let sharedController = null;
  function getSharedController() {
    if (sharedController) return sharedController;
    if (typeof document === 'undefined') return null;
    const panelExport = document.getElementById('panel-export');
    if (!panelExport) return null;
    sharedController = createEditorController({
      container: panelExport,
      onExported: (result, saveContext) => {
        if (result?.projectSaved) {
          if (saveContext?.draftId) {
            root.uploadManager?.onDraftDeleted?.(saveContext.draftId);
          }
          Promise.resolve(root.coursesManager?.onProjectExported?.(saveContext.courseId)).catch(() => {});
          Promise.resolve(root.coursesManager?.refreshDrafts?.()).catch(() => {});
        } else {
          Promise.resolve(root.coursesManager?.refreshDrafts?.()).catch(() => {});
        }
      }
    });
    return sharedController;
  }

  const api = {
    createEditorController,
    sanitizeSuggestedFileName,
    mountSession: (dto, opts) => getSharedController()?.mountSession(dto, opts),
    flush: () => getSharedController()?.flush() || Promise.resolve({ ok: true }),
    closeSession: (opts) => getSharedController()?.closeSession(opts) || Promise.resolve(),
    getState: () => getSharedController()?.getState() || null,
    getSessionId: () => getSharedController()?.getSessionId() || null,
    getDraftId: () => getSharedController()?.getDraftId() || null,
    hasActiveSession: () => Boolean(getSharedController()?.hasActiveSession()),
    goToFirstError: () => getSharedController()?.goToFirstError()
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.editorManager = api;
  }
})(typeof window !== 'undefined' ? window : null);
