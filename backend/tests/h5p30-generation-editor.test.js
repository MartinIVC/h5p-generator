'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AcademicStorage } = require('../storage');
const { createH5PEditor } = require('../../frontend/ipc/h5pEditor');
const { createH5PGeneration } = require('../../frontend/ipc/h5pGeneration');

const DOC_ID = '01234567-89ab-4cde-8fab-0123456789ab';

function createSender() {
  return Object.assign(new EventEmitter(), { isDestroyed: () => false });
}

function syntheticItems(type, count) {
  switch (type) {
    case 'questionset':
    case 'multichoice':
      return Array.from({ length: count }, (_, i) => ({
        pregunta: `Pregunta ${i + 1}`,
        opciones: ['Opción correcta', 'Distractor 1', 'Distractor 2', 'Distractor 3'],
        respuestaCorrecta: 'Opción correcta',
        retroalimentacion: `Explicación ${i + 1}.`
      }));
    case 'truefalse':
      return [{
        afirmacion: 'La tierra es plana.',
        esVerdadera: false,
        retroalimentacionCorrecta: 'Exacto, es falsa.',
        retroalimentacionIncorrecta: 'Revisa los fundamentos.'
      }];
    case 'singlechoiceset':
      return Array.from({ length: count }, (_, i) => ({
        pregunta: `Pregunta rápida ${i + 1}`,
        opciones: ['Correcta', 'Error 1', 'Error 2', 'Error 3'],
        respuestaCorrecta: 'Correcta'
      }));
    case 'blanks':
      return Array.from({ length: count }, (_, i) => ({
        textoAntes: `Enunciado ${i + 1} sobre`,
        respuesta: 'seguridad',
        textoDespues: 'en sistemas.',
        pista: 'Concepto base'
      }));
    case 'dragtext':
      return Array.from({ length: count }, (_, i) => ({
        textoAntes: `El término ${i + 1} es`,
        palabra: 'integridad',
        textoDespues: 'del dato.',
        pista: 'Exactitud'
      }));
    case 'summary':
      return Array.from({ length: count }, (_, i) => ({
        afirmacionCorrecta: `Idea clave ${i + 1}`,
        distractores: [`Distractor A ${i + 1}`, `Distractor B ${i + 1}`],
        pista: ''
      }));
    case 'sortparagraphs':
      return Array.from({ length: count }, (_, i) => ({ parrafo: `Paso ${i + 1} del proceso.` }));
    case 'crossword':
      return [
        { pista: 'Pista 1', palabra: 'DATOS' },
        { pista: 'Pista 2', palabra: 'REDES' }
      ].slice(0, count);
    case 'findthewords':
      return [
        { palabra: 'datos' },
        { palabra: 'redes' },
        { palabra: 'clave' }
      ].slice(0, count);
    case 'accordion':
      return Array.from({ length: count }, (_, i) => ({
        titulo: `Tema ${i + 1}`,
        explicacion: `Explicación del tema ${i + 1}.`
      }));
    case 'flashcards':
      return Array.from({ length: count }, (_, i) => ({
        pregunta: `¿Concepto ${i + 1}?`,
        respuesta: `Respuesta ${i + 1}`,
        pista: `Pista ${i + 1}`
      }));
    default:
      throw new Error(`Unexpected type: ${type}`);
  }
}

function setup(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p30-gen-editor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storePath = path.join(dir, 'academic_store.json');
  const storage = new AcademicStorage(storePath);
  storage.getApiKey = () => 'clave-sintetica';
  const editor = createH5PEditor({ storage });
  const owner = createSender();
  const doc = { name: 'apunte.txt', text: 'Contenido privado para generar actividades.' };
  let workerCalls = 0;
  const FakeWorker = class extends EventEmitter {
    constructor(file, data) {
      super();
      workerCalls++;
      if (opts.forbidWorker) throw new Error('Worker should not be called');
      const { Worker } = require('node:worker_threads');
      const real = new Worker(file, data);
      real.on('message', msg => this.emit('message', msg));
      real.on('error', err => this.emit('error', err));
      real.on('exit', code => this.emit('exit', code));
      this._real = real;
    }
    terminate() {
      return this._real ? this._real.terminate() : Promise.resolve();
    }
  };
  const generation = createH5PGeneration({
    inspection: { getDocument: (s, id) => (s === owner && id === DOC_ID ? doc : undefined) },
    storage,
    dialog: {},
    BrowserWindow: { fromWebContents: () => ({}) },
    app: { getPath: () => dir },
    generate: opts.generate || (async (_src, _key, _ins, count, { activityType }) => syntheticItems(activityType, count)),
    WorkerClass: FakeWorker,
    editor
  });
  return { dir, storePath, storage, editor, owner, generation, getWorkerCalls: () => workerCalls };
}

