'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AcademicStorage } = require('../storage');
const { createEditableActivity } = require('../editor/editableActivity');
const { confirmActivityReview } = require('../editor/activityEdits');
const { createH5PEditor } = require('../../frontend/ipc/h5pEditor');
const { registerH5PIpcHandlers } = require('../../frontend/ipc/h5pHandlers');

function createSender() {
  let destroyed = false;
  const sender = Object.assign(new EventEmitter(), {
    isDestroyed: () => destroyed,
    destroy() {
      destroyed = true;
      this.emit('destroyed');
    }
  });
  return sender;
}

function makeQuestionSet(title = 'Cuestionario base') {
  const activity = createEditableActivity({
    activityType: 'questionset',
    title,
    items: [
      {
        pregunta: '¿Qué protege la integridad?',
        opciones: ['Exactitud', 'Velocidad', 'Tamaño', 'Color'],
        respuestaCorrecta: 'Exactitud',
        retroalimentacion: 'Protege la exactitud.'
      },
      {
        pregunta: '¿Qué es disponibilidad?',
        opciones: ['Acceso oportuno', 'Cifrado', 'Compresión', 'Formato'],
        respuestaCorrecta: 'Acceso oportuno',
        retroalimentacion: 'Garantiza acceso oportuno.'
      }
    ]
  });
  return {
    activity,
    source: {
      activityType: 'questionset',
      questionCount: 2,
      title,
      instructions: 'INSTRUCCIONES_PRIVADAS'
    }
  };
}

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p30-editor-ipc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = new AcademicStorage(path.join(dir, 'academic_store.json'));
  const editor = createH5PEditor({ storage });
  const handlers = new Map();
  registerH5PIpcHandlers(
    { handle: (channel, fn) => handlers.set(channel, fn) },
    event => Boolean(event?.trusted),
    { inspect: async () => ({ status: 'ok' }), release: async () => ({ status: 'ok' }) },
    {},
    editor
  );
  const call = (channel, sender, payload) => handlers.get(channel)({ trusted: true, sender }, payload);
  return { storage, editor, handlers, call };
}

test('dos ventanas editan dos borradores del mismo ramo y se impide doble sesión escritora por registro', async t => {
  const { storage, call } = setup(t);
  const course = storage.saveCourse({ name: 'Seguridad Informática' });
  const draftA = storage.saveDraft({ courseId: course.id, courseName: course.name, activityType: 'questionset', questionCount: 2 });
  const draftB = storage.saveDraft({ courseId: course.id, courseName: course.name, activityType: 'questionset', questionCount: 2 });
  storage.saveEditorialDraft(draftA.id, makeQuestionSet('Borrador A'));
  storage.saveEditorialDraft(draftB.id, makeQuestionSet('Borrador B'));

  const win1 = createSender();
  const win2 = createSender();

  const openedA = await call('h5p:open-editor', win1, { draftId: draftA.id });
  assert.equal(openedA.status, 'ok');
  assert.equal(openedA.courseId, course.id);
  assert.equal(openedA.draftId, draftA.id);
  assert.equal(openedA.hasContent, true);
  assert.equal(openedA.activity.title, 'Borrador A');
  assert.equal(JSON.stringify(openedA).includes('INSTRUCCIONES_PRIVADAS'), false);

  // Otra ventana no puede abrir el mismo borrador mientras está bloqueado
  assert.equal((await call('h5p:open-editor', win2, { draftId: draftA.id })).code, 'EDITOR_LOCKED');
  // La misma ventana tampoco puede abrir una segunda sesión escritora sobre el mismo registro
  assert.equal((await call('h5p:open-editor', win1, { draftId: draftA.id })).code, 'EDITOR_LOCKED');

  // La segunda ventana sí puede abrir otro borrador del mismo ramo en paralelo
  const openedB = await call('h5p:open-editor', win2, { draftId: draftB.id });
  assert.equal(openedB.status, 'ok');
  assert.equal(openedB.courseId, course.id);
  assert.equal(openedB.draftId, draftB.id);

  // Sesión ajena es rechazada al actualizar o cerrar
  const foreignUpdate = await call('h5p:update-editor', win2, {
    sessionId: openedA.sessionId,
    expectedRevision: openedA.activity.revision,
    operations: [{ type: 'setTitle', title: 'Inyectado' }]
  });
  assert.equal(foreignUpdate.code, 'SESSION_NOT_FOUND');
  assert.equal((await call('h5p:close-editor', win2, { sessionId: openedA.sessionId })).code, 'SESSION_NOT_FOUND');

  // Edición válida avanza la revisión y persiste en almacenamiento
  const updatedA = await call('h5p:update-editor', win1, {
    sessionId: openedA.sessionId,
    expectedRevision: 1,
    operations: [
      { type: 'setTitle', title: 'Borrador A revisado' },
      { type: 'markItemReviewed', itemId: openedA.activity.items[0].id, reviewed: true }
    ]
  });
  assert.equal(updatedA.status, 'ok');
  assert.equal(updatedA.activity.revision, 2);
  assert.equal(updatedA.activity.title, 'Borrador A revisado');
  assert.equal(updatedA.activity.items[0].reviewed, true);

  // Revisión vencida es rechazada sin mutar el estado
  const stale = await call('h5p:update-editor', win1, {
    sessionId: openedA.sessionId,
    expectedRevision: 1,
    operations: [{ type: 'setTitle', title: 'Obsoleto' }]
  });
  assert.equal(stale.code, 'REVISION_CONFLICT');
  assert.equal(stale.revision, 2);
  assert.equal(storage.getEditorialDraft(draftA.id).activity.title, 'Borrador A revisado');

  // Cerrar libera la sesión y permite abrir el borrador desde la segunda ventana
  assert.deepEqual(await call('h5p:close-editor', win1, { sessionId: openedA.sessionId }), { status: 'ok', closed: true });
  assert.equal(win1.listenerCount('destroyed'), 0);
  assert.equal(win1.listenerCount('did-start-navigation'), 0);

  const reopenedByWin2 = await call('h5p:open-editor', win2, { draftId: draftA.id });
  assert.equal(reopenedByWin2.status, 'ok');
  assert.equal(reopenedByWin2.activity.revision, 2);
  assert.equal(reopenedByWin2.activity.title, 'Borrador A revisado');

  assert.equal((await call('h5p:close-editor', win2, { sessionId: openedB.sessionId })).status, 'ok');
  assert.equal((await call('h5p:close-editor', win2, { sessionId: reopenedByWin2.sessionId })).status, 'ok');
  assert.equal(win2.listenerCount('destroyed'), 0);
});

