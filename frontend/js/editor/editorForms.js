/**
 * frontend/js/editor/editorForms.js
 * Renderizado y actualización incremental del editor de actividades (QuestionSet, MultiChoice, TrueFalse).
 * Separa el renderizado estructural de las actualizaciones incrementales para preservar el foco.
 */
(function (root) {
  'use strict';

  const COMPACT_BREAKPOINT_PX = 760;

  function getStateApi() {
    if (root && root.H5PEditorState) return root.H5PEditorState;
    if (typeof require === 'function') return require('./editorState');
    throw new Error('H5PEditorState no está cargado.');
  }

  function escapeHtml(value) {
    if (root && typeof root.uiEscapeHtml === 'function') return root.uiEscapeHtml(value);
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function truncateLabel(text, maxLen = 58) {
    const clean = String(text || '').trim().replace(/\s+/g, ' ');
    if (!clean) return 'Sin enunciado';
    return clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}…` : clean;
  }

  function formatCounter(text, limit) {
    const len = String(text || '').length;
    return `${len.toLocaleString('es-CL')} / ${limit.toLocaleString('es-CL')}`;
  }

  function formatSaveBadge(state) {
    if (state.saveState === 'saving') return { text: 'Guardando cambios…', tone: 'progress' };
    if (state.saveState === 'pending') return { text: 'Cambios pendientes…', tone: 'pending' };
    if (state.saveState === 'error') return { text: 'Error al guardar', tone: 'error' };
    if (state.lastSavedAt) {
      try {
        const t = new Date(state.lastSavedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
        return { text: `Guardado · ${t}`, tone: 'saved' };
      } catch {
        // Fallback below
      }
    }
    return { text: 'Borrador guardado', tone: 'saved' };
  }

  function renderChoiceFormHtml(state, item, locked) {
    const State = getStateApi();
    const issues = state.issues || [];
    const limits = state.limits || State.DEFAULT_LIMITS;
    const questionIssue = State.getFieldIssue(issues, { itemId: item.id, field: 'question' });
    const correctIssue = State.getFieldIssue(issues, { itemId: item.id, field: 'correctOptionId' });
    const feedbackIssue = State.getFieldIssue(issues, { itemId: item.id, field: 'feedback' });
    const disabledAttr = locked ? 'disabled' : '';

    const optionsHtml = item.options.map((opt, idx) => {
      const optIssue = State.getFieldIssue(issues, { itemId: item.id, optionId: opt.id, field: 'text' });
      const isCorrect = item.correctOptionId === opt.id;
      const letter = String.fromCharCode(65 + idx);
      const errId = `editor-option-error-${opt.id}`;
      return `
        <div class="editor-option-row${isCorrect ? ' is-correct' : ''}${optIssue ? ' has-error' : ''}" data-option-row="${escapeHtml(opt.id)}">
          <label class="editor-option-radio-label" for="editor-correct-${escapeHtml(opt.id)}">
            <input
              type="radio"
              class="editor-correct-radio"
              name="editor-correct-option"
              id="editor-correct-${escapeHtml(opt.id)}"
              value="${escapeHtml(opt.id)}"
              data-action="set-correct-option"
              data-option-id="${escapeHtml(opt.id)}"
              ${isCorrect ? 'checked' : ''}
              ${disabledAttr}
              aria-label="Marcar alternativa ${letter} como correcta"
            />
            <span class="editor-option-letter" aria-hidden="true">${letter}</span>
            <span class="editor-option-correct-tag">${isCorrect ? 'Correcta' : 'Elegir'}</span>
          </label>
          <div class="editor-option-input-wrap">
            <input
              type="text"
              class="editor-text-input editor-option-input"
              id="editor-option-${escapeHtml(opt.id)}"
              data-action="set-option-text"
              data-option-id="${escapeHtml(opt.id)}"
              maxlength="${limits.option}"
              value="${escapeHtml(opt.text)}"
              placeholder="Escribe la alternativa ${letter}…"
              aria-label="Texto de la alternativa ${letter}"
              aria-invalid="${optIssue ? 'true' : 'false'}"
              ${optIssue ? `aria-describedby="${escapeHtml(errId)}"` : ''}
              ${disabledAttr}
            />
            <p class="editor-field-error${optIssue ? '' : ' hidden'}" id="${escapeHtml(errId)}" role="status">${escapeHtml(State.getIssueMessage(optIssue))}</p>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="editor-form-fields" data-form-type="choice" data-item-id="${escapeHtml(item.id)}">
        <div class="editor-item-review-row">
          <label class="editor-reviewed-toggle" for="editor-item-reviewed">
            <input
              type="checkbox"
              id="editor-item-reviewed"
              data-action="mark-item-reviewed"
              ${item.reviewed ? 'checked' : ''}
              ${disabledAttr}
            />
            <span>Marcar esta pregunta como revisada (opcional)</span>
          </label>
        </div>

        <div class="editor-field-group${questionIssue ? ' has-error' : ''}">
          <div class="editor-field-label-row">
            <label for="editor-question" class="editor-field-label">Enunciado de la pregunta</label>
            <span class="editor-char-counter" id="editor-question-counter">${formatCounter(item.question, limits.question)}</span>
          </div>
          <textarea
            id="editor-question"
            class="editor-textarea"
            rows="3"
            maxlength="${limits.question}"
            data-action="set-item-text"
            data-field="question"
            aria-invalid="${questionIssue ? 'true' : 'false'}"
            aria-describedby="editor-question-error editor-question-counter"
            placeholder="Escribe el enunciado claro de la pregunta…"
            ${disabledAttr}
          >${escapeHtml(item.question)}</textarea>
          <p class="editor-field-error${questionIssue ? '' : ' hidden'}" id="editor-question-error" role="status">${escapeHtml(State.getIssueMessage(questionIssue))}</p>
        </div>

        <fieldset class="editor-options-fieldset${correctIssue ? ' has-error' : ''}">
          <legend class="editor-field-label">Alternativas y respuesta correcta</legend>
          <p class="editor-field-hint">Selecciona la alternativa correcta. El orden actual se conservará exactamente al exportar.</p>
          <div class="editor-options-list">
            ${optionsHtml}
          </div>
          <p class="editor-field-error${correctIssue ? '' : ' hidden'}" id="editor-correct-error" role="status">${escapeHtml(State.getIssueMessage(correctIssue))}</p>
        </fieldset>

        <div class="editor-field-group${feedbackIssue ? ' has-error' : ''}">
          <div class="editor-field-label-row">
            <label for="editor-feedback" class="editor-field-label">Retroalimentación</label>
            <span class="editor-char-counter" id="editor-feedback-counter">${formatCounter(item.feedback, limits.feedback)}</span>
          </div>
          <textarea
            id="editor-feedback"
            class="editor-textarea"
            rows="3"
            maxlength="${limits.feedback}"
            data-action="set-item-text"
            data-field="feedback"
            aria-invalid="${feedbackIssue ? 'true' : 'false'}"
            aria-describedby="editor-feedback-error editor-feedback-counter"
            placeholder="Explica por qué la alternativa correcta responde al enunciado…"
            ${disabledAttr}
          >${escapeHtml(item.feedback)}</textarea>
          <p class="editor-field-error${feedbackIssue ? '' : ' hidden'}" id="editor-feedback-error" role="status">${escapeHtml(State.getIssueMessage(feedbackIssue))}</p>
        </div>
      </div>
    `;
  }

  function renderTrueFalseFormHtml(state, item, locked) {
    const State = getStateApi();
    const issues = state.issues || [];
    const limits = state.limits || State.DEFAULT_LIMITS;
    const statementIssue = State.getFieldIssue(issues, { itemId: item.id, field: 'statement' });
    const answerIssue = State.getFieldIssue(issues, { itemId: item.id, field: 'isTrue' });
    const correctFbIssue = State.getFieldIssue(issues, { itemId: item.id, field: 'feedbackOnCorrect' });
    const incorrectFbIssue = State.getFieldIssue(issues, { itemId: item.id, field: 'feedbackOnIncorrect' });
    const disabledAttr = locked ? 'disabled' : '';

    return `
      <div class="editor-form-fields" data-form-type="truefalse" data-item-id="${escapeHtml(item.id)}">
        <div class="editor-item-review-row">
          <label class="editor-reviewed-toggle" for="editor-item-reviewed">
            <input
              type="checkbox"
              id="editor-item-reviewed"
              data-action="mark-item-reviewed"
              ${item.reviewed ? 'checked' : ''}
              ${disabledAttr}
            />
            <span>Marcar esta afirmación como revisada (opcional)</span>
          </label>
        </div>

        <div class="editor-field-group${statementIssue ? ' has-error' : ''}">
          <div class="editor-field-label-row">
            <label for="editor-statement" class="editor-field-label">Afirmación</label>
            <span class="editor-char-counter" id="editor-statement-counter">${formatCounter(item.statement, limits.question)}</span>
          </div>
          <textarea
            id="editor-statement"
            class="editor-textarea"
            rows="3"
            maxlength="${limits.question}"
            data-action="set-item-text"
            data-field="statement"
            aria-invalid="${statementIssue ? 'true' : 'false'}"
            aria-describedby="editor-statement-error editor-statement-counter"
            placeholder="Escribe una afirmación precisa que pueda evaluarse como verdadera o falsa…"
            ${disabledAttr}
          >${escapeHtml(item.statement)}</textarea>
          <p class="editor-field-error${statementIssue ? '' : ' hidden'}" id="editor-statement-error" role="status">${escapeHtml(State.getIssueMessage(statementIssue))}</p>
        </div>

        <fieldset class="editor-tf-fieldset${answerIssue ? ' has-error' : ''}">
          <legend class="editor-field-label">Respuesta correcta</legend>
          <div class="editor-tf-options">
            <label class="editor-tf-choice${item.isTrue === true ? ' is-selected' : ''}" for="editor-tf-true">
              <input
                type="radio"
                id="editor-tf-true"
                name="editor-tf-answer"
                value="true"
                data-action="set-truefalse-answer"
                ${item.isTrue === true ? 'checked' : ''}
                ${disabledAttr}
              />
              <span>Verdadero</span>
            </label>
            <label class="editor-tf-choice${item.isTrue === false ? ' is-selected' : ''}" for="editor-tf-false">
              <input
                type="radio"
                id="editor-tf-false"
                name="editor-tf-answer"
                value="false"
                data-action="set-truefalse-answer"
                ${item.isTrue === false ? 'checked' : ''}
                ${disabledAttr}
              />
              <span>Falso</span>
            </label>
          </div>
          <p class="editor-field-error${answerIssue ? '' : ' hidden'}" id="editor-tf-error" role="status">${escapeHtml(State.getIssueMessage(answerIssue))}</p>
        </fieldset>

        <div class="editor-field-group${correctFbIssue ? ' has-error' : ''}">
          <div class="editor-field-label-row">
            <label for="editor-feedback-correct" class="editor-field-label">Retroalimentación al acertar</label>
            <span class="editor-char-counter" id="editor-feedback-correct-counter">${formatCounter(item.feedbackOnCorrect, limits.feedback)}</span>
          </div>
          <textarea
            id="editor-feedback-correct"
            class="editor-textarea"
            rows="2"
            maxlength="${limits.feedback}"
            data-action="set-item-text"
            data-field="feedbackOnCorrect"
            aria-invalid="${correctFbIssue ? 'true' : 'false'}"
            aria-describedby="editor-feedback-correct-error editor-feedback-correct-counter"
            placeholder="Mensaje que verá el estudiante cuando elija la respuesta correcta…"
            ${disabledAttr}
          >${escapeHtml(item.feedbackOnCorrect)}</textarea>
          <p class="editor-field-error${correctFbIssue ? '' : ' hidden'}" id="editor-feedback-correct-error" role="status">${escapeHtml(State.getIssueMessage(correctFbIssue))}</p>
        </div>

        <div class="editor-field-group${incorrectFbIssue ? ' has-error' : ''}">
          <div class="editor-field-label-row">
            <label for="editor-feedback-incorrect" class="editor-field-label">Retroalimentación al equivocarse</label>
            <span class="editor-char-counter" id="editor-feedback-incorrect-counter">${formatCounter(item.feedbackOnIncorrect, limits.feedback)}</span>
          </div>
          <textarea
            id="editor-feedback-incorrect"
            class="editor-textarea"
            rows="2"
            maxlength="${limits.feedback}"
            data-action="set-item-text"
            data-field="feedbackOnIncorrect"
            aria-invalid="${incorrectFbIssue ? 'true' : 'false'}"
            aria-describedby="editor-feedback-incorrect-error editor-feedback-incorrect-counter"
            placeholder="Aclaración pedagógica cuando el estudiante responde de forma incorrecta…"
            ${disabledAttr}
          >${escapeHtml(item.feedbackOnIncorrect)}</textarea>
          <p class="editor-field-error${incorrectFbIssue ? '' : ' hidden'}" id="editor-feedback-incorrect-error" role="status">${escapeHtml(State.getIssueMessage(incorrectFbIssue))}</p>
        </div>
      </div>
    `;
  }

  function renderQuestionSetNavHtml(state, activeIndex, locked) {
    const State = getStateApi();
    const items = state.activity.items;
    const issues = state.issues || [];
    const canAdd = !locked && items.length < 20;
    const canPrev = !locked && activeIndex > 0;
    const canNext = !locked && activeIndex < items.length - 1;

    const sidebarItemsHtml = items.map((entry, idx) => {
      const itemIssues = State.getItemIssues(issues, entry.id);
      const isActive = idx === activeIndex;
      const badge = itemIssues.length > 0
        ? `<span class="editor-nav-badge is-error" aria-label="${itemIssues.length} ${itemIssues.length === 1 ? 'error' : 'errores'}">!</span>`
        : entry.reviewed
          ? '<span class="editor-nav-badge is-reviewed" aria-label="Revisada">✓</span>'
          : '';
      return `
        <li class="editor-question-nav-item">
          <button
            type="button"
            class="editor-question-nav-btn${isActive ? ' is-active' : ''}${itemIssues.length > 0 ? ' has-error' : ''}"
            data-action="select-item"
            data-item-id="${escapeHtml(entry.id)}"
            ${isActive ? 'aria-current="true"' : ''}
            ${locked ? 'disabled' : ''}
          >
            <span class="editor-nav-num">${idx + 1}</span>
            <span class="editor-nav-preview">${escapeHtml(truncateLabel(entry.question, 46))}</span>
            ${badge}
          </button>
        </li>
      `;
    }).join('');

    const selectOptionsHtml = items.map((entry, idx) => {
      const itemIssues = State.getItemIssues(issues, entry.id);
      const suffix = itemIssues.length > 0 ? ' · Pendiente' : (entry.reviewed ? ' · Revisada' : '');
      return `<option value="${escapeHtml(entry.id)}"${idx === activeIndex ? ' selected' : ''}>${idx + 1}. ${escapeHtml(truncateLabel(entry.question, 42))}${suffix}</option>`;
    }).join('');

    return {
      sidebarHtml: `
        <aside class="editor-question-sidebar" aria-label="Índice de preguntas">
          <div class="editor-sidebar-header">
            <span class="editor-sidebar-count" id="editor-sidebar-count">Preguntas (${items.length} / 20)</span>
            <button type="button" class="btn-secondary btn-sm" id="btn-editor-add-item" data-action="add-item" ${canAdd ? '' : 'disabled'}>
              + Añadir
            </button>
          </div>
          <ol class="editor-question-list" id="editor-question-list">
            ${sidebarItemsHtml}
          </ol>
        </aside>
      `,
      compactHtml: `
        <div class="editor-compact-nav" aria-label="Navegación de preguntas">
          <div class="editor-compact-nav-row">
            <button type="button" class="btn-secondary btn-sm" id="btn-editor-prev-item" data-action="prev-item" ${canPrev ? '' : 'disabled'}>Anterior</button>
            <label class="editor-compact-select-wrap">
              <span class="sr-only">Seleccionar pregunta activa</span>
              <select id="editor-question-select" class="editor-question-select" data-action="select-item-dropdown" ${locked ? 'disabled' : ''}>
                ${selectOptionsHtml}
              </select>
            </label>
            <button type="button" class="btn-secondary btn-sm" id="btn-editor-next-item" data-action="next-item" ${canNext ? '' : 'disabled'}>Siguiente</button>
          </div>
          <div class="editor-compact-nav-actions">
            <span class="editor-compact-count">Pregunta ${activeIndex + 1} de ${items.length} (máx. 20)</span>
            <button type="button" class="btn-secondary btn-sm" id="btn-editor-add-item-compact" data-action="add-item" ${canAdd ? '' : 'disabled'}>+ Añadir pregunta</button>
          </div>
        </div>
      `
    };
  }

  function renderEditorTemplate(state) {
    const State = getStateApi();
    const activity = state.activity;
    if (!activity) {
      return `
        <section class="upcoming-step-card editor-panel-card" id="editor-panel-card" aria-labelledby="editor-panel-title">
          <header class="editor-panel-header">
            <span class="home-kicker">PASO 03 / REVISAR Y EXPORTAR</span>
            <h2 id="editor-panel-title" class="selector-panel-title" tabindex="-1">Editor de actividades</h2>
            <p class="selector-intro">No hay una actividad cargada para editar en este momento.</p>
          </header>
          <footer class="editor-footer-actions">
            <button type="button" class="btn-secondary" id="btn-editor-back-config" data-action="back">Volver</button>
          </footer>
        </section>
      `;
    }

    const isQuestionSet = activity.activityType === 'questionset';
    const isTrueFalse = activity.activityType === 'truefalse';
    const items = activity.items || [];
    const activeItem = State.getActiveItem(state);
    const activeIndex = State.getActiveItemIndex(state);
    const issues = state.issues || [];
    const titleIssue = State.getFieldIssue(issues, { field: 'title' });
    const limits = state.limits || State.DEFAULT_LIMITS;
    const locked = state.exportState === 'preparing' || state.exportState === 'saving_file';
    const isExported = state.exportState === 'exported' && !state.sessionId;
    const fieldsLocked = locked || isExported;
    const saveBadge = formatSaveBadge(state);
    const reviewedCount = State.getReviewedCount(activity);
    const approved = State.isReviewApproved(state);

    const navParts = isQuestionSet ? renderQuestionSetNavHtml(state, activeIndex, fieldsLocked) : null;
    const formHtml = isTrueFalse
      ? renderTrueFalseFormHtml(state, activeItem, fieldsLocked)
      : renderChoiceFormHtml(state, activeItem, fieldsLocked);

    const itemToolbarHtml = isQuestionSet ? `
      <div class="editor-item-toolbar">
        <h3 class="editor-item-heading" id="editor-active-item-heading">Pregunta ${activeIndex + 1} de ${items.length}</h3>
        <div class="editor-item-toolbar-actions">
          <button type="button" class="btn-secondary btn-sm" id="btn-editor-move-up" data-action="move-up" ${fieldsLocked || activeIndex <= 0 ? 'disabled' : ''} aria-label="Mover pregunta hacia arriba">↑ Subir</button>
          <button type="button" class="btn-secondary btn-sm" id="btn-editor-move-down" data-action="move-down" ${fieldsLocked || activeIndex >= items.length - 1 ? 'disabled' : ''} aria-label="Mover pregunta hacia abajo">↓ Bajar</button>
          <button type="button" class="btn-text-danger btn-sm" id="btn-editor-remove-item" data-action="remove-item" ${fieldsLocked || items.length <= 1 ? 'disabled' : ''}>Eliminar</button>
        </div>
      </div>
    ` : '';

    const backLabel = isExported
      ? (state.courseId && state.courseId !== 'unassigned' ? 'Volver al ramo' : 'Volver a la biblioteca')
      : state.origin === 'wizard'
        ? 'Volver a configurar'
        : state.origin === 'project'
          ? 'Volver al ramo'
          : 'Volver a la biblioteca';

    const canConfirm = !fieldsLocked && issues.length === 0 && state.saveState !== 'error';
    const showSaveFile = approved && !isExported && state.exportState !== 'preparing';
    const showReveal = Boolean(state.lastExportedProject?.projectId);
    const prepareLabel = state.exportState === 'error'
      ? 'Reintentar empaquetado'
      : approved
        ? 'Volver a preparar H5P'
        : 'Confirmar revisión y preparar H5P';

    return `
      <section class="upcoming-step-card editor-panel-card${state.isCompact ? ' is-compact' : ''}${isQuestionSet ? ' is-questionset' : ' is-single-item'}" id="editor-panel-card" aria-labelledby="editor-panel-title">
        <header class="editor-panel-header">
          <div class="editor-header-top">
            <div>
              <span class="home-kicker">PASO 03 / REVISAR Y EXPORTAR</span>
              <h2 id="editor-panel-title" class="selector-panel-title" tabindex="-1">Revisa y ajusta tu actividad</h2>
            </div>
            <div class="editor-header-pills">
              <span class="editor-type-pill">${escapeHtml(State.formatActivityTypeLabel(activity.activityType))}</span>
              <span class="editor-save-pill" id="editor-save-pill" data-save-state="${escapeHtml(saveBadge.tone)}" role="status" aria-live="polite">${escapeHtml(saveBadge.text)}</span>
              ${isQuestionSet ? `<span class="editor-reviewed-pill" id="editor-reviewed-pill">${reviewedCount} de ${items.length} marcadas</span>` : ''}
            </div>
          </div>
          <p class="selector-intro">Corrige cualquier enunciado, alternativa o retroalimentación. Al confirmar la revisión global se preparará el archivo <code>.h5p</code> exacto para exportar. Cualquier cambio posterior anulará la confirmación.</p>
        </header>

        <div class="editor-title-bar${titleIssue ? ' has-error' : ''}">
          <div class="editor-field-label-row">
            <label for="editor-title-input" class="editor-field-label">Título de la actividad</label>
            <span class="editor-char-counter" id="editor-title-counter">${formatCounter(activity.title, limits.title)}</span>
          </div>
          <input
            type="text"
            id="editor-title-input"
            class="editor-text-input"
            maxlength="${limits.title}"
            value="${escapeHtml(activity.title)}"
            data-action="set-title"
            aria-invalid="${titleIssue ? 'true' : 'false'}"
            aria-describedby="editor-title-error editor-title-counter"
            placeholder="Nombre y título de la actividad H5P…"
            ${fieldsLocked ? 'disabled' : ''}
          />
          <p class="editor-field-error${titleIssue ? '' : ' hidden'}" id="editor-title-error" role="status">${escapeHtml(State.getIssueMessage(titleIssue))}</p>
        </div>

        <div class="editor-issues-banner${issues.length > 0 ? '' : ' hidden'}" id="editor-issues-banner" role="status" aria-live="polite">
          <span id="editor-issues-summary">${issues.length === 1 ? 'Hay 1 campo por corregir antes de confirmar y exportar.' : `Hay ${issues.length} campos por corregir antes de confirmar y exportar.`}</span>
          <button type="button" class="btn-secondary btn-sm" id="btn-editor-first-error" data-action="go-first-error">Ir al primer error</button>
        </div>

        <div class="editor-save-error-banner${state.saveState === 'error' ? '' : ' hidden'}" id="editor-save-error-banner" role="alert" aria-live="assertive">
          <span id="editor-save-error-text">${escapeHtml(state.saveError || 'No se pudo guardar el borrador editable.')}</span>
          <button type="button" class="btn-secondary btn-sm" id="btn-editor-retry-save" data-action="retry-save">Reintentar guardado</button>
        </div>

        ${isQuestionSet ? navParts.compactHtml : ''}

        <div class="editor-workspace-body${isQuestionSet ? ' has-sidebar' : ''}">
          ${isQuestionSet ? navParts.sidebarHtml : ''}
          <div class="editor-form-card" id="editor-form-card">
            ${itemToolbarHtml}
            ${formHtml}
          </div>
        </div>

        <div id="editor-progress-banner" class="generation-progress-banner${state.exportState === 'preparing' ? '' : ' hidden'}" role="status" aria-live="polite" aria-atomic="true" aria-hidden="${state.exportState === 'preparing' ? 'false' : 'true'}">
          <span class="generation-spinner" aria-hidden="true"></span>
          <span id="editor-progress-step">${state.exportState === 'preparing' ? 'Revisión confirmada. Empaquetando actividad H5P…' : ''}</span>
          <button type="button" class="btn-secondary btn-cancel-generation" id="btn-editor-cancel-prepare" data-action="cancel-prepare" ${state.exportState === 'preparing' ? '' : 'disabled'}>Cancelar</button>
        </div>

        <p
          id="editor-status-banner"
          class="editor-status-banner"
          role="${state.exportTone === 'error' ? 'alert' : 'status'}"
          aria-live="${state.exportTone === 'error' ? 'assertive' : 'polite'}"
          aria-atomic="true"
          ${state.exportMessage ? `data-state="${escapeHtml(state.exportTone)}"` : ''}
        >${escapeHtml(state.exportMessage || '')}</p>

        <footer class="upcoming-step-actions editor-footer-actions">
          <div class="editor-footer-left">
            <button type="button" class="btn-secondary" id="btn-editor-back-config" data-action="back" ${locked ? 'disabled' : ''}>
              ${escapeHtml(backLabel)}
            </button>
          </div>
          <div class="editor-footer-right">
            <button type="button" class="btn-secondary${showReveal ? '' : ' hidden'}" id="btn-editor-reveal-file" data-action="reveal-file" ${locked ? 'disabled' : ''}>
              Ver en carpeta
            </button>
            <button type="button" class="btn-secondary${showSaveFile ? '' : ' hidden'}" id="btn-editor-save-file" data-action="save-file" ${locked ? 'disabled' : ''}>
              Guardar archivo H5P
            </button>
            <button type="button" class="btn-primary${isExported ? ' hidden' : ''}" id="btn-editor-confirm-prepare" data-action="confirm-prepare" ${canConfirm ? '' : 'disabled'}>
              ${escapeHtml(prepareLabel)}
            </button>
          </div>
        </footer>
      </section>
    `;
  }

  function captureFocusDescriptor(container) {
    if (!container || typeof document === 'undefined') return null;
    const active = document.activeElement;
    if (!active || !container.contains(active)) return null;
    const descriptor = {
      id: active.id || null,
      action: active.dataset?.action || null,
      itemId: active.dataset?.itemId || null,
      optionId: active.dataset?.optionId || null,
      selectionStart: null,
      selectionEnd: null
    };
    if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') {
      try {
        if (typeof active.selectionStart === 'number') {
          descriptor.selectionStart = active.selectionStart;
          descriptor.selectionEnd = active.selectionEnd;
        }
      } catch {
        // Inputs tipo radio/checkbox no soportan selectionStart.
      }
    }
    return descriptor;
  }

  function restoreFocusDescriptor(container, descriptor) {
    if (!container || !descriptor) return false;
    let target = null;
    if (descriptor.id) target = container.querySelector(`#${CSS.escape(descriptor.id)}`);
    if (!target && descriptor.action && descriptor.itemId) {
      target = container.querySelector(`[data-action="${CSS.escape(descriptor.action)}"][data-item-id="${CSS.escape(descriptor.itemId)}"]`);
    }
    if (!target && descriptor.action && descriptor.optionId) {
      target = container.querySelector(`[data-action="${CSS.escape(descriptor.action)}"][data-option-id="${CSS.escape(descriptor.optionId)}"]`);
    }
    if (!target || target.disabled) return false;
    target.focus();
    if (descriptor.selectionStart !== null && typeof target.setSelectionRange === 'function') {
      try {
        target.setSelectionRange(descriptor.selectionStart, descriptor.selectionEnd ?? descriptor.selectionStart);
      } catch {
        // Ignora controles sin selección de texto.
      }
    }
    return true;
  }

  function syncFieldError(container, inputId, errorId, issue) {
    const State = getStateApi();
    const input = container.querySelector(`#${inputId}`);
    const errorEl = container.querySelector(`#${errorId}`);
    const message = issue ? State.getIssueMessage(issue) : '';
    if (input) {
      input.setAttribute('aria-invalid', issue ? 'true' : 'false');
      input.closest('.editor-field-group, .editor-title-bar, .editor-option-row')?.classList.toggle('has-error', Boolean(issue));
    }
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.toggle('hidden', !issue);
    }
  }

  /**
   * Actualiza contadores, errores, pills, botones y vista previa del índice sin destruir los inputs activos.
   */
  function syncEditorIncremental(container, state) {
    if (!container || !state?.activity) return;
    const State = getStateApi();
    const activity = state.activity;
    const item = State.getActiveItem(state);
    const issues = state.issues || [];
    const limits = state.limits || State.DEFAULT_LIMITS;
    const locked = state.exportState === 'preparing' || state.exportState === 'saving_file';

    const card = container.querySelector('#editor-panel-card');
    if (card) card.classList.toggle('is-compact', Boolean(state.isCompact));

    // Save badge
    const savePill = container.querySelector('#editor-save-pill');
    const saveBadge = formatSaveBadge(state);
    if (savePill) {
      savePill.textContent = saveBadge.text;
      savePill.dataset.saveState = saveBadge.tone;
    }

    // Reviewed count pill
    const reviewedPill = container.querySelector('#editor-reviewed-pill');
    if (reviewedPill) {
      reviewedPill.textContent = `${State.getReviewedCount(activity)} de ${activity.items.length} marcadas`;
    }

    // Title counter & error
    const titleCounter = container.querySelector('#editor-title-counter');
    if (titleCounter) titleCounter.textContent = formatCounter(activity.title, limits.title);
    syncFieldError(container, 'editor-title-input', 'editor-title-error', State.getFieldIssue(issues, { field: 'title' }));

    // Issues banner
    const issuesBanner = container.querySelector('#editor-issues-banner');
    const issuesSummary = container.querySelector('#editor-issues-summary');
    if (issuesBanner && issuesSummary) {
      issuesBanner.classList.toggle('hidden', issues.length === 0);
      issuesSummary.textContent = issues.length === 1
        ? 'Hay 1 campo por corregir antes de confirmar y exportar.'
        : `Hay ${issues.length} campos por corregir antes de confirmar y exportar.`;
    }

    // Save error banner
    const saveErrBanner = container.querySelector('#editor-save-error-banner');
    const saveErrText = container.querySelector('#editor-save-error-text');
    if (saveErrBanner && saveErrText) {
      saveErrBanner.classList.toggle('hidden', state.saveState !== 'error');
      saveErrText.textContent = state.saveError || 'No se pudo guardar el borrador editable.';
    }

    // Active item fields
    if (item) {
      if (activity.activityType === 'truefalse') {
        const stCounter = container.querySelector('#editor-statement-counter');
        if (stCounter) stCounter.textContent = formatCounter(item.statement, limits.question);
        syncFieldError(container, 'editor-statement', 'editor-statement-error', State.getFieldIssue(issues, { itemId: item.id, field: 'statement' }));

        const tfErr = container.querySelector('#editor-tf-error');
        const ansIssue = State.getFieldIssue(issues, { itemId: item.id, field: 'isTrue' });
        if (tfErr) {
          tfErr.textContent = ansIssue ? State.getIssueMessage(ansIssue) : '';
          tfErr.classList.toggle('hidden', !ansIssue);
          tfErr.closest('fieldset')?.classList.toggle('has-error', Boolean(ansIssue));
        }
        container.querySelector('label[for="editor-tf-true"]')?.classList.toggle('is-selected', item.isTrue === true);
        container.querySelector('label[for="editor-tf-false"]')?.classList.toggle('is-selected', item.isTrue === false);

        const cfbCounter = container.querySelector('#editor-feedback-correct-counter');
        if (cfbCounter) cfbCounter.textContent = formatCounter(item.feedbackOnCorrect, limits.feedback);
        syncFieldError(container, 'editor-feedback-correct', 'editor-feedback-correct-error', State.getFieldIssue(issues, { itemId: item.id, field: 'feedbackOnCorrect' }));

        const ifbCounter = container.querySelector('#editor-feedback-incorrect-counter');
        if (ifbCounter) ifbCounter.textContent = formatCounter(item.feedbackOnIncorrect, limits.feedback);
        syncFieldError(container, 'editor-feedback-incorrect', 'editor-feedback-incorrect-error', State.getFieldIssue(issues, { itemId: item.id, field: 'feedbackOnIncorrect' }));
      } else {
        const qCounter = container.querySelector('#editor-question-counter');
        if (qCounter) qCounter.textContent = formatCounter(item.question, limits.question);
        syncFieldError(container, 'editor-question', 'editor-question-error', State.getFieldIssue(issues, { itemId: item.id, field: 'question' }));

        const fbCounter = container.querySelector('#editor-feedback-counter');
        if (fbCounter) fbCounter.textContent = formatCounter(item.feedback, limits.feedback);
        syncFieldError(container, 'editor-feedback', 'editor-feedback-error', State.getFieldIssue(issues, { itemId: item.id, field: 'feedback' }));

        const corrIssue = State.getFieldIssue(issues, { itemId: item.id, field: 'correctOptionId' });
        const corrErr = container.querySelector('#editor-correct-error');
        if (corrErr) {
          corrErr.textContent = corrIssue ? State.getIssueMessage(corrIssue) : '';
          corrErr.classList.toggle('hidden', !corrIssue);
          corrErr.closest('fieldset')?.classList.toggle('has-error', Boolean(corrIssue));
        }

        for (const opt of item.options) {
          const optIssue = State.getFieldIssue(issues, { itemId: item.id, optionId: opt.id, field: 'text' });
          syncFieldError(container, `editor-option-${opt.id}`, `editor-option-error-${opt.id}`, optIssue);
          const row = container.querySelector(`[data-option-row="${opt.id}"]`);
          if (row) {
            const isCorrect = item.correctOptionId === opt.id;
            row.classList.toggle('is-correct', isCorrect);
            const tag = row.querySelector('.editor-option-correct-tag');
            if (tag) tag.textContent = isCorrect ? 'Correcta' : 'Elegir';
          }
        }
      }

      const reviewedCheckbox = container.querySelector('#editor-item-reviewed');
      if (reviewedCheckbox && reviewedCheckbox.checked !== Boolean(item.reviewed)) {
        reviewedCheckbox.checked = Boolean(item.reviewed);
      }
    }

    // Sidebar / dropdown preview updates for QuestionSet
    if (activity.activityType === 'questionset') {
      const selectEl = container.querySelector('#editor-question-select');
      activity.items.forEach((entry, idx) => {
        const itemIssues = State.getItemIssues(issues, entry.id);
        const btn = container.querySelector(`.editor-question-nav-btn[data-item-id="${entry.id}"]`);
        if (btn) {
          btn.classList.toggle('has-error', itemIssues.length > 0);
          const preview = btn.querySelector('.editor-nav-preview');
          if (preview) preview.textContent = truncateLabel(entry.question, 46);
          const existingBadge = btn.querySelector('.editor-nav-badge');
          if (existingBadge) existingBadge.remove();
          if (itemIssues.length > 0) {
            const b = document.createElement('span');
            b.className = 'editor-nav-badge is-error';
            b.setAttribute('aria-label', `${itemIssues.length} ${itemIssues.length === 1 ? 'error' : 'errores'}`);
            b.textContent = '!';
            btn.appendChild(b);
          } else if (entry.reviewed) {
            const b = document.createElement('span');
            b.className = 'editor-nav-badge is-reviewed';
            b.setAttribute('aria-label', 'Revisada');
            b.textContent = '✓';
            btn.appendChild(b);
          }
        }
        if (selectEl && selectEl.options[idx]) {
          const suffix = itemIssues.length > 0 ? ' · Pendiente' : (entry.reviewed ? ' · Revisada' : '');
          selectEl.options[idx].textContent = `${idx + 1}. ${truncateLabel(entry.question, 42)}${suffix}`;
        }
      });
    }

    // Progress banner
    const progressBanner = container.querySelector('#editor-progress-banner');
    const progressStep = container.querySelector('#editor-progress-step');
    const cancelBtn = container.querySelector('#btn-editor-cancel-prepare');
    if (progressBanner && progressStep) {
      const isPreparing = state.exportState === 'preparing';
      progressBanner.classList.toggle('hidden', !isPreparing);
      progressBanner.setAttribute('aria-hidden', String(!isPreparing));
      progressStep.textContent = isPreparing ? (state.exportMessage || 'Revisión confirmada. Empaquetando actividad H5P…') : '';
      if (cancelBtn) cancelBtn.disabled = !isPreparing;
    }

    // Status banner
    const statusBanner = container.querySelector('#editor-status-banner');
    if (statusBanner) {
      const showBanner = state.exportState !== 'preparing' && Boolean(state.exportMessage);
      const isError = state.exportTone === 'error';
      statusBanner.setAttribute('role', isError ? 'alert' : 'status');
      statusBanner.setAttribute('aria-live', isError ? 'assertive' : 'polite');
      if (showBanner) {
        statusBanner.dataset.state = state.exportTone || 'info';
        statusBanner.textContent = state.exportMessage;
      } else {
        delete statusBanner.dataset.state;
        statusBanner.textContent = '';
      }
    }

    // Footer action buttons & control locking
    const isExported = state.exportState === 'exported' && !state.sessionId;
    const fieldsLocked = locked || isExported;
    const approved = State.isReviewApproved(state);
    const canConfirm = !fieldsLocked && issues.length === 0 && state.saveState !== 'error';
    const confirmBtn = container.querySelector('#btn-editor-confirm-prepare');
    const saveFileBtn = container.querySelector('#btn-editor-save-file');
    const revealBtn = container.querySelector('#btn-editor-reveal-file');
    const backBtn = container.querySelector('#btn-editor-back-config');

    if (confirmBtn) {
      confirmBtn.classList.toggle('hidden', isExported);
      confirmBtn.disabled = !canConfirm;
      confirmBtn.textContent = state.exportState === 'error'
        ? 'Reintentar empaquetado'
        : approved
          ? 'Volver a preparar H5P'
          : 'Confirmar revisión y preparar H5P';
    }
    if (saveFileBtn) {
      const showSave = approved && !isExported && state.exportState !== 'preparing';
      saveFileBtn.classList.toggle('hidden', !showSave);
      saveFileBtn.disabled = locked;
      saveFileBtn.textContent = state.exportState === 'saving_file' ? 'Guardando…' : 'Guardar archivo H5P';
    }
    if (revealBtn) {
      revealBtn.classList.toggle('hidden', !state.lastExportedProject?.projectId);
      revealBtn.disabled = locked;
    }
    if (backBtn) {
      backBtn.disabled = locked;
      if (isExported) {
        backBtn.textContent = state.courseId && state.courseId !== 'unassigned' ? 'Volver al ramo' : 'Volver a la biblioteca';
      }
    }

    // Lock/unlock inputs while preparing, saving file, or after confirmed export
    container.querySelectorAll('input, textarea, select').forEach(el => {
      if (el.id === 'btn-editor-cancel-prepare') return;
      el.disabled = fieldsLocked;
    });
    const addBtn = container.querySelector('#btn-editor-add-item');
    const addBtnCompact = container.querySelector('#btn-editor-add-item-compact');
    const activeIndex = State.getActiveItemIndex(state);
    if (addBtn) addBtn.disabled = fieldsLocked || activity.items.length >= 20;
    if (addBtnCompact) addBtnCompact.disabled = fieldsLocked || activity.items.length >= 20;
    const moveUp = container.querySelector('#btn-editor-move-up');
    const moveDown = container.querySelector('#btn-editor-move-down');
    const removeBtn = container.querySelector('#btn-editor-remove-item');
    if (moveUp) moveUp.disabled = fieldsLocked || activeIndex <= 0;
    if (moveDown) moveDown.disabled = fieldsLocked || activeIndex >= activity.items.length - 1;
    if (removeBtn) removeBtn.disabled = fieldsLocked || activity.items.length <= 1;
    const prevBtn = container.querySelector('#btn-editor-prev-item');
    const nextBtn = container.querySelector('#btn-editor-next-item');
    if (prevBtn) prevBtn.disabled = fieldsLocked || activeIndex <= 0;
    if (nextBtn) nextBtn.disabled = fieldsLocked || activeIndex >= activity.items.length - 1;
    container.querySelectorAll('.editor-question-nav-btn').forEach(btn => {
      btn.disabled = fieldsLocked;
    });
  }

  function focusSelector(container, selector) {
    if (!container || !selector) return false;
    const target = container.querySelector(selector);
    if (!target || target.disabled) return false;
    target.focus();
    if (typeof target.scrollIntoView === 'function') {
      try { target.scrollIntoView({ block: 'nearest' }); } catch {}
    }
    return true;
  }

  const api = {
    COMPACT_BREAKPOINT_PX,
    renderEditorTemplate,
    renderChoiceFormHtml,
    renderTrueFalseFormHtml,
    captureFocusDescriptor,
    restoreFocusDescriptor,
    syncEditorIncremental,
    focusSelector
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.H5PEditorForms = api;
  }
})(typeof window !== 'undefined' ? window : null);
