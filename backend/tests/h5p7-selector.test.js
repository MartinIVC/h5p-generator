'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');

const { AcademicStorage } = require('../storage');
const { loadManifest, validateH5PPackage } = require('../h5pTemplates');
const { createH5PGeneration } = require('../../frontend/ipc/h5pGeneration');

const documentId = '11111111-2222-4333-8444-555555555555';
const makeQuestion = index => ({
  pregunta: `¿Qué concepto clave se evalúa en la pregunta ${index}?`,
  opciones: ['Concepto correcto', 'Distractor uno', 'Distractor dos', 'Distractor tres'],
  respuestaCorrecta: 'Concepto correcto',
  retroalimentacion: `Explicación formativa para la pregunta ${index}.`
});
const makeSender = () => Object.assign(new EventEmitter(), { isDestroyed: () => false });

function createGenerationHarness({ destination, count = 1 }) {
  const owner = makeSender();
  const doc = { text: 'Apunte académico de prueba para H5P-7.' };
  const projects = [];
  const storage = {
    getApiKey: () => 'clave-sintetica-h5p7',
    getCourseById: () => ({ id: 'curso-1' }),
    saveProject: project => { projects.push(project); }
  };
  const generation = createH5PGeneration({
    inspection: { getDocument: (s, id) => (s === owner && id === documentId ? doc : undefined) },
    storage,
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: destination }) },
    BrowserWindow: { fromWebContents: () => ({}) },
    app: { getPath: () => os.tmpdir() },
    generate: async (_src, _key, _ins, requestedCount) =>
      Array.from({ length: requestedCount || count }, (_, i) => makeQuestion(i + 1))
  });
  return { generation, owner, projects };
}

test('H5P-7 D3: saveDraft, getDrafts y restoreBackupPayload persisten y normalizan activityType y questionCount', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p7-storage-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const storePath = path.join(dir, 'academic_store.json');
  const storage = new AcademicStorage(storePath);

  const qsDraft = storage.saveDraft({
    courseId: 'unassigned',
    courseName: 'Proyecto sin ramo',
    prompt: 'Enfoque conceptual',
    activityType: 'questionset',
    questionCount: 10,
    files: [{ name: 'tema1.pdf', size: 1200, lastModified: 1 }]
  });
  assert.equal(qsDraft.activityType, 'questionset');
  assert.equal(qsDraft.questionCount, 10);

  // En multichoice, questionCount siempre se normaliza a 1
  const mcDraft = storage.saveDraft({
    courseId: 'unassigned',
    courseName: 'Proyecto sin ramo',
    prompt: 'Una pregunta clave',
    activityType: 'multichoice',
    questionCount: 10,
    files: []
  });
  assert.equal(mcDraft.activityType, 'multichoice');
  assert.equal(mcDraft.questionCount, 1);

  // Valores inválidos se normalizan con seguridad
  const invalidDraft = storage.saveDraft({
    courseId: 'unassigned',
    activityType: 'crossword',
    questionCount: 99,
    files: []
  });
  assert.equal(invalidDraft.activityType, null);
  assert.equal(invalidDraft.questionCount, 5);

  // Backup y restauración conservan activityType y questionCount
  const backup = storage.createBackupPayload();
  const restoredStorage = new AcademicStorage(path.join(dir, 'restored_store.json'));
  restoredStorage.restoreBackupPayload(backup, 'replace');
  const restoredDrafts = restoredStorage.getDrafts();
  const byId = new Map(restoredDrafts.map(d => [d.id, d]));
  assert.equal(byId.get(qsDraft.id).activityType, 'questionset');
  assert.equal(byId.get(qsDraft.id).questionCount, 10);
  assert.equal(byId.get(mcDraft.id).activityType, 'multichoice');
  assert.equal(byId.get(mcDraft.id).questionCount, 1);
  assert.equal(byId.get(invalidDraft.id).activityType, null);
  assert.equal(byId.get(invalidDraft.id).questionCount, 5);
});

