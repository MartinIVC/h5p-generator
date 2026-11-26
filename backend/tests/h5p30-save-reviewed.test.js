'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');

const { AcademicStorage } = require('../storage');
const { createH5PEditor } = require('../../frontend/ipc/h5pEditor');
const { createH5PGeneration } = require('../../frontend/ipc/h5pGeneration');

const DOC_ID = '01234567-89ab-4cde-8fab-0123456789ab';

function createSender() {
  return Object.assign(new EventEmitter(), { isDestroyed: () => false });
}

function setup(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p30-save-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storePath = path.join(dir, 'academic_store.json');
  const storage = new AcademicStorage(storePath);
  storage.getApiKey = () => 'clave-sintetica';
  const editor = createH5PEditor({ storage });
  const owner = createSender();
  const doc = { name: 'guia.pdf', text: 'Material docente para prueba de guardado revisado.' };

  const generation = createH5PGeneration({
    inspection: { getDocument: (s, id) => (s === owner && id === DOC_ID ? doc : undefined) },
    storage,
    dialog: opts.dialog || { showSaveDialog: async () => ({ canceled: false, filePath: path.join(dir, 'actividad.h5p') }) },
    BrowserWindow: { fromWebContents: () => ({}) },
    app: { getPath: () => dir },
    fileSystem: opts.fileSystem || fsp,
    generate: async () => [{
      afirmacion: 'El cifrado garantiza disponibilidad.',
      esVerdadera: false,
      retroalimentacionCorrecta: 'Correcto, protege la confidencialidad.',
      retroalimentacionIncorrecta: 'Incorrecto, la disponibilidad depende de redundancia y continuidad.'
    }],
    editor
  });

  async function generateAndPrepare(title = 'Afirmación de seguridad') {
    const course = storage.getAllCourses()[0] || storage.saveCourse({ name: 'Seguridad' });
    const draft = storage.saveDraft({ courseId: course.id, courseName: course.name, activityType: 'truefalse', questionCount: 1 });
    const opened = await editor.openEditor({ draftId: draft.id }, { sender: owner });
    const gen = await generation.generateH5P({
      documentIds: [DOC_ID],
      activityType: 'truefalse',
      questionCount: 1,
      instructions: 'Enfoque práctico',
      title,
      sessionId: opened.sessionId
    }, { sender: owner });
    assert.equal(gen.status, 'ok');
    const prep = await generation.prepareReviewed({
      sessionId: opened.sessionId,
      expectedRevision: gen.activity.revision
    }, { sender: owner });
    assert.equal(prep.status, 'ok');
    return { course, draft, opened, gen, prep };
  }

  return { dir, storePath, storage, editor, owner, generation, generateAndPrepare };
}

test('diálogo cancelado no escribe archivo, no registra proyecto y conserva el borrador y la sesión', async t => {
  let canceled = true;
  let destination;
  const { dir, storage, editor, owner, generation, generateAndPrepare } = setup(t, {
    dialog: {
      showSaveDialog: async () => canceled ? { canceled: true } : { canceled: false, filePath: destination }
    }
  });
  destination = path.join(dir, 'exportada.h5p');
  const { course, draft, opened, prep } = await generateAndPrepare('Prueba cancelación');

  const cancelled = await generation.saveH5PFile({
    packageId: prep.packageId,
    suggestedName: 'exportada',
    courseId: course.id
  }, { sender: owner });
  assert.deepEqual(cancelled, { status: 'cancelled' });
  assert.equal(fs.existsSync(destination), false);
  assert.equal(storage.getProjects().length, 0);
  assert.equal(storage.getDrafts().some(d => d.id === draft.id), true);
  assert.ok(editor.getSession(owner, opened.sessionId));

  // Reintentar tras cancelar guarda el archivo, registra el editable exacto y retira el borrador
  canceled = false;
  const saved = await generation.saveH5PFile({
    packageId: prep.packageId,
    suggestedName: 'exportada',
    courseId: course.id
  }, { sender: owner });
  assert.equal(saved.status, 'ok');
  assert.equal(saved.fileSaved, true);
  assert.equal(saved.projectSaved, true);
  assert.equal(saved.draftRemoved, true);
  assert.ok(saved.projectId);
  assert.equal(fs.existsSync(destination), true);
  assert.equal(storage.getDrafts().some(d => d.id === draft.id), false);
  assert.equal(editor.getSession(owner, opened.sessionId), null);

  // El proyecto conserva la copia editorial y puede reabrirse aunque se elimine el .h5p
  fs.unlinkSync(destination);
  const projectList = storage.getProjects(course.id);
  assert.equal(projectList.length, 1);
  assert.equal(projectList[0].hasEditable, true);
  assert.equal(projectList[0].fileExists, false);
  assert.deepEqual(projectList[0].sourceFiles, [{ name: 'guia.pdf' }]);

  const reopened = await editor.openEditor({ projectId: saved.projectId }, { sender: owner });
  assert.equal(reopened.status, 'ok');
  assert.equal(reopened.activity.title, 'Prueba cancelación');
  assert.equal(reopened.activity.items[0].isTrue, false);
});