test('rechaza IDs desconocidos, operaciones inválidas y propiedades adicionales', async t => {
  const { storage, call } = setup(t);
  const draft = storage.saveDraft({ courseId: 'unassigned', activityType: 'questionset', questionCount: 2 });
  storage.saveEditorialDraft(draft.id, makeQuestionSet());
  const win = createSender();

  // Propiedades adicionales o combinación inválida al abrir
  assert.equal((await call('h5p:open-editor', win, { draftId: draft.id, extra: true })).code, 'INVALID_ARGUMENT');
  assert.equal((await call('h5p:open-editor', win, { draftId: draft.id, projectId: draft.id })).code, 'INVALID_ARGUMENT');
  assert.equal((await call('h5p:open-editor', win, {})).code, 'INVALID_ARGUMENT');
  assert.equal((await call('h5p:open-editor', win, { draftId: 'inexistente' })).code, 'DRAFT_NOT_FOUND');

  const opened = await call('h5p:open-editor', win, { draftId: draft.id });
  assert.equal(opened.status, 'ok');
  const unknownUuid = '11111111-2222-4333-8444-555555555555';
  const item = opened.activity.items[0];

  // Propiedades adicionales, límites de texto y tipos inválidos en h5p:update-editor
  for (const badPayload of [
    { sessionId: opened.sessionId, expectedRevision: 1, operations: [], extra: 1 },
    { sessionId: opened.sessionId, expectedRevision: 1, operations: [] },
    { sessionId: opened.sessionId, expectedRevision: 0, operations: [{ type: 'setTitle', title: 'A' }] },
    { sessionId: opened.sessionId, expectedRevision: 1, operations: [{ type: 'setTitle', title: 'A', extra: true }] },
    { sessionId: opened.sessionId, expectedRevision: 1, operations: [{ type: 'setTitle', title: 'a'.repeat(181) }] },
    { sessionId: opened.sessionId, expectedRevision: 1, operations: [{ type: 'setTitle', title: 'salto\nlinea' }] },
    { sessionId: opened.sessionId, expectedRevision: 1, operations: [{ type: 'setOptionText', itemId: item.id, optionId: item.options[0].id, text: 'x'.repeat(1001) }] },
    { sessionId: opened.sessionId, expectedRevision: 1, operations: [{ type: 'setItemText', itemId: item.id, field: 'question', text: 'x'.repeat(2001) }] },
    { sessionId: opened.sessionId, expectedRevision: 1, operations: [{ type: 'setItemText', itemId: item.id, field: 'desconocido', text: 'hola' }] },
    { sessionId: opened.sessionId, expectedRevision: 1, operations: [{ type: 'moveItem', itemId: item.id, index: 20 }] },
    { sessionId: opened.sessionId, expectedRevision: 1, operations: [{ type: 'unknownOp' }] },
    { sessionId: opened.sessionId, expectedRevision: 1, operations: Array.from({ length: 65 }, () => ({ type: 'addItem' })) }
  ]) {
    assert.equal((await call('h5p:update-editor', win, badPayload)).code, 'INVALID_ARGUMENT');
  }

  // IDs con formato UUID pero inexistentes en la actividad
  const badItem = await call('h5p:update-editor', win, {
    sessionId: opened.sessionId,
    expectedRevision: 1,
    operations: [{ type: 'setItemText', itemId: unknownUuid, field: 'question', text: 'Otra' }]
  });
  assert.equal(badItem.code, 'ITEM_NOT_FOUND');

  const badOption = await call('h5p:update-editor', win, {
    sessionId: opened.sessionId,
    expectedRevision: 1,
    operations: [{ type: 'setOptionText', itemId: item.id, optionId: unknownUuid, text: 'Otra' }]
  });
  assert.equal(badOption.code, 'INVALID_OPERATION');

  assert.equal((await call('h5p:close-editor', win, { sessionId: opened.sessionId, extra: 1 })).code, 'INVALID_ARGUMENT');
  assert.equal((await call('h5p:close-editor', win, { sessionId: unknownUuid })).code, 'SESSION_NOT_FOUND');
});

