'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AcademicStorage } = require('../storage');
const { createEditableActivity } = require('../editor/editableActivity');
const { applyActivityEdits, getActivityIssues, confirmActivityReview } = require('../editor/activityEdits');

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

test('la exportación, Guardar como, el traslado y la papelera conservan copias independientes', t => {
  const { storage, editorial, index, files } = setup(t);
  const course = storage.saveCourse({ name: 'Física' });
  const legacy = storage.saveProject({ title: 'Proyecto anterior' });
  assert.equal(legacy.hasEditable, false);
  assert.equal(storage.openProjectDraft(legacy.id), null);

  const original = body();
  const firstPath = path.join(editorial, 'sin-archivo.h5p');
  assert.throws(() => storage.saveExportedProject({ title: 'Revisión', filePath: firstPath }, original), {
    code: 'EDITORIAL_NOT_REVIEWED'
  });
  const reviewed = { ...original, activity: confirmActivityReview(original.activity) };
  const first = storage.saveExportedProject({ title: 'Revisión', filePath: firstPath }, reviewed);
  assert.equal(first.hasEditable, true);
  assert.equal(first.editorialRef, undefined);
  assert.equal(storage.getProjects().find(project => project.id === first.id).fileExists, false);
  const reopened = storage.openProjectDraft(first.id);
  const edited = confirmActivityReview(editTitle(reopened.activity, 'Otra revisión'));
  storage.saveEditorialDraft(reopened.draft.id, { ...reviewed, activity: edited });
  assert.deepEqual(storage.openProjectDraft(first.id).activity, edited);
  assert.deepEqual(storage.getProjectEditorial(first.id).activity, reviewed.activity);

  const second = storage.saveExportedProject({ title: 'Guardar como', filePath: path.join(editorial, 'otro.h5p') },
    { ...reviewed, activity: edited });
  assert.notEqual(second.id, first.id);
  assert.equal(storage.getProjectEditorial(first.id).activity.title, source.title);
  assert.equal(storage.getProjectEditorial(second.id).activity.title, edited.title);
  const updated = storage.saveExportedProject({ title: 'Sobrescribir', filePath: firstPath }, { ...reviewed, activity: edited });
  assert.equal(updated.id, first.id);
  assert.deepEqual(storage.getProjectEditorial(first.id).activity, edited);

  const work = storage.openProjectDraft(first.id);
  assert.equal(storage.assignProject(first.id, course.id).hasEditable, true);
  assert.equal(storage.getDrafts().find(draft => draft.id === work.draft.id).courseId, course.id);
  assert.equal(storage.deleteProject(first.id), true);
  const [trashed] = storage.getTrash();
  assert.equal(trashed.record.hasEditable, true);
  assert.equal(trashed.record.editorialRef, undefined);
  assert.equal(storage.getProjectEditorial(first.id), null);
  assert.equal(storage.restoreTrashItem(trashed.id), true);
  assert.equal(storage.openProjectDraft(first.id).draft.id, work.draft.id);

  const refFile = index().projects.find(project => project.id === first.id).editorialRef + '.json';
  storage.deleteProject(first.id);
  assert.equal(storage.permanentlyDeleteTrashItem(storage.getTrash()[0].id), true);
  assert.equal(files().includes(refFile), false);
  assert.deepEqual(storage.getEditorialDraft(reopened.draft.id).activity, edited);
  assert.deepEqual(storage.getProjectEditorial(second.id).activity, edited);
});

test('las copias v1 y el respaldo previo excluyen datos privados e impiden recuperar por IDs importados', t => {
  const { storage, storePath, index, files } = setup(t);
  const draft = storage.saveDraft({ courseId: 'unassigned', prompt: 'PROMPT_PRIVADO' });
  const original = body();
  storage.saveEditorialDraft(draft.id, original);
  const reviewed = { ...original, activity: confirmActivityReview(original.activity) };
  const first = storage.saveExportedProject({ title: 'Activo', promptSummary: 'RESUMEN_PRIVADO' }, reviewed);
  const second = storage.saveExportedProject({ title: 'En papelera' }, reviewed);
  storage.deleteProject(second.id);
  const raw = index();
  const backup = storage.createBackupPayload();
  assert.equal(backup.version, 1);
  const privateData = /editorialRef|editorProjectRef|CONTENIDO_EDITORIAL|INSTRUCCIONES_PRIVADAS|PROMPT_PRIVADO|RESUMEN_PRIVADO/;
  assert.doesNotMatch(JSON.stringify(backup), privateData);

  storage.restoreBackupPayload(backup, 'merge');
  assert.equal(storage.getProjectEditorial(first.id).activity.reviewedRevision, reviewed.activity.revision);
  backup.data.projects[0].editorialRef = raw.projects[0].editorialRef;
  backup.data.drafts[0].editorialRef = raw.drafts[0].editorialRef;
  backup.data.trash[0].record.editorialRef = raw.trash[0].record.editorialRef;
  storage.restoreBackupPayload(backup, 'replace');
  const backups = path.join(path.dirname(storePath), 'backups');
  const [snapshot] = fs.readdirSync(backups);
  assert.doesNotMatch(fs.readFileSync(path.join(backups, snapshot), 'utf8'), privateData);
  assert.equal(storage.getProjectEditorial(first.id), null);
  assert.equal(storage.getEditorialDraft(draft.id), null);
  assert.equal(storage.restoreTrashItem(storage.getTrash()[0].id), true);
  assert.equal(storage.openProjectDraft(second.id), null);
  assert.equal(files().length, 3);
});