test('destino existente se sobrescribe atómicamente y actualiza el registro sin duplicarlo', async t => {
  let destination;
  const { dir, storage, editor, owner, generation, generateAndPrepare } = setup(t, {
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: destination }) }
  });
  destination = path.join(dir, 'existente.h5p');
  fs.writeFileSync(destination, 'contenido previo');

  const first = await generateAndPrepare('Versión 1');
  const saved1 = await generation.saveH5PFile({
    packageId: first.prep.packageId,
    suggestedName: 'existente',
    courseId: first.course.id
  }, { sender: owner });
  assert.equal(saved1.status, 'ok');
  assert.equal(saved1.projectSaved, true);
  assert.equal(storage.getProjects().length, 1);

  const zip1 = await JSZip.loadAsync(fs.readFileSync(destination));
  assert.equal(JSON.parse(await zip1.file('h5p.json').async('string')).title, 'Versión 1');

  // Reabrir proyecto, editar título, re-preparar y sobrescribir el mismo archivo destino
  const reopened = await editor.openEditor({ projectId: saved1.projectId }, { sender: owner });
  const edited = await editor.updateEditor({
    sessionId: reopened.sessionId,
    expectedRevision: reopened.activity.revision,
    operations: [{ type: 'setTitle', title: 'Versión 2 sobrescrita' }]
  }, { sender: owner });
  const prep2 = await generation.prepareReviewed({
    sessionId: reopened.sessionId,
    expectedRevision: edited.activity.revision
  }, { sender: owner });
  const saved2 = await generation.saveH5PFile({
    packageId: prep2.packageId,
    suggestedName: 'existente',
    courseId: first.course.id
  }, { sender: owner });
  assert.equal(saved2.status, 'ok');
  assert.equal(saved2.projectId, saved1.projectId);
  assert.equal(storage.getProjects().length, 1);
  assert.equal(storage.getProjectEditorial(saved2.projectId).activity.title, 'Versión 2 sobrescrita');
  const zip2 = await JSZip.loadAsync(fs.readFileSync(destination));
  assert.equal(JSON.parse(await zip2.file('h5p.json').async('string')).title, 'Versión 2 sobrescrita');
});

