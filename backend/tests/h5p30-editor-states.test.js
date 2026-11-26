'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEditableActivity } = require('../editor/editableActivity');
const { applyActivityEdits, confirmActivityReview, getActivityIssues } = require('../editor/activityEdits');
const EditorController = require('../../frontend/js/editor/editorController');

function createFakeDomContainer() {
  const listeners = new Map();
  const elementsById = new Map();
  let focusedId = null;

  function makeEl(id, extra = {}) {
    const classes = new Set();
    const attrs = {};
    const el = {
      id,
      dataset: {},
      disabled: false,
      textContent: '',
      value: '',
      checked: false,
      options: [],
      classList: {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (c, force) => {
          if (force === undefined) { if (classes.has(c)) classes.delete(c); else classes.add(c); }
          else if (force) classes.add(c);
          else classes.delete(c);
        },
        contains: c => classes.has(c)
      },
      setAttribute: (k, v) => { attrs[k] = String(v); },
      getAttribute: k => attrs[k],
      closest: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      focus: () => { focusedId = id; },
      scrollIntoView: () => {},
      ...extra
    };
    elementsById.set(id, el);
    return el;
  }

  for (const id of [
    'editor-panel-card', 'editor-panel-title', 'editor-save-pill', 'editor-reviewed-pill',
    'editor-title-input', 'editor-title-counter', 'editor-title-error',
    'editor-issues-banner', 'editor-issues-summary', 'btn-editor-first-error',
    'editor-save-error-banner', 'editor-save-error-text', 'btn-editor-retry-save',
    'editor-progress-banner', 'editor-progress-step', 'btn-editor-cancel-prepare',
    'editor-status-banner', 'btn-editor-back-config', 'btn-editor-reveal-file',
    'btn-editor-save-file', 'btn-editor-confirm-prepare',
    'editor-statement', 'editor-statement-counter', 'editor-statement-error',
    'editor-tf-true', 'editor-tf-false', 'editor-tf-error',
    'editor-feedback-correct', 'editor-feedback-correct-counter', 'editor-feedback-correct-error',
    'editor-feedback-incorrect', 'editor-feedback-incorrect-counter', 'editor-feedback-incorrect-error',
    'editor-item-reviewed'
  ]) {
    makeEl(id);
  }

  const container = {
    dataset: {},
    innerHTML: '',
    clientWidth: 900,
    getBoundingClientRect: () => ({ width: 900 }),
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    querySelector: sel => {
      if (sel.startsWith('#')) return elementsById.get(sel.slice(1)) || null;
      return null;
    },
    querySelectorAll: () => [],
    contains: () => false,
    dispatch(type, event) {
      for (const fn of listeners.get(type) || []) fn(event);
    },
    getEl: id => elementsById.get(id),
    getFocusedId: () => focusedId
  };

  return container;
}

function makeTrueFalseActivity() {
  return createEditableActivity({
    activityType: 'truefalse',
    title: 'Afirmación de prueba',
    items: [{
      afirmacion: 'El protocolo HTTPS cifra el canal.',
      esVerdadera: true,
      retroalimentacionCorrecta: 'Correcto, usa TLS.',
      retroalimentacionIncorrecta: 'Revisa el uso de TLS.'
    }]
  });
}

