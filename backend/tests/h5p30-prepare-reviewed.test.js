'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const JSZip = require('jszip');

const { AcademicStorage } = require('../storage');
const { createH5PEditor } = require('../../frontend/ipc/h5pEditor');
const { createH5PGeneration } = require('../../frontend/ipc/h5pGeneration');

const DOC_ID = '01234567-89ab-4cde-8fab-0123456789ab';

function createSender() {
  return Object.assign(new EventEmitter(), { isDestroyed: () => false });
}

function setup(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p30-prepare-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = new AcademicStorage(path.join(dir, 'academic_store.json'));
  storage.getApiKey = () => 'clave-sintetica';
  const editor = createH5PEditor({ storage });
  const owner = createSender();
  const doc = { name: 'apunte.txt', text: 'Material docente para prueba de preparación.' };
  const capturedWorkerData = [];
  let generateCalls = 0;

  const WrappedWorker = opts.WorkerClass || class extends EventEmitter {
    constructor(file, options) {
      super();
      capturedWorkerData.push(structuredClone(options.workerData));
      const real = new Worker(file, options);
      real.on('message', msg => this.emit('message', msg));
      real.on('error', err => this.emit('error', err));
      real.on('exit', code => this.emit('exit', code));
      this._real = real;
    }
    terminate() {
      return this._real.terminate();
    }
  };

  const destination = path.join(dir, 'revisado.h5p');
  const generation = createH5PGeneration({
    inspection: { getDocument: (s, id) => (s === owner && id === DOC_ID ? doc : undefined) },
    storage,
    dialog: opts.dialog || { showSaveDialog: async () => ({ canceled: false, filePath: destination }) },
    BrowserWindow: { fromWebContents: () => ({}) },
    app: { getPath: () => dir },
    generate: async (_src, _key, _ins, count, { activityType }) => {
      generateCalls++;
      if (activityType === 'truefalse') {
        return [{
          afirmacion: 'Afirmación original',
          esVerdadera: true,
          retroalimentacionCorrecta: 'Bien original',
          retroalimentacionIncorrecta: 'Mal original'
        }];
      }
      return Array.from({ length: count }, (_, i) => ({
        pregunta: `Pregunta ${i + 1}`,
        opciones: ['Correcta', 'Distractor B', 'Distractor C', 'Distractor D'],
        respuestaCorrecta: 'Correcta',
        retroalimentacion: `Feedback original ${i + 1}`
      }));
    },
    WorkerClass: WrappedWorker,
    editor
  });

  return { dir, destination, storage, editor, owner, generation, capturedWorkerData, getGenerateCalls: () => generateCalls };
}