test('revisión obsoleta antes del diálogo, durante el diálogo y antes del renombrado aborta sin corromper destino', async t => {
  let destination;
  let duringDialogHook = null;
  let beforeRenameHook = null;

  const hookedFs = {
    mkdir: (...args) => fsp.mkdir(...args),
    writeFile: async (...args) => {
      const res = await fsp.writeFile(...args);
      if (beforeRenameHook) {
        const fn = beforeRenameHook;
        beforeRenameHook = null;
        await fn();
      }
      return res;
    },
    rename: (...args) => fsp.rename(...args),
    rm: (...args) => fsp.rm(...args)
  };

  const { dir, storage, editor, owner, generation, generateAndPrepare } = setup(t, {
    fileSystem: hookedFs,
    dialog: {
      showSaveDialog: async () => {
        if (duringDialogHook) {
          const fn = duringDialogHook;
          duringDialogHook = null;
          await fn();
        }
        return { canceled: false, filePath: destination };
      }
    }
  });
  destination = path.join(dir, 'intacto.h5p');
  fs.writeFileSync(destination, 'bytes-originales');

  // 1) Obsoleta durante el diálogo
  const run1 = await generateAndPrepare('Antes del diálogo');
  duringDialogHook = async () => {
    await editor.updateEditor({
      sessionId: run1.opened.sessionId,
      expectedRevision: run1.prep.revision,
      operations: [{ type: 'setTitle', title: 'Editado mientras diálogo abierto' }]
    }, { sender: owner });
  };
  const resDuringDialog = await generation.saveH5PFile({
    packageId: run1.prep.packageId,
    suggestedName: 'intacto',
    courseId: run1.course.id
  }, { sender: owner });
  assert.equal(resDuringDialog.code, 'REVISION_CONFLICT');
  assert.equal(fs.readFileSync(destination, 'utf8'), 'bytes-originales');
  assert.equal(storage.getProjects().length, 0);

  // 2) Obsoleta justo antes del renombrado atómico
  const prepBeforeRename = await generation.prepareReviewed({
    sessionId: run1.opened.sessionId,
    expectedRevision: 2
  }, { sender: owner });
  assert.equal(prepBeforeRename.status, 'ok');
  beforeRenameHook = async () => {
    await editor.updateEditor({
      sessionId: run1.opened.sessionId,
      expectedRevision: prepBeforeRename.revision,
      operations: [{ type: 'setTitle', title: 'Editado antes de rename' }]
    }, { sender: owner });
  };
  const resBeforeRename = await generation.saveH5PFile({
    packageId: prepBeforeRename.packageId,
    suggestedName: 'intacto',
    courseId: run1.course.id
  }, { sender: owner });
  assert.equal(resBeforeRename.code, 'REVISION_CONFLICT');
  assert.equal(fs.readFileSync(destination, 'utf8'), 'bytes-originales');
  assert.equal(fs.readdirSync(dir).some(name => name.startsWith('.h5p-work-')), false);
  assert.equal(storage.getProjects().length, 0);
  assert.equal(storage.getDrafts().some(d => d.id === run1.draft.id), true);
});

test('fallo de registro después de escribir conserva el archivo, mantiene el borrador recuperable y distingue ambos hechos', async t => {
  let destination;
  const { dir, storePath, storage, editor, owner, generation, generateAndPrepare } = setup(t, {
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: destination }) }
  });
  destination = path.join(dir, 'guardado-sin-registro.h5p');
  const { course, draft, opened, prep } = await generateAndPrepare('Evaluación con fallo de registro');

  storage.saveExportedProject = () => { throw new Error('fallo de disco en academic_store'); };

  const saved = await generation.saveH5PFile({
    packageId: prep.packageId,
    suggestedName: 'guardado-sin-registro',
    courseId: course.id
  }, { sender: owner });

  assert.equal(saved.status, 'ok');
  assert.equal(saved.fileName, 'guardado-sin-registro.h5p');
  assert.equal(saved.fileSaved, true);
  assert.equal(saved.projectSaved, false);
  assert.equal(saved.projectId, null);
  assert.equal(saved.draftRemoved, false);
  assert.equal(saved.draftId, draft.id);

  // El archivo .h5p existe y es válido
  assert.equal(fs.existsSync(destination), true);
  const zip = await JSZip.loadAsync(fs.readFileSync(destination));
  assert.equal(JSON.parse(await zip.file('h5p.json').async('string')).title, 'Evaluación con fallo de registro');

  // El borrador NO fue eliminado y se puede recuperar tras cerrar/reabrir almacenamiento
  assert.ok(editor.getSession(owner, opened.sessionId));
  const reopenedStorage = new AcademicStorage(storePath);
  assert.equal(reopenedStorage.getDrafts().some(d => d.id === draft.id), true);
  const recovered = reopenedStorage.getEditorialDraft(draft.id);
  assert.equal(recovered.activity.title, 'Evaluación con fallo de registro');
  assert.equal(recovered.activity.reviewedRevision, recovered.activity.revision);
});
