/**
 * frontend/js/editor/editorState.js
 * Estado puro del editor en el renderer y utilidades de validación/navegación local.
 */
(function (root) {
  'use strict';

  const DEFAULT_LIMITS = Object.freeze({
    title: 180,
    question: 2000,
    option: 1000,
    feedback: 2000
  });

  const ACTIVITY_TYPE_LABELS = Object.freeze({
    questionset: 'Cuestionario (H5P.QuestionSet)',
    multichoice: 'Opción Múltiple (H5P.MultiChoice)',
    truefalse: 'Verdadero o Falso (H5P.TrueFalse)'
  });

  const ISSUE_MESSAGES = Object.freeze({
    title: {
      REQUIRED: 'Escribe un título para la actividad.'
    },
    question: {
      REQUIRED: 'Escribe el enunciado de la pregunta.'
    },
    statement: {
      REQUIRED: 'Escribe la afirmación a evaluar.'
    },
    text: {
      REQUIRED: 'Completa el texto de esta alternativa.',
      DUPLICATE_OPTION: 'Esta alternativa está repetida. Escribe una opción distinta.'
    },
    correctOptionId: {
      REQUIRED: 'Selecciona cuál de las cuatro alternativas es la correcta.'
    },
    isTrue: {
      REQUIRED: 'Indica si la afirmación es verdadera o falsa.'
    },
    feedback: {
      REQUIRED: 'Escribe la retroalimentación para esta pregunta.'
    },
    feedbackOnCorrect: {
      REQUIRED: 'Escribe la retroalimentación cuando el estudiante acierta.'
    },
    feedbackOnIncorrect: {
      REQUIRED: 'Escribe la retroalimentación cuando el estudiante se equivoca.'
    }
  });

  function cloneValue(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeEditableTitle(title) {
    if (typeof title !== 'string') return '';
    return title.trim().replace(/(?:\s*\.h5p)+$/i, '').replace(/\s+/g, ' ').trim();
  }

  function optionTextKey(value) {
    return typeof value === 'string' ? value.trim().toLocaleLowerCase('es') : '';
  }

  function computeLocalIssues(activity) {
    if (!activity || !Array.isArray(activity.items)) return [];
    const issues = [];
    if (!normalizeEditableTitle(activity.title || '')) {
      issues.push({ field: 'title', code: 'REQUIRED' });
    }
    const isTrueFalse = activity.activityType === 'truefalse';
    for (const item of activity.items) {
      const itemId = item.id;
      if (isTrueFalse) {
        if (!String(item.statement || '').trim()) issues.push({ itemId, field: 'statement', code: 'REQUIRED' });
        if (!String(item.feedbackOnCorrect || '').trim()) issues.push({ itemId, field: 'feedbackOnCorrect', code: 'REQUIRED' });
        if (!String(item.feedbackOnIncorrect || '').trim()) issues.push({ itemId, field: 'feedbackOnIncorrect', code: 'REQUIRED' });
        if (item.isTrue === null || typeof item.isTrue !== 'boolean') {
          issues.push({ itemId, field: 'isTrue', code: 'REQUIRED' });
        }
        continue;
      }

      if (!String(item.question || '').trim()) issues.push({ itemId, field: 'question', code: 'REQUIRED' });
      if (!String(item.feedback || '').trim()) issues.push({ itemId, field: 'feedback', code: 'REQUIRED' });
      if (!item.correctOptionId) issues.push({ itemId, field: 'correctOptionId', code: 'REQUIRED' });

      const options = Array.isArray(item.options) ? item.options : [];
      const keys = options.map(opt => optionTextKey(opt.text));
      options.forEach((opt, index) => {
        const key = keys[index];
        if (!key || keys.indexOf(key) !== keys.lastIndexOf(key)) {
          issues.push({
            itemId,
            optionId: opt.id,
            field: 'text',
            code: key ? 'DUPLICATE_OPTION' : 'REQUIRED'
          });
        }
      });
    }
    return issues;
  }

  function getIssueMessage(issue) {
    if (!issue) return '';
    return ISSUE_MESSAGES[issue.field]?.[issue.code] || 'Revisa este campo antes de exportar.';
  }

  function applyOptimisticOperation(activity, operation) {
    if (!activity || !operation) return { activity, changed: false };
    const next = cloneValue(activity);
    let changed = false;

    if (operation.type === 'setTitle') {
      if (next.title !== operation.title) {
        next.title = operation.title;
        changed = true;
      }
    } else {
      const idx = next.items.findIndex(item => item.id === operation.itemId);
      if (idx < 0) return { activity: next, changed: false };
      const item = next.items[idx];

      switch (operation.type) {
        case 'setItemText':
          if (item[operation.field] !== operation.text) {
            item[operation.field] = operation.text;
            delete item.reviewed;
            changed = true;
          }
          break;
        case 'setOptionText': {
          const opt = item.options?.find(entry => entry.id === operation.optionId);
          if (opt && opt.text !== operation.text) {
            opt.text = operation.text;
            delete item.reviewed;
            changed = true;
          }
          break;
        }
        case 'setCorrectOption':
          if (item.correctOptionId !== operation.optionId) {
            item.correctOptionId = operation.optionId;
            delete item.reviewed;
            changed = true;
          }
          break;
        case 'setTrueFalseAnswer':
          if (item.isTrue !== operation.value) {
            item.isTrue = operation.value;
            delete item.reviewed;
            changed = true;
          }
          break;
        case 'markItemReviewed':
          item.reviewed = Boolean(operation.reviewed);
          break;
        case 'moveItem': {
          const targetIndex = operation.index;
          if (Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < next.items.length && targetIndex !== idx) {
            const [moved] = next.items.splice(idx, 1);
            next.items.splice(targetIndex, 0, moved);
            changed = true;
          }
          break;
        }
        default:
          break;
      }
    }

    if (changed) {
      next.reviewedRevision = null;
    }
    return { activity: next, changed };
  }

  function createEditorState(sessionDto = null) {
    const activity = sessionDto?.activity ? cloneValue(sessionDto.activity) : null;
    const issues = Array.isArray(sessionDto?.issues)
      ? cloneValue(sessionDto.issues)
      : computeLocalIssues(activity);
    const firstItemId = activity?.items?.[0]?.id || null;
    return {
      sessionId: sessionDto?.sessionId || null,
      draftId: sessionDto?.draftId || null,
      courseId: sessionDto?.courseId || 'unassigned',
      projectId: sessionDto?.projectId || null,
      origin: sessionDto?.origin || 'wizard',
      limits: { ...DEFAULT_LIMITS, ...(sessionDto?.limits || {}) },
      source: sessionDto?.source ? cloneValue(sessionDto.source) : null,
      activity,
      serverRevision: activity?.revision || 0,
      issues,
      activeItemId: firstItemId,
      isCompact: false,
      saveState: 'saved',
      saveError: '',
      lastSavedAt: null,
      exportState: 'idle',
      exportMessage: '',
      exportTone: 'info',
      preparedPackage: null,
      lastExportedProject: null
    };
  }

  function getActiveItem(state) {
    const items = state?.activity?.items;
    if (!Array.isArray(items) || items.length === 0) return null;
    return items.find(item => item.id === state.activeItemId) || items[0];
  }

  function getActiveItemIndex(state) {
    const items = state?.activity?.items;
    if (!Array.isArray(items) || items.length === 0) return -1;
    const idx = items.findIndex(item => item.id === state.activeItemId);
    return idx >= 0 ? idx : 0;
  }

  function getItemIssues(issues, itemId) {
    if (!Array.isArray(issues)) return [];
    return issues.filter(issue => issue.itemId === itemId);
  }

  function getFieldIssue(issues, { itemId = null, optionId = null, field }) {
    if (!Array.isArray(issues)) return null;
    return issues.find(issue =>
      issue.field === field &&
      (itemId === null ? !issue.itemId : issue.itemId === itemId) &&
      (optionId === null ? !issue.optionId : issue.optionId === optionId)
    ) || null;
  }

  function getFirstIssueTarget(state) {
    const issues = state?.issues;
    if (!Array.isArray(issues) || issues.length === 0) return null;
    const first = issues[0];
    if (first.field === 'title') {
      return { issue: first, itemId: null, selector: '#editor-title-input' };
    }
    const item = state.activity?.items?.find(entry => entry.id === first.itemId) || null;
    if (!item) return { issue: first, itemId: null, selector: '#editor-title-input' };

    if (first.field === 'text' && first.optionId) {
      return { issue: first, itemId: item.id, selector: `#editor-option-${first.optionId}` };
    }
    if (first.field === 'correctOptionId') {
      const firstOptId = item.options?.[0]?.id;
      return { issue: first, itemId: item.id, selector: firstOptId ? `#editor-correct-${firstOptId}` : '#editor-question' };
    }
    const fieldSelectors = {
      question: '#editor-question',
      feedback: '#editor-feedback',
      statement: '#editor-statement',
      isTrue: '#editor-tf-true',
      feedbackOnCorrect: '#editor-feedback-correct',
      feedbackOnIncorrect: '#editor-feedback-incorrect'
    };
    return {
      issue: first,
      itemId: item.id,
      selector: fieldSelectors[first.field] || '#editor-title-input'
    };
  }

  function formatActivityTypeLabel(activityType) {
    return ACTIVITY_TYPE_LABELS[activityType] || 'Actividad H5P';
  }

  function getReviewedCount(activity) {
    if (!activity || !Array.isArray(activity.items)) return 0;
    return activity.items.filter(item => item.reviewed === true).length;
  }

  function isReviewApproved(state) {
    const activity = state?.activity;
    return Boolean(
      activity &&
      activity.reviewedRevision !== null &&
      activity.reviewedRevision === activity.revision &&
      state.preparedPackage &&
      state.preparedPackage.revision === activity.revision
    );
  }

  const api = {
    DEFAULT_LIMITS,
    ACTIVITY_TYPE_LABELS,
    cloneValue,
    normalizeEditableTitle,
    optionTextKey,
    computeLocalIssues,
    getIssueMessage,
    applyOptimisticOperation,
    createEditorState,
    getActiveItem,
    getActiveItemIndex,
    getItemIssues,
    getFieldIssue,
    getFirstIssueTarget,
    formatActivityTypeLabel,
    getReviewedCount,
    isReviewApproved
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.H5PEditorState = api;
  }
})(typeof window !== 'undefined' ? window : null);