test('H5P-7 CA-1/CA-5: genera y guarda H5P.MultiChoice 1.14 standalone con 1 pregunta y rechaza >1', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p7-multichoice-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'reactivo.h5p');
  const { generation, owner, projects } = createGenerationHarness({ destination, count: 1 });

  // Defensa en el proceso principal: multichoice solo admite 1 pregunta
  const rejected = await generation.generateH5P({
    documentIds: [documentId],
    activityType: 'multichoice',
    questionCount: 5,
    instructions: ''
  }, { sender: owner });
  assert.equal(rejected.status, 'error');
  assert.equal(rejected.code, 'UNSUPPORTED_TYPE');

  // Formatos pendientes de H5P-16 siguen rechazados en el proceso principal
  const upcomingRejected = await generation.generateH5P({
    documentIds: [documentId],
    activityType: 'crossword',
    questionCount: 5,
    instructions: ''
  }, { sender: owner });
  assert.equal(upcomingRejected.code, 'UNSUPPORTED_TYPE');

  const generated = await generation.generateH5P({
    documentIds: [documentId],
    activityType: 'multichoice',
    questionCount: 1,
    instructions: 'Nivel intermedio'
  }, { sender: owner });
  assert.equal(generated.status, 'ok');
  assert.equal(generated.questionCount, 1);

  const saved = await generation.saveH5PFile({
    packageId: generated.packageId,
    suggestedName: 'reactivo',
    courseId: 'curso-1'
  }, { sender: owner });
  assert.equal(saved.status, 'ok');
  assert.equal(projects.length, 1);
  assert.equal(projects[0].h5pType, 'Opción múltiple (H5P.MultiChoice)');

  const buffer = await fs.readFile(destination);
  const validation = await validateH5PPackage(buffer);
  assert.equal(validation.valid, true);
  assert.equal(validation.mainLibraryKey, 'H5P.MultiChoice 1.14');
  assert.equal(validation.libraryCount, 10);

  const zip = await JSZip.loadAsync(buffer);
  const content = JSON.parse(await zip.file('content/content.json').async('string'));
  assert.match(content.question, /pregunta 1/);
  assert.equal(content.answers.length, 4);
  assert.equal(content.answers.filter(a => a.correct).length, 1);
  assert.equal(content.overallFeedback[0].feedback, 'Explicación formativa para la pregunta 1.');
});

test('H5P-7 CA-1/CA-5: genera y guarda H5P.QuestionSet 1.17 con activityType "questionset" y múltiples preguntas', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p7-questionset-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'cuestionario.h5p');
  const { generation, owner, projects } = createGenerationHarness({ destination, count: 3 });

  const generated = await generation.generateH5P({
    documentIds: [documentId],
    activityType: 'questionset',
    questionCount: 3,
    instructions: ''
  }, { sender: owner });
  assert.equal(generated.status, 'ok');
  assert.equal(generated.questionCount, 3);

  const saved = await generation.saveH5PFile({
    packageId: generated.packageId,
    suggestedName: 'cuestionario',
    courseId: 'curso-1'
  }, { sender: owner });
  assert.equal(saved.status, 'ok');
  assert.equal(projects.length, 1);
  assert.equal(projects[0].h5pType, 'Cuestionario (H5P.QuestionSet)');

  const buffer = await fs.readFile(destination);
  const validation = await validateH5PPackage(buffer);
  assert.equal(validation.valid, true);
  assert.equal(validation.mainLibraryKey, 'H5P.QuestionSet 1.17');
  assert.equal(validation.libraryCount, 15);

  const zip = await JSZip.loadAsync(buffer);
  const content = JSON.parse(await zip.file('content/content.json').async('string'));
  assert.equal(content.questions.length, 3);
});

test('H5P-7: el catálogo de tarjetas de frontend/js/upload.js coincide 1-a-1 con los 12 formatos de manifest.json', async () => {
  const manifest = await loadManifest();
  const uploadSource = await fs.readFile(path.join(__dirname, '../../frontend/js/upload.js'), 'utf8');
  const manifestTypes = Object.keys(manifest.templates).sort();

  const matches = [...uploadSource.matchAll(/type:\s*'([a-z]+)'/g)].map(m => m[1]);
  assert.equal(matches.length, 12);
  assert.deepEqual([...matches].sort(), manifestTypes);
});