test('los tres formatos MVP con sesión editorial persisten borrador restaurable con cero llamadas al worker', async t => {
  const { storePath, storage, editor, owner, generation, getWorkerCalls } = setup(t, { forbidWorker: true });

  for (const [activityType, questionCount, title] of [
    ['questionset', 2, 'Cuestionario U1'],
    ['multichoice', 1, 'Reactivo U1'],
    ['truefalse', 1, 'Afirmación U1']
  ]) {
    const draft = storage.saveDraft({ courseId: 'unassigned', activityType, questionCount });
    const opened = await editor.openEditor({ draftId: draft.id }, { sender: owner });
    assert.equal(opened.status, 'ok');

    const generated = await generation.generateH5P({
      documentIds: [DOC_ID],
      activityType,
      questionCount,
      instructions: 'Enfoque conceptual',
      title,
      sessionId: opened.sessionId
    }, { sender: owner });

    assert.equal(generated.status, 'ok');
    assert.equal(generated.kind, 'editable');
    assert.equal(generated.sessionId, opened.sessionId);
    assert.equal(generated.draftId, draft.id);
    assert.equal(generated.activity.activityType, activityType);
    assert.equal(generated.activity.title, title);
    assert.equal(generated.activity.items.length, questionCount);
    assert.deepEqual(generated.issues, []);
    assert.equal(getWorkerCalls(), 0);

    // Restaurable desde disco tras cerrar sesión y reabrir almacenamiento
    await editor.closeEditor({ sessionId: opened.sessionId }, { sender: owner });
    const reopenedStorage = new AcademicStorage(storePath);
    const persisted = reopenedStorage.getEditorialDraft(draft.id);
    assert.deepEqual(persisted.activity, generated.activity);
    assert.equal(persisted.source.instructions, 'Enfoque conceptual');
  }
});

test('cancelar o fallar una regeneración conserva el borrador editorial previo', async t => {
  let mode = 'initial';
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });

  const { storage, editor, owner, generation, getWorkerCalls } = setup(t, {
    forbidWorker: true,
    generate: (_src, _key, _ins, count, options) => {
      if (mode === 'network-error') return Promise.reject(new Error('NETWORK_ERROR'));
      if (mode === 'slow') {
        return new Promise((_resolve, reject) => {
          started();
          options.signal.addEventListener('abort', () => reject(new Error('GENERATION_CANCELLED')), { once: true });
        });
      }
      return Promise.resolve(syntheticItems(options.activityType, count));
    }
  });

  const draft = storage.saveDraft({ courseId: 'unassigned', activityType: 'questionset', questionCount: 2 });
  const opened = await editor.openEditor({ draftId: draft.id }, { sender: owner });
  const first = await generation.generateH5P({
    documentIds: [DOC_ID],
    activityType: 'questionset',
    questionCount: 2,
    instructions: 'Primera versión',
    title: 'Original',
    sessionId: opened.sessionId
  }, { sender: owner });
  assert.equal(first.status, 'ok');

  // Editamos el título antes de intentar regenerar
  const edited = await editor.updateEditor({
    sessionId: opened.sessionId,
    expectedRevision: first.activity.revision,
    operations: [{ type: 'setTitle', title: 'Editado por docente' }]
  }, { sender: owner });
  assert.equal(edited.status, 'ok');

  // Fallo de red al regenerar conserva el borrador previo
  mode = 'network-error';
  const failed = await generation.generateH5P({
    documentIds: [DOC_ID],
    activityType: 'questionset',
    questionCount: 2,
    instructions: 'Intento fallido',
    title: 'Nuevo título',
    sessionId: opened.sessionId
  }, { sender: owner });
  assert.equal(failed.code, 'NETWORK_ERROR');
  assert.equal(storage.getEditorialDraft(draft.id).activity.title, 'Editado por docente');

  // Cancelación al regenerar conserva el borrador previo y permite seguir editando
  mode = 'slow';
  const pending = generation.generateH5P({
    documentIds: [DOC_ID],
    activityType: 'questionset',
    questionCount: 2,
    instructions: 'Intento cancelado',
    title: 'Cancelado',
    sessionId: opened.sessionId
  }, { sender: owner });
  await startedPromise;
  assert.deepEqual(await generation.cancelGeneration({}, { sender: owner }), { status: 'ok', cancelled: true });
  assert.equal((await pending).code, 'GENERATION_CANCELLED');
  assert.equal(storage.getEditorialDraft(draft.id).activity.title, 'Editado por docente');
  assert.equal(getWorkerCalls(), 0);

  // La sesión sigue operativa con su revisión previa
  const stillWorks = await editor.updateEditor({
    sessionId: opened.sessionId,
    expectedRevision: edited.activity.revision,
    operations: [{ type: 'setTitle', title: 'Conservado tras cancelar' }]
  }, { sender: owner });
  assert.equal(stillWorks.status, 'ok');
  assert.equal(stillWorks.activity.title, 'Conservado tras cancelar');
});

test('los nueve formatos restantes continúan devolviendo kind package y rechazan sessionId', async t => {
  const { storage, editor, owner, generation } = setup(t);
  const draft = storage.saveDraft({ courseId: 'unassigned', activityType: 'questionset', questionCount: 2 });
  const opened = await editor.openEditor({ draftId: draft.id }, { sender: owner });

  // Un formato no-MVP no acepta sessionId
  const rejected = await generation.generateH5P({
    documentIds: [DOC_ID],
    activityType: 'flashcards',
    questionCount: 2,
    instructions: '',
    sessionId: opened.sessionId
  }, { sender: owner });
  assert.equal(rejected.code, 'UNSUPPORTED_TYPE');

  // Los nueve formatos no-MVP siguen devolviendo kind: 'package'
  const nineFormats = [
    ['singlechoiceset', 2],
    ['blanks', 2],
    ['dragtext', 2],
    ['summary', 2],
    ['sortparagraphs', 3],
    ['crossword', 2],
    ['findthewords', 3],
    ['accordion', 2],
    ['flashcards', 2]
  ];
  for (const [activityType, questionCount] of nineFormats) {
    const res = await generation.generateH5P({
      documentIds: [DOC_ID],
      activityType,
      questionCount,
      instructions: ''
    }, { sender: owner });
    assert.equal(res.status, 'ok', activityType);
    assert.equal(res.kind, 'package', activityType);
    assert.ok(res.packageId, activityType);
    assert.equal(res.questionCount, questionCount, activityType);
  }
});
