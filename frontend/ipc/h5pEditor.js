'use strict';

const { randomUUID } = require('node:crypto');
const { EDITABLE_TEXT_LIMITS } = require('../../backend/activityValidation');
const { applyActivityEdits, getActivityIssues } = require('../../backend/editor/activityEdits');

const MESSAGES = Object.freeze({
  DRAFT_NOT_FOUND: 'El borrador solicitado ya no está disponible.',
  NOT_EDITABLE: 'Este proyecto no tiene contenido editable local.',
  EDITOR_LOCKED: 'Esta actividad ya está abierta en otra sesión de edición.',
  SESSION_NOT_FOUND: 'La sesión de edición ya no está activa. Vuelve a abrir la actividad.',
  NO_EDITABLE_CONTENT: 'Todavía no hay contenido generado para editar en esta sesión.',
  REVISION_CONFLICT: 'La actividad cambió desde tu última lectura. Actualiza antes de continuar.',
  ITEM_NOT_FOUND: 'El elemento que intentas modificar ya no existe.',
  ITEM_COUNT: 'No se puede superar el límite ni eliminar el último elemento de la actividad.',
  INVALID_OPERATION: 'La operación de edición solicitada no es válida.',
  INVALID_EDITABLE: 'El contenido de la actividad no tiene un formato editable válido.',
  EDITORIAL_UNREADABLE: 'No se pudo leer el contenido editable guardado para este registro.',
  EDITORIAL_VERSION_UNSUPPORTED: 'Este contenido editable fue guardado con una versión no compatible.',
  EDITORIAL_TOO_LARGE: 'El contenido de la actividad supera el tamaño máximo permitido.',
  PERSISTENCE_FAILED: 'No se pudo guardar el borrador editable. Conserva esta ventana abierta e inténtalo de nuevo.',
  BUSY: 'Hay una operación en curso sobre esta actividad. Espera a que termine.'
});

function fail(code, extra = null) {
  const response = { status: 'error', code, message: MESSAGES[code] || 'No se pudo completar la operación.' };
  if (extra) Object.assign(response, extra);
  return response;
}

function projectActivityDto(activity) {
  if (!activity) return null;
  return structuredClone({
    schemaVersion: activity.schemaVersion,
    activityId: activity.activityId,
    activityType: activity.activityType,
    title: activity.title,
    revision: activity.revision,
    reviewedRevision: activity.reviewedRevision,
    items: activity.items
  });
}

function projectSourceDto(source) {
  if (!source) return null;
  return {
    activityType: source.activityType,
    questionCount: source.questionCount,
    title: source.title
  };
}

function toSourceFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .map(file => (typeof file?.name === 'string' && file.name.trim() ? { name: file.name.trim().slice(0, 255) } : null))
    .filter(Boolean);
}

function mapReadError(error) {
  if (error?.code === 'EDITORIAL_VERSION_UNSUPPORTED') return fail('EDITORIAL_VERSION_UNSUPPORTED');
  if (error?.code === 'EDITORIAL_TOO_LARGE') return fail('EDITORIAL_TOO_LARGE');
  return fail('EDITORIAL_UNREADABLE');
}

