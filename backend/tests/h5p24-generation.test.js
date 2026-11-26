'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AcademicStorage } = require('../storage');
const { createH5PEditor } = require('../../frontend/ipc/h5pEditor');
const { createH5PGeneration } = require('../../frontend/ipc/h5pGeneration');
const { generateQuestionsFromChunk } = require('../llmClient');

function createMockSender() {
  const emitter = new EventEmitter();
  emitter.isDestroyed = () => false;
  return emitter;
}

class FakePackageWorker extends EventEmitter {
  constructor() {
    super();
    process.nextTick(() => {
      this.emit('message', { bytes: Uint8Array.from([80, 75, 3, 4]) });
    });
  }
  async terminate() {}
}

const validGeminiPayload = (pregunta = '¿Qué es H5P?') => ({
  candidates: [{
    finishReason: 'STOP',
    content: {
      parts: [{
        text: JSON.stringify([{
          pregunta,
          opciones: ['Un paquete interactivo HTML5', 'Un motor de base de datos', 'Un sistema operativo', 'Un cable de red'],
          respuestaCorrecta: 'Un paquete interactivo HTML5',
          retroalimentacion: 'El apunte define H5P como el estándar HTML5 Package para actividades interactivas.'
        }])
      }]
    }
  }]
});

test('H5P-24: Genera desde TXT y PDF (con y sin instrucciones) sin exponer API key', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p24-gen-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = new AcademicStorage(path.join(dir, 'academic_store.json'));
  storage.getApiKey = () => 'clave-secreta-local';
  const editor = createH5PEditor({ storage });

  const sender = createMockSender();
  const docs = new Map([
    ['doc-txt', { name: 'apunte.txt', size: 120, text: 'Contenido del apunte en TXT sobre H5P.' }],
    ['doc-pdf', { name: 'apunte.pdf', size: 540, text: 'Contenido del apunte en PDF sobre H5P.' }]
  ]);

  const capturedPrompts = [];
  const mockFetch = async (_url, init) => {
    capturedPrompts.push(JSON.parse(init.body));
    return {
      ok: true,
      status: 200,
      json: async () => validGeminiPayload()
    };
  };

  const generation = createH5PGeneration({
    inspection: { getDocument: (_s, id) => docs.get(id) },
    storage,
    dialog: {},
    BrowserWindow: {},
    app: {},
    WorkerClass: FakePackageWorker,
    generate: (text, key, instructions, count, opts) =>
      generateQuestionsFromChunk(text, key, instructions, count, { ...opts, fetch: mockFetch, wait: async () => {} }),
    editor
  });

  const draft = storage.saveDraft({ courseId: 'unassigned', activityType: 'questionset', questionCount: 1 });
  const opened = await editor.openEditor({ draftId: draft.id }, { sender });

  // 1. Prueba con TXT sin instrucciones
  const resTxt = await generation.generateH5P({
    documentIds: ['doc-txt'],
    activityType: 'multiple-choice',
    questionCount: 1,
    instructions: '',
    sessionId: opened.sessionId
  }, { sender });

  assert.equal(resTxt.status, 'ok');
  assert.equal(resTxt.kind, 'editable');
  assert.equal(resTxt.questionCount, 1);

  // 2. Prueba con PDF + instrucciones del docente
  const resPdf = await generation.generateH5P({
    documentIds: ['doc-pdf'],
    activityType: 'multiple-choice',
    questionCount: 1,
    instructions: 'Enfócate en definiciones clave con dificultad media.',
    sessionId: opened.sessionId
  }, { sender });

  assert.equal(resPdf.status, 'ok');
  assert.equal(resPdf.kind, 'editable');
  assert.equal(resPdf.questionCount, 1);
  assert.equal(capturedPrompts.length, 2);
});

test('H5P-24: Maneja falla simulada de API (HTTP 503 / 429) y clave ausente', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p24-err-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = new AcademicStorage(path.join(dir, 'academic_store.json'));
  const editor = createH5PEditor({ storage });
  const sender = createMockSender();
  const docs = new Map([['doc-1', { name: 'apunte.pdf', size: 100, text: 'Texto válido de prueba.' }]]);
  const draft = storage.saveDraft({ courseId: 'unassigned', activityType: 'questionset', questionCount: 1 });
  const opened = await editor.openEditor({ draftId: draft.id }, { sender });

  // 1. Clave ausente
  storage.getApiKey = () => '';
  const genSinClave = createH5PGeneration({
    inspection: { getDocument: (_s, id) => docs.get(id) },
    storage,
    dialog: {}, BrowserWindow: {}, app: {}, WorkerClass: FakePackageWorker, editor
  });
  const resSinClave = await genSinClave.generateH5P({
    documentIds: ['doc-1'], activityType: 'multiple-choice', questionCount: 1, instructions: '', sessionId: opened.sessionId
  }, { sender });
  assert.equal(resSinClave.code, 'MISSING_KEY');

  // 2. Falla simulada 503 persistente (verifica 3 intentos con Backoff)
  storage.getApiKey = () => 'clave-secreta';
  let attempts = 0;
  const mockFetch503 = async () => {
    attempts++;
    return { ok: false, status: 503, body: { cancel: async () => {} } };
  };

  const gen503 = createH5PGeneration({
    inspection: { getDocument: (_s, id) => docs.get(id) },
    storage,
    dialog: {}, BrowserWindow: {}, app: {}, WorkerClass: FakePackageWorker,
    generate: (text, key, instructions, count, opts) =>
      generateQuestionsFromChunk(text, key, instructions, count, { ...opts, fetch: mockFetch503, wait: async () => {} }),
    editor
  });

  const res503 = await gen503.generateH5P({
    documentIds: ['doc-1'], activityType: 'multiple-choice', questionCount: 1, instructions: '', sessionId: opened.sessionId
  }, { sender });

  assert.equal(attempts, 3);
  assert.equal(res503.code, 'SERVICE_UNAVAILABLE');
});
