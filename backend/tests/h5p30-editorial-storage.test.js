'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AcademicStorage } = require('../storage');
const { createEditableActivity } = require('../editor/editableActivity');
const { applyActivityEdits, getActivityIssues } = require('../editor/activityEdits');

const source = {
  activityType: 'truefalse',
  questionCount: 1,
  title: 'Título de origen',
  instructions: 'INSTRUCCIONES_PRIVADAS'
};

function body() {
  const activity = createEditableActivity({
    activityType: source.activityType,
    title: source.title,
    items: [{
      afirmacion: 'CONTENIDO_EDITORIAL',
      esVerdadera: false,
      retroalimentacionCorrecta: 'Comentario del acierto.',
      retroalimentacionIncorrecta: 'Comentario del error.'
    }]
  });
  return { activity, source };
}

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p30-editorial-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storePath = path.join(directory, 'academic_store.json');
  const editorial = path.join(directory, 'editorial');
  return {
    storePath, editorial,
    storage: new AcademicStorage(storePath),
    index: () => JSON.parse(fs.readFileSync(storePath, 'utf8')),
    files: () => fs.readdirSync(editorial).sort()
  };
}

function editTitle(activity, title) {
  return applyActivityEdits(activity, [{ type: 'setTitle', title }]);
}

test('recupera borradores completos e incompletos y conserva el editable al actualizar la configuración', t => {
  const { storage, storePath, editorial, index, files } = setup(t);
  const valid = storage.saveDraft({ courseId: 'unassigned' });
  const incomplete = storage.saveDraft({ courseId: 'unassigned' });
  const first = body();
  const second = body();
  const itemId = second.activity.items[0].id;
  second.activity = applyActivityEdits(second.activity, [
    { type: 'setTrueFalseAnswer', itemId, value: null },
    { type: 'markItemReviewed', itemId, reviewed: true }
  ]);
  storage.saveEditorialDraft(valid.id, first);
  storage.saveEditorialDraft(incomplete.id, second);

  const originalRef = index().drafts.find(record => record.id === valid.id).editorialRef;
  const saved = storage.saveDraft({
    id: valid.id, courseId: 'unassigned', prompt: 'Nueva configuración', activityType: 'questionset',
    questionCount: 8, editorialRef: 'referencia inyectada'
  });
  assert.equal(saved.hasEditable, true);
  assert.equal(saved.editorialRef, undefined);
  assert.equal(index().drafts.find(record => record.id === valid.id).editorialRef, originalRef);
  assert.equal(files().length, 2);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(editorial).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(editorial, originalRef + '.json')).mode & 0o777, 0o600);
  }

  const reopened = new AcademicStorage(storePath);
  assert.deepEqual(reopened.getEditorialDraft(valid.id).activity, first.activity);
  assert.deepEqual(reopened.getEditorialDraft(valid.id).source, source);
  assert.deepEqual(reopened.getEditorialDraft(incomplete.id).activity, second.activity);
  assert.deepEqual(getActivityIssues(reopened.getEditorialDraft(incomplete.id).activity), [
    { itemId, field: 'isTrue', code: 'REQUIRED' }
  ]);
  assert.equal(reopened.getDrafts().every(record => record.hasEditable && !Object.hasOwn(record, 'editorialRef')), true);
});

test('un fallo al escribir el editable o publicar su referencia conserva el último guardado', t => {
  const { storage, storePath, editorial, index, files } = setup(t);
  const draft = storage.saveDraft({ courseId: 'unassigned' });
  const other = storage.saveDraft({ courseId: 'unassigned' });
  const original = body();
  storage.saveEditorialDraft(draft.id, original);
  const next = { ...original, activity: editTitle(original.activity, 'Cambio pendiente') };
  const initialIndex = index();
  const initialFiles = files();
  const renameSync = fs.renameSync;
  let failureDirectory = editorial;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (path.dirname(to) === failureDirectory) throw new Error('fallo simulado');
    return renameSync(from, to);
  });

  assert.throws(() => storage.saveEditorialDraft(draft.id, next), { code: 'EDITORIAL_WRITE_FAILED' });
  assert.deepEqual(index(), initialIndex);
  assert.deepEqual(files(), initialFiles);
  failureDirectory = path.dirname(storePath);
  assert.throws(() => storage.saveEditorialDraft(draft.id, next), /fallo simulado/);
  assert.deepEqual(index(), initialIndex);
  assert.deepEqual(files(), initialFiles);
  assert.deepEqual(storage.getEditorialDraft(draft.id).activity, original.activity);
  assert.equal(storage.getEditorialDraft(other.id), null);
});

test('un editable corrupto, demasiado grande, futuro o vinculado a otro borrador queda aislado', t => {
  const { storage, editorial, index, storePath } = setup(t);
  const affected = storage.saveDraft({ courseId: 'unassigned' });
  const other = storage.saveDraft({ courseId: 'unassigned' });
  storage.saveEditorialDraft(affected.id, body());
  storage.saveEditorialDraft(other.id, body());
  const data = index();
  const originalMeta = data.drafts.find(record => record.id === affected.id);
  const originalFile = path.join(editorial, originalMeta.editorialRef + '.json');
  const original = JSON.parse(fs.readFileSync(originalFile, 'utf8'));
  for (const [payload, code] of [
    ['{incompleto', 'EDITORIAL_UNREADABLE'],
    [JSON.stringify({ ...original, schemaVersion: 2 }), 'EDITORIAL_VERSION_UNSUPPORTED'],
    [JSON.stringify({ ...original, activity: { ...original.activity, schemaVersion: 2 } }), 'EDITORIAL_VERSION_UNSUPPORTED'],
    ['x'.repeat(1024 * 1024 + 1), 'EDITORIAL_TOO_LARGE']
  ]) {
    fs.writeFileSync(originalFile, payload);
    assert.throws(() => storage.getEditorialDraft(affected.id), { code });
    assert.equal(fs.readFileSync(originalFile, 'utf8'), payload);
    assert.ok(storage.getEditorialDraft(other.id));
  }
  originalMeta.editorialRef = data.drafts.find(record => record.id === other.id).editorialRef;
  fs.writeFileSync(storePath, JSON.stringify(data));
  assert.throws(() => storage.getEditorialDraft(affected.id), { code: 'EDITORIAL_UNREADABLE' });
});