test('prepareReviewed proyecta solo el contenido aprobado, preserva ediciones de correcta/feedback/orden e invalida ante cambios', async t => {
  const { destination, storage, editor, owner, generation, capturedWorkerData } = setup(t);
  const draft = storage.saveDraft({ courseId: 'unassigned', activityType: 'questionset', questionCount: 2 });
  const opened = await editor.openEditor({ draftId: draft.id }, { sender: owner });
  const generated = await generation.generateH5P({
    documentIds: [DOC_ID],
    activityType: 'questionset',
    questionCount: 2,
    instructions: 'Instrucción privada',
    title: 'Evaluación inicial',
    sessionId: opened.sessionId
  }, { sender: owner });
  assert.equal(generated.status, 'ok');

  const [q1, q2] = generated.activity.items;
  // Cambiar correcta, renombrar opción con prefijo literal, cambiar feedback y reordenar preguntas
  const edited = await editor.updateEditor({
    sessionId: opened.sessionId,
    expectedRevision: generated.activity.revision,
    operations: [
      { type: 'setTitle', title: 'Evaluación aprobada' },
      { type: 'setOptionText', itemId: q1.id, optionId: q1.options[1].id, text: 'B) Respuesta corregida' },
      { type: 'setOptionText', itemId: q1.id, optionId: q1.options[0].id, text: 'A) Distractor antiguo' },
      { type: 'setOptionText', itemId: q1.id, optionId: q1.options[2].id, text: 'C) Tercera' },
      { type: 'setOptionText', itemId: q1.id, optionId: q1.options[3].id, text: 'D) Cuarta' },
      { type: 'setCorrectOption', itemId: q1.id, optionId: q1.options[1].id },
      { type: 'setItemText', itemId: q1.id, field: 'feedback', text: 'Retroalimentación editada por el docente.' },
      { type: 'moveItem', itemId: q2.id, index: 0 }
    ]
  }, { sender: owner });
  assert.equal(edited.status, 'ok');

  // Revisión obsoleta es rechazada
  const stalePrepare = await generation.prepareReviewed({
    sessionId: opened.sessionId,
    expectedRevision: 1
  }, { sender: owner });
  assert.equal(stalePrepare.code, 'REVISION_CONFLICT');

  // Preparación válida
  const prepared = await generation.prepareReviewed({
    sessionId: opened.sessionId,
    expectedRevision: edited.activity.revision
  }, { sender: owner });
  assert.equal(prepared.status, 'ok');
  assert.equal(prepared.revision, edited.activity.revision);
  assert.equal(prepared.reviewedRevision, edited.activity.revision);

  // El worker recibió únicamente tipo, ítems proyectados, título y marca reviewed, sin IDs editoriales ni instrucciones
  assert.equal(capturedWorkerData.length, 1);
  assert.deepEqual(Object.keys(capturedWorkerData[0]).sort(), ['activityType', 'items', 'reviewed', 'title']);
  assert.equal(capturedWorkerData[0].reviewed, true);
  assert.equal(capturedWorkerData[0].title, 'Evaluación aprobada');
  assert.equal(JSON.stringify(capturedWorkerData[0]).includes(q1.id), false);
  assert.equal(JSON.stringify(capturedWorkerData[0]).includes('Instrucción privada'), false);

  // Un cambio posterior invalida el paquete recién preparado antes de guardar
  const postEdit = await editor.updateEditor({
    sessionId: opened.sessionId,
    expectedRevision: prepared.revision,
    operations: [{ type: 'setTitle', title: 'Evaluación aprobada v2' }]
  }, { sender: owner });
  assert.equal(postEdit.status, 'ok');
  assert.equal(postEdit.activity.reviewedRevision, null);
  const saveAfterEdit = await generation.saveH5PFile({ packageId: prepared.packageId, suggestedName: 'revisado' }, { sender: owner });
  assert.equal(saveAfterEdit.code, 'REVISION_CONFLICT');

  // Re-preparamos con la nueva revisión, guardamos y verificamos el contenido del ZIP resultante
  const preparedV2 = await generation.prepareReviewed({
    sessionId: opened.sessionId,
    expectedRevision: postEdit.activity.revision
  }, { sender: owner });
  assert.equal(preparedV2.status, 'ok');

  const saved = await generation.saveH5PFile({ packageId: preparedV2.packageId, suggestedName: 'revisado' }, { sender: owner });
  assert.equal(saved.status, 'ok');
  const zip = await JSZip.loadAsync(await fsp.readFile(destination));
  const h5pJson = JSON.parse(await zip.file('h5p.json').async('string'));
  const content = JSON.parse(await zip.file('content/content.json').async('string'));
  assert.equal(h5pJson.title, 'Evaluación aprobada v2');
  // Pregunta 2 pasó al índice 0 y Pregunta 1 pasó al índice 1
  assert.equal(content.questions[0].params.question, '<p>Pregunta 2</p>');
  assert.equal(content.questions[1].params.question, '<p>Pregunta 1</p>');
  // Prefijos literales conservados y nueva correcta en índice 1
  assert.deepEqual(content.questions[1].params.answers.map(a => a.text), [
    '<div>A) Distractor antiguo</div>',
    '<div>B) Respuesta corregida</div>',
    '<div>C) Tercera</div>',
    '<div>D) Cuarta</div>'
  ]);
  assert.deepEqual(content.questions[1].params.answers.map(a => a.correct), [false, true, false, false]);
  assert.equal(content.questions[1].params.overallFeedback[0].feedback, 'Retroalimentación editada por el docente.');
});