test('navegación fuera del documento y cierre de ventana liberan la sesión; navegación in-place la conserva', async t => {
  const { storage, call } = setup(t);
  const draft = storage.saveDraft({ courseId: 'unassigned', activityType: 'questionset', questionCount: 2 });
  storage.saveEditorialDraft(draft.id, makeQuestionSet());

  const win1 = createSender();
  const win2 = createSender();
  const opened = await call('h5p:open-editor', win1, { draftId: draft.id });
  assert.equal(opened.status, 'ok');

  // Enlace de salto (#main-content): navegación in-place conserva la sesión y el bloqueo
  win1.emit('did-start-navigation', {}, 'file:///index.html#main-content', true, true);
  assert.equal((await call('h5p:open-editor', win2, { draftId: draft.id })).code, 'EDITOR_LOCKED');

  // Navegación principal fuera de la página libera sesión y bloqueo
  win1.emit('did-start-navigation', {}, 'about:blank', false, true);
  assert.equal((await call('h5p:update-editor', win1, {
    sessionId: opened.sessionId,
    expectedRevision: 1,
    operations: [{ type: 'setTitle', title: 'Tras navegar' }]
  })).code, 'SESSION_NOT_FOUND');

  const reopened = await call('h5p:open-editor', win2, { draftId: draft.id });
  assert.equal(reopened.status, 'ok');

  // Destruir la ventana también libera el bloqueo
  win2.destroy();
  const afterDestroy = await call('h5p:open-editor', createSender(), { draftId: draft.id });
  assert.equal(afterDestroy.status, 'ok');
});

test('abre borrador vacío antes de generar y abre proyectos exportados sin alterar la copia exportada', async t => {
  const { storage, call } = setup(t);
  const win = createSender();

  // Borrador sin contenido todavía: abre sesión y rechaza ediciones hasta generar
  const emptyDraft = storage.saveDraft({ courseId: 'unassigned', activityType: 'truefalse', questionCount: 1 });
  const emptySession = await call('h5p:open-editor', win, { draftId: emptyDraft.id });
  assert.equal(emptySession.status, 'ok');
  assert.equal(emptySession.hasContent, false);
  assert.equal(emptySession.activity, null);
  assert.equal((await call('h5p:update-editor', win, {
    sessionId: emptySession.sessionId,
    expectedRevision: 1,
    operations: [{ type: 'setTitle', title: 'Sin contenido' }]
  })).code, 'NO_EDITABLE_CONTENT');
  await call('h5p:close-editor', win, { sessionId: emptySession.sessionId });

  // Proyecto anterior sin editable devuelve NOT_EDITABLE
  const legacyProject = storage.saveProject({ title: 'Antiguo' });
  assert.equal((await call('h5p:open-editor', win, { projectId: legacyProject.id })).code, 'NOT_EDITABLE');

  // Proyecto nuevo con editable abre un borrador independiente
  const payload = makeQuestionSet('Exportado v1');
  const reviewed = { ...payload, activity: confirmActivityReview(payload.activity) };
  const project = storage.saveExportedProject({ title: 'Exportado v1', filePath: '/tmp/no-existe.h5p' }, reviewed);

  const projSession = await call('h5p:open-editor', win, { projectId: project.id });
  assert.equal(projSession.status, 'ok');
  assert.equal(projSession.projectId, project.id);
  assert.equal(projSession.activity.title, 'Exportado v1');

  const edited = await call('h5p:update-editor', win, {
    sessionId: projSession.sessionId,
    expectedRevision: projSession.activity.revision,
    operations: [{ type: 'setTitle', title: 'Copia editada' }]
  });
  assert.equal(edited.status, 'ok');
  assert.equal(edited.activity.reviewedRevision, null);
  assert.equal(storage.getProjectEditorial(project.id).activity.title, 'Exportado v1');
  assert.equal(storage.getEditorialDraft(projSession.draftId).activity.title, 'Copia editada');
});