test('editorController recupera fallos de persistencia, worker, diálogo cancelado y registro sin duplicar alertas', async () => {
  const container = createFakeDomContainer();
  let serverActivity = makeTrueFalseActivity();
  let failSave = false;
  let failWorker = false;
  let dialogMode = 'cancel';
  let saveFileCalls = 0;
  let prepareCalls = 0;
  let exportedEvents = [];

  const mockApi = {
    async updateEditor({ expectedRevision, operations }) {
      if (failSave) return { status: 'error', code: 'PERSISTENCE_FAILED', message: 'No se pudo guardar el borrador editable.' };
      if (serverActivity.revision !== expectedRevision) return { status: 'error', code: 'REVISION_CONFLICT', revision: serverActivity.revision };
      serverActivity = applyActivityEdits(serverActivity, operations);
      return { status: 'ok', activity: structuredClone(serverActivity), issues: getActivityIssues(serverActivity) };
    },
    async prepareReviewedH5P({ expectedRevision }) {
      prepareCalls++;
      if (failWorker) return { status: 'error', code: 'PACKAGE_FAILED', message: 'No se pudo preparar el archivo H5P.' };
      if (serverActivity.revision !== expectedRevision) return { status: 'error', code: 'REVISION_CONFLICT', revision: serverActivity.revision };
      serverActivity = confirmActivityReview(serverActivity);
      return {
        status: 'ok',
        packageId: `pkg-${prepareCalls}`,
        revision: serverActivity.revision,
        reviewedRevision: serverActivity.reviewedRevision,
        title: serverActivity.title
      };
    },
    async saveH5PFile() {
      saveFileCalls++;
      if (dialogMode === 'cancel') return { status: 'cancelled' };
      if (dialogMode === 'reg-fail') {
        return { status: 'ok', fileName: 'prueba.h5p', fileSaved: true, projectSaved: false, projectId: null, draftRemoved: false, draftId: 'draft-1' };
      }
      return { status: 'ok', fileName: 'prueba.h5p', fileSaved: true, projectSaved: true, projectId: 'proj-1', draftRemoved: true, draftId: 'draft-1' };
    },
    async closeEditor() { return { status: 'ok', closed: true }; }
  };

  const controller = EditorController.createEditorController({
    container,
    api: mockApi,
    onExported: res => exportedEvents.push(res)
  });

  controller.mountSession({
    sessionId: '01234567-89ab-4cde-8fab-0123456789ab',
    draftId: 'draft-1',
    courseId: 'unassigned',
    activity: structuredClone(serverActivity),
    issues: []
  });

  // 1) Fallo de persistencia al editar: conserva el texto local y muestra un único aviso de error
  failSave = true;
  container.dispatch('input', { target: { dataset: { action: 'set-title' }, value: 'Título editado con fallo' } });
  const clickAction = action => container.dispatch('click', { target: { closest: () => ({ dataset: { action }, disabled: false }) } });

  // Intentar confirmar dispara flush -> falla guardado -> queda en saveState='error', sin duplicar #editor-status-banner
  clickAction('confirm-prepare');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(controller.getState().saveState, 'error');
  assert.equal(controller.getState().activity.title, 'Título editado con fallo');
  assert.equal(container.getEl('editor-save-error-banner').classList.contains('hidden'), false);
  assert.equal(container.getEl('editor-status-banner').textContent, '');
  assert.equal(container.getFocusedId(), 'btn-editor-retry-save');
  assert.equal(prepareCalls, 0);

  // Reintentar guardado recupera sin perder el título
  failSave = false;
  clickAction('retry-save');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(controller.getState().saveState, 'saved');
  assert.equal(serverActivity.title, 'Título editado con fallo');
  assert.equal(container.getEl('editor-save-error-banner').classList.contains('hidden'), true);

  // 2) Fallo del worker al preparar: ofrece reintento y conserva contenido
  failWorker = true;
  clickAction('confirm-prepare');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(controller.getState().exportState, 'error');
  assert.equal(container.getEl('editor-status-banner').getAttribute('role'), 'alert');
  assert.equal(container.getEl('btn-editor-confirm-prepare').textContent, 'Reintentar empaquetado');
  assert.equal(container.getFocusedId(), 'btn-editor-confirm-prepare');

  // Reintento del empaquetado tiene éxito y mueve el foco a Guardar archivo H5P
  failWorker = false;
  clickAction('confirm-prepare');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(controller.getState().exportState, 'ready');
  assert.equal(container.getEl('btn-editor-save-file').classList.contains('hidden'), false);
  assert.equal(container.getFocusedId(), 'btn-editor-save-file');

  // 3) Diálogo cancelado: conserva paquete listo y permite reintentar
  dialogMode = 'cancel';
  clickAction('save-file');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(controller.getState().exportState, 'ready');
  assert.match(container.getEl('editor-status-banner').textContent, /cancelado/i);
  assert.equal(container.getFocusedId(), 'btn-editor-save-file');

  // 4) Fallo de registro tras escribir archivo: distingue archivo guardado y borrador conservado
  dialogMode = 'reg-fail';
  clickAction('save-file');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(controller.getState().exportState, 'exported_warning');
  assert.equal(container.getEl('editor-status-banner').dataset.state, 'warning');
  assert.match(container.getEl('editor-status-banner').textContent, /borrador editable se conservó/i);
  assert.ok(controller.getSessionId());

  // 5) Reintento con registro exitoso cierra sesión y enfoca Ver en carpeta
  dialogMode = 'ok';
  clickAction('save-file');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(controller.getState().exportState, 'exported');
  assert.equal(controller.getSessionId(), null);
  assert.equal(container.getEl('btn-editor-reveal-file').classList.contains('hidden'), false);
  assert.equal(container.getFocusedId(), 'btn-editor-reveal-file');
  assert.equal(saveFileCalls, 3);
  assert.equal(exportedEvents.length, 2);
});