test('prepareReviewed gestiona doble clic, cancelación y fallo del worker permitiendo reintentar sin llamar a Gemini', async t => {
  let workerMode = 'slow';
  let workerStarted;
  const workerStartedPromise = new Promise(resolve => { workerStarted = resolve; });

  class ControlledWorker extends EventEmitter {
    constructor(file, options) {
      super();
      this._mode = workerMode;
      if (this._mode === 'fail') {
        queueMicrotask(() => this.emit('error', new Error('fallo interno')));
      } else if (this._mode === 'slow') {
        queueMicrotask(() => workerStarted());
      } else {
        const real = new Worker(file, options);
        real.on('message', msg => this.emit('message', msg));
        real.on('error', err => this.emit('error', err));
        real.on('exit', code => this.emit('exit', code));
        this._real = real;
      }
    }
    async terminate() {
      if (this._real) return this._real.terminate();
      this.emit('exit', 1);
    }
  }

  const { storage, editor, owner, generation, getGenerateCalls } = setup(t, { WorkerClass: ControlledWorker });
  const draft = storage.saveDraft({ courseId: 'unassigned', activityType: 'truefalse', questionCount: 1 });
  const opened = await editor.openEditor({ draftId: draft.id }, { sender: owner });
  const generated = await generation.generateH5P({
    documentIds: [DOC_ID],
    activityType: 'truefalse',
    questionCount: 1,
    instructions: '',
    sessionId: opened.sessionId
  }, { sender: owner });
  assert.equal(getGenerateCalls(), 1);

  // Doble clic y cancelación durante empaquetado
  workerMode = 'slow';
  const firstPrepare = generation.prepareReviewed({
    sessionId: opened.sessionId,
    expectedRevision: generated.activity.revision
  }, { sender: owner });
  await workerStartedPromise;
  const secondClick = await generation.prepareReviewed({
    sessionId: opened.sessionId,
    expectedRevision: generated.activity.revision
  }, { sender: owner });
  assert.equal(secondClick.code, 'BUSY');
  assert.deepEqual(await generation.cancelGeneration({}, { sender: owner }), { status: 'ok', cancelled: true });
  assert.equal((await firstPrepare).code, 'GENERATION_CANCELLED');

  // Fallo del worker
  workerMode = 'fail';
  const failed = await generation.prepareReviewed({
    sessionId: opened.sessionId,
    expectedRevision: generated.activity.revision
  }, { sender: owner });
  assert.equal(failed.code, 'PACKAGE_FAILED');

  // Reintento exitoso sin volver a llamar a Gemini
  workerMode = 'real';
  const retry = await generation.prepareReviewed({
    sessionId: opened.sessionId,
    expectedRevision: generated.activity.revision
  }, { sender: owner });
  assert.equal(retry.status, 'ok');
  assert.equal(getGenerateCalls(), 1);

  // Borrador incompleto queda bloqueado con errores por campo
  const item = generated.activity.items[0];
  const broken = await editor.updateEditor({
    sessionId: opened.sessionId,
    expectedRevision: generated.activity.revision,
    operations: [{ type: 'setItemText', itemId: item.id, field: 'feedbackOnIncorrect', text: '' }]
  }, { sender: owner });
  const blocked = await generation.prepareReviewed({
    sessionId: opened.sessionId,
    expectedRevision: broken.activity.revision
  }, { sender: owner });
  assert.equal(blocked.code, 'INVALID_CONTENT');
  assert.deepEqual(blocked.issues, [{ itemId: item.id, field: 'feedbackOnIncorrect', code: 'REQUIRED' }]);
});