function createH5PEditor({ storage }) {
  const sessionsById = new Map();
  const draftLocks = new Map();
  const senderTrackers = new WeakMap();
  const invalidationListeners = new Set();

  function emitInvalidation(session, reason) {
    for (const listener of invalidationListeners) {
      try {
        listener(session, reason);
      } catch {
        // Las invalidaciones auxiliares no deben interrumpir la operación principal.
      }
    }
  }

  function cleanupSenderTracker(sender) {
    const tracker = senderTrackers.get(sender);
    if (!tracker || tracker.sessions.size > 0) return;
    senderTrackers.delete(sender);
    sender.removeListener('destroyed', tracker.onDestroyed);
    sender.removeListener('did-start-navigation', tracker.onNavigation);
  }

  function closeSessionInternal(session, reason = 'closed') {
    if (!session || session.closed) return false;
    session.closed = true;
    sessionsById.delete(session.id);
    if (draftLocks.get(session.draftId) === session.id) {
      draftLocks.delete(session.draftId);
    }
    const tracker = senderTrackers.get(session.sender);
    if (tracker) {
      tracker.sessions.delete(session);
      cleanupSenderTracker(session.sender);
    }
    emitInvalidation(session, reason);
    return true;
  }

  function trackSession(sender, session) {
    let tracker = senderTrackers.get(sender);
    if (!tracker) {
      const closeAllForSender = (reason) => {
        const current = senderTrackers.get(sender);
        if (!current) return;
        for (const entry of Array.from(current.sessions)) {
          closeSessionInternal(entry, reason);
        }
      };
      tracker = {
        sessions: new Set(),
        onDestroyed: () => closeAllForSender('destroyed'),
        onNavigation: (_event, _url, inPlace, isMainFrame) => {
          if (isMainFrame && !inPlace) closeAllForSender('navigated');
        }
      };
      senderTrackers.set(sender, tracker);
      sender.once('destroyed', tracker.onDestroyed);
      sender.on('did-start-navigation', tracker.onNavigation);
    }
    tracker.sessions.add(session);
  }

  function getSession(sender, sessionId) {
    const session = sessionsById.get(sessionId);
    if (!session || session.closed || session.sender !== sender || sender?.isDestroyed?.()) {
      return null;
    }
    return session;
  }

  function buildSessionDto(session) {
    const activity = session.activity ? projectActivityDto(session.activity) : null;
    const issues = session.activity ? getActivityIssues(session.activity) : [];
    const dto = {
      status: 'ok',
      sessionId: session.id,
      draftId: session.draftId,
      courseId: session.courseId,
      hasContent: Boolean(activity),
      activity,
      issues,
      source: projectSourceDto(session.source),
      limits: { ...EDITABLE_TEXT_LIMITS }
    };
    if (session.projectId) dto.projectId = session.projectId;
    return dto;
  }

  async function openEditor(request, event) {
    const sender = event.sender;
    if (sender?.isDestroyed?.()) return fail('SESSION_NOT_FOUND');

    let draft = null;
    let activity = null;
    let source = null;
    let projectId = null;

    if (Object.hasOwn(request, 'draftId')) {
      let drafts;
      try {
        drafts = storage.getDrafts();
      } catch {
        return fail('EDITORIAL_UNREADABLE');
      }
      draft = Array.isArray(drafts) ? drafts.find(item => item.id === request.draftId) : null;
      if (!draft) return fail('DRAFT_NOT_FOUND');
      if (draftLocks.has(draft.id)) return fail('EDITOR_LOCKED');

      try {
        const editorial = storage.getEditorialDraft(draft.id);
        if (editorial) {
          activity = editorial.activity;
          source = editorial.source;
        }
      } catch (error) {
        return mapReadError(error);
      }
    } else if (Object.hasOwn(request, 'projectId')) {
      projectId = request.projectId;
      let opened;
      try {
        opened = storage.openProjectDraft(projectId);
      } catch (error) {
        return mapReadError(error);
      }
      if (!opened || !opened.draft) return fail('NOT_EDITABLE');
      if (draftLocks.has(opened.draft.id)) return fail('EDITOR_LOCKED');
      draft = opened.draft;
      activity = opened.activity;
      source = opened.source;
    } else {
      return fail('INVALID_OPERATION');
    }

    const sessionId = randomUUID();
    const session = {
      id: sessionId,
      sender,
      draftId: draft.id,
      courseId: draft.courseId || 'unassigned',
      projectId,
      activity: activity ? structuredClone(activity) : null,
      source: source ? structuredClone(source) : null,
      sourceFiles: toSourceFiles(draft.files),
      busy: false,
      closed: false
    };

    sessionsById.set(sessionId, session);
    draftLocks.set(draft.id, sessionId);
    trackSession(sender, session);
    return buildSessionDto(session);
  }

  async function updateEditor(request, event) {
    const session = getSession(event.sender, request.sessionId);
    if (!session) return fail('SESSION_NOT_FOUND');
    if (session.busy) return fail('BUSY');
    if (!session.activity || !session.source) return fail('NO_EDITABLE_CONTENT');
    if (session.activity.revision !== request.expectedRevision) {
      return fail('REVISION_CONFLICT', { revision: session.activity.revision });
    }

    let nextActivity;
    try {
      nextActivity = applyActivityEdits(session.activity, request.operations);
    } catch (error) {
      if (['ITEM_NOT_FOUND', 'ITEM_COUNT', 'INVALID_OPERATION', 'INVALID_EDITABLE'].includes(error?.code)) {
        return fail(error.code);
      }
      return fail('INVALID_OPERATION');
    }

    let issues;
    try {
      issues = getActivityIssues(nextActivity);
    } catch {
      return fail('INVALID_EDITABLE');
    }

    try {
      storage.saveEditorialDraft(session.draftId, {
        activity: nextActivity,
        source: session.source
      });
    } catch (error) {
      if (error?.message === 'EDITORIAL_DRAFT_NOT_FOUND') {
        closeSessionInternal(session, 'draft-deleted');
        return fail('DRAFT_NOT_FOUND');
      }
      if (error?.code === 'EDITORIAL_TOO_LARGE') return fail('EDITORIAL_TOO_LARGE');
      return fail('PERSISTENCE_FAILED');
    }

    const revisionChanged = nextActivity.revision !== session.activity.revision;
    session.activity = nextActivity;
    if (revisionChanged) {
      emitInvalidation(session, 'content-changed');
    }

    return {
      status: 'ok',
      sessionId: session.id,
      draftId: session.draftId,
      courseId: session.courseId,
      activity: projectActivityDto(nextActivity),
      issues,
      source: projectSourceDto(session.source),
      revisionChanged
    };
  }

  async function closeEditor(request, event) {
    const session = getSession(event.sender, request.sessionId);
    if (!session) return fail('SESSION_NOT_FOUND');
    closeSessionInternal(session, 'closed');
    return { status: 'ok', closed: true };
  }

  function setSessionBusy(sender, sessionId, busy) {
    const session = getSession(sender, sessionId);
    if (!session) return false;
    session.busy = Boolean(busy);
    return true;
  }

  function saveGeneratedContent(sender, sessionId, { activity, source, sourceFiles }) {
    const session = getSession(sender, sessionId);
    if (!session) return fail('SESSION_NOT_FOUND');
    try {
      storage.saveEditorialDraft(session.draftId, { activity, source });
    } catch (error) {
      if (error?.message === 'EDITORIAL_DRAFT_NOT_FOUND') {
        closeSessionInternal(session, 'draft-deleted');
        return fail('DRAFT_NOT_FOUND');
      }
      if (error?.code === 'EDITORIAL_TOO_LARGE') return fail('EDITORIAL_TOO_LARGE');
      return fail('PERSISTENCE_FAILED');
    }
    session.activity = structuredClone(activity);
    session.source = structuredClone(source);
    if (Array.isArray(sourceFiles) && sourceFiles.length > 0) {
      session.sourceFiles = toSourceFiles(sourceFiles);
    }
    emitInvalidation(session, 'regenerated');
    return buildSessionDto(session);
  }

  function saveConfirmedActivity(sender, sessionId, confirmedActivity) {
    const session = getSession(sender, sessionId);
    if (!session || !session.source) return fail('SESSION_NOT_FOUND');
    try {
      storage.saveEditorialDraft(session.draftId, {
        activity: confirmedActivity,
        source: session.source
      });
    } catch (error) {
      if (error?.message === 'EDITORIAL_DRAFT_NOT_FOUND') {
        closeSessionInternal(session, 'draft-deleted');
        return fail('DRAFT_NOT_FOUND');
      }
      if (error?.code === 'EDITORIAL_TOO_LARGE') return fail('EDITORIAL_TOO_LARGE');
      return fail('PERSISTENCE_FAILED');
    }
    session.activity = structuredClone(confirmedActivity);
    return buildSessionDto(session);
  }

  function releaseDraft(draftId) {
    const sessionId = draftLocks.get(draftId);
    if (!sessionId) return false;
    const session = sessionsById.get(sessionId);
    return closeSessionInternal(session, 'draft-deleted');
  }

  function closeSessionById(sessionId, reason = 'exported') {
    const session = sessionsById.get(sessionId);
    return closeSessionInternal(session, reason);
  }

  function closeAll(reason = 'reset') {
    for (const session of Array.from(sessionsById.values())) {
      closeSessionInternal(session, reason);
    }
  }

  function onSessionInvalidated(listener) {
    invalidationListeners.add(listener);
    return () => invalidationListeners.delete(listener);
  }

  return {
    openEditor,
    updateEditor,
    closeEditor,
    getSession,
    setSessionBusy,
    saveGeneratedContent,
    saveConfirmedActivity,
    releaseDraft,
    closeSessionById,
    closeAll,
    onSessionInvalidated
  };
}

module.exports = { createH5PEditor, projectActivityDto, projectSourceDto };
