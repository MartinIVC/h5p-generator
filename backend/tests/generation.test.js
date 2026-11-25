'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { createH5PGeneration } = require('../../frontend/ipc/h5pGeneration');
const { generateQuestionsFromChunk, validateQuestions } = require('../llmClient');
const documentId = '01234567-89ab-4cde-8fab-0123456789ab';
const questions = [{ pregunta: '¿Qué es <H5P>?', opciones: ['Una actividad', 'Otra', 'Tercera', 'Cuarta'], respuestaCorrecta: 'Una actividad', retroalimentacion: 'Una actividad <interactiva> & formativa; @score y @total son texto.' }];
const request = { documentIds: [documentId], activityType: 'multiple-choice', questionCount: 1, instructions: '' };
const sender = () => Object.assign(new EventEmitter(), { isDestroyed: () => false });
function setup(opts = {}) {
  const owner = sender(); const doc = { text: 'Texto privado del apunte' }; const projects = [];
  const storage = { getApiKey: () => 'clave-privada', getCourseById: () => ({ id: 'curso' }), saveProject: project => { projects.push(project); } };
  const generation = createH5PGeneration({
    inspection: { getDocument: (s, id) => s === owner && id === documentId ? doc : undefined },
    WorkerClass: opts.WorkerClass,
    storage: { ...storage, ...opts.storage }, dialog: opts.dialog || {}, BrowserWindow: { fromWebContents: () => ({}) },
    app: opts.app || { getPath: () => os.tmpdir() }, generate: opts.generate || (async () => questions)
  });
  return { generation, owner, projects };
}
test('genera y guarda H5P con bibliotecas, respuestas válidas y registro', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-generation-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'actividad.h5p');
  const { generation, owner, projects } = setup({ dialog: { showSaveDialog: async () => ({ canceled: false, filePath: destination }) } });
  const generated = await generation.generateH5P(request, { sender: owner });
  assert.equal(generated.status, 'ok'); assert.equal(generated.kind, 'package'); assert.equal(JSON.stringify(generated).includes('privado'), false);
  assert.equal((await generation.saveH5PFile({ packageId: generated.packageId, suggestedName: 'actividad' }, { sender: sender() })).code, 'NOT_FOUND');
  const saved = await generation.saveH5PFile({ packageId: generated.packageId, suggestedName: 'actividad', courseId: 'curso' }, { sender: owner });
  assert.equal(saved.status, 'ok'); assert.equal(saved.projectSaved, true); assert.equal(projects.length, 1); assert.equal(projects[0].filePath, destination);
  const zip = await JSZip.loadAsync(await fs.readFile(destination));
  const meta = JSON.parse(await zip.file('h5p.json').async('string')); const content = JSON.parse(await zip.file('content/content.json').async('string'));
  assert.equal(meta.mainLibrary, 'H5P.QuestionSet'); assert.equal(content.questions.length, 1);
  assert.equal(content.questions[0].params.question, '<p>¿Qué es &lt;H5P&gt;?</p>');
  assert.equal(content.questions[0].params.answers.filter(answer => answer.correct).length, 1);
  assert.deepEqual(content.questions[0].params.overallFeedback, [{ from: 0, to: 100, feedback: 'Una actividad &lt;interactiva&gt; &amp; formativa; &#64;score y &#64;total son texto.' }]);
  assert.equal(content.questions[0].params.behaviour.randomAnswers, false);
  assert.equal(zip.file('content/images/file-5885c0f3dcafc.jpg'), null);
  for (const dep of meta.preloadedDependencies) assert.ok(zip.file(`${dep.machineName}-${dep.majorVersion}.${dep.minorVersion}/library.json`), dep.machineName);
  for (const entry of Object.keys(zip.files).filter(name => name.endsWith('/library.json'))) {
    const library = JSON.parse(await zip.file(entry).async('string'));
    for (const kind of ['preloadedDependencies', 'editorDependencies', 'dynamicDependencies']) {
      for (const dep of library[kind] || []) {
        assert.ok(zip.file(`${dep.machineName}-${dep.majorVersion}.${dep.minorVersion}/library.json`), `${entry}: ${dep.machineName}`);
      }
    }
  }
});
test('elimina etiquetas completas sin cambiar la respuesta correcta', () => {
  for (const options of [
    ['A) Primera', 'B) Segunda', 'C) Tercera', 'D) Cuarta'],
    ['(a) Primera', '(b) Segunda', '(c) Tercera', '(d) Cuarta'],
    ['C. Primera', 'A. Segunda', 'D. Tercera', 'B. Cuarta']
  ]) {
    const [result] = validateQuestions([{ pregunta: 'Pregunta', opciones: options, respuestaCorrecta: options[2], retroalimentacion: 'Explicación de la respuesta.' }], 1);
    assert.deepEqual(result.opciones, ['Primera', 'Segunda', 'Tercera', 'Cuarta']);
    assert.equal(result.respuestaCorrecta, 'Tercera');
  }
});
test('conserva iniciales aisladas y rechaza alternativas duplicadas después de limpiar', () => {
  const options = ['A. thaliana', 'Bacillus subtilis', 'Candida albicans', 'Drosophila'];
  const [result] = validateQuestions([{ pregunta: 'Pregunta', opciones: options, respuestaCorrecta: options[0], retroalimentacion: 'Explicación de la respuesta.' }], 1);
  assert.deepEqual(result.opciones, options);
  assert.throws(() => validateQuestions([{ pregunta: 'Pregunta', opciones: ['A) Igual', 'B) Igual', 'C) Otra', 'D) Distinta'], respuestaCorrecta: 'A) Igual', retroalimentacion: 'Explicación de la respuesta.' }], 1), /INVALID_RESPONSE/);
});
test('el paquete elimina etiquetas y conserva la opción correcta', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-labels-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'actividad.h5p');
  const labeled = [{ pregunta: 'Pregunta', opciones: ['A) Uno', 'B) Dos', 'C) Tres', 'D) Cuatro'], respuestaCorrecta: 'C) Tres', retroalimentacion: 'Explicación de la respuesta.' }];
  const { generation, owner } = setup({ generate: async () => labeled, dialog: { showSaveDialog: async () => ({ filePath: destination }) } });
  const generated = await generation.generateH5P(request, { sender: owner });
  assert.equal(generated.status, 'ok');
  assert.equal((await generation.saveH5PFile({ packageId: generated.packageId, suggestedName: 'actividad' }, { sender: owner })).status, 'ok');
  const zip = await JSZip.loadAsync(await fs.readFile(destination));
  const content = JSON.parse(await zip.file('content/content.json').async('string'));
  const answers = content.questions[0].params.answers;
  assert.deepEqual(answers.map(answer => answer.text), ['<div>Uno</div>', '<div>Dos</div>', '<div>Tres</div>', '<div>Cuatro</div>']);
  assert.deepEqual(answers.map(answer => answer.correct), [false, false, true, false]);
  assert.equal(content.questions[0].params.behaviour.randomAnswers, false);
});
test('cancelación no crea archivo; fallo de registro reconoce archivo guardado', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-generation-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let cancel = true; const destination = path.join(dir, 'actividad.h5p');
  const { generation, owner } = setup({ storage: { saveProject: () => { throw new Error('privado'); } }, dialog: { showSaveDialog: async () => cancel ? { canceled: true } : { filePath: destination } } });
  const result = await generation.generateH5P(request, { sender: owner });
  assert.equal((await generation.saveH5PFile({ packageId: result.packageId, suggestedName: 'actividad' }, { sender: owner })).status, 'cancelled');
  assert.deepEqual(await fs.readdir(dir), []); cancel = false;
  const saved = await generation.saveH5PFile({ packageId: result.packageId, suggestedName: 'actividad' }, { sender: owner });
  assert.equal(saved.status, 'ok'); assert.equal(saved.projectSaved, false); assert.ok((await fs.stat(destination)).size);
});
test('rechaza documentos ajenos, clave ausente y respuesta inválida sin filtrar secretos', async () => {
  const missing = setup({ storage: { getApiKey: () => '' } });
  assert.equal((await missing.generation.generateH5P(request, { sender: missing.owner })).code, 'MISSING_KEY');
  assert.equal((await missing.generation.generateH5P(request, { sender: sender() })).code, 'DOCUMENT_NOT_FOUND');
  const malformed = setup({ generate: async () => { throw new Error('INVALID_RESPONSE'); } });
  assert.equal((await malformed.generation.generateH5P(request, { sender: malformed.owner })).code, 'INVALID_RESPONSE');
});
test('cliente Gemini comprueba esquema sin devolver la clave', async () => {
  const fetch = async (_url, init) => { assert.equal(init.headers['x-goog-api-key'], 'clave-privada'); return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(questions) }] } }] }) }; };
  assert.deepEqual(await generateQuestionsFromChunk('apunte', 'clave-privada', '', 1, { fetch }), questions);
  const badFetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ ...questions[0], respuestaCorrecta: 'no existe' }]) }] } }] }) });
  await assert.rejects(generateQuestionsFromChunk('apunte', 'clave-privada', '', 1, { fetch: badFetch }), /INVALID_RESPONSE/);
});
test('libera el paquete al navegar y rechaza documentos modificados durante la generación', async () => {
  const { generation, owner } = setup();
  const result = await generation.generateH5P(request, { sender: owner });
  owner.emit('did-start-navigation', {}, 'file:', false, true);
  assert.equal((await generation.saveH5PFile({ packageId: result.packageId, suggestedName: 'actividad' }, { sender: owner })).code, 'NOT_FOUND');
  let done; let present = true;
  const target = sender();
  const service = createH5PGeneration({
    inspection: { getDocument: () => present ? doc : undefined },
    storage: { getApiKey: () => 'key' }, dialog: {}, BrowserWindow: {}, app: {},
    generate: () => new Promise(resolve => { done = resolve; })
  });
  const doc = { text: 'texto' };
  const pending = service.generateH5P(request, { sender: target });
  present = false; done(questions);
  assert.equal((await pending).code, 'DOCUMENT_NOT_FOUND');
});
test('errores de escritura no registran proyectos ni exponen el error', async () => {
  const destination = '/carpeta-inexistente/actividad.h5p';
  const { generation, owner, projects } = setup({ dialog: { showSaveDialog: async () => ({ filePath: destination }) } });
  const generated = await generation.generateH5P(request, { sender: owner });
  const result = await generation.saveH5PFile({ packageId: generated.packageId, suggestedName: 'actividad' }, { sender: owner });
  assert.equal(result.code, 'SAVE_FAILED'); assert.equal(projects.length, 0); assert.doesNotMatch(JSON.stringify(result), /carpeta-inexistente/);
});

test('IPC diferencia fallos de red, servicio, timeout y empaquetado sin revelar excepciones', async () => {
  for (const code of ['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'API_REQUEST_FAILED', 'GENERATION_TIMEOUT']) {
    const { generation, owner } = setup({ generate: async () => { throw new Error(code); } });
    const result = await generation.generateH5P(request, { sender: owner });
    assert.equal(result.code, code); assert.ok(result.message);
  }
  class FailedWorker extends EventEmitter {
    constructor() { super(); queueMicrotask(() => this.emit('error', new Error('ruta y contenido privados'))); }
    async terminate() {}
  }
  const { generation, owner } = setup({ WorkerClass: FailedWorker });
  const result = await generation.generateH5P(request, { sender: owner });
  assert.equal(result.code, 'PACKAGE_FAILED');
  assert.doesNotMatch(JSON.stringify(result), /privados|conexión/);
});
test('IPC expone solo motivos de validación conocidos y nunca detalles del proveedor', async () => {
  for (const reason of ['COUNT', 'DUPLICATE_OPTIONS', 'CORRECT_ANSWER', 'FEEDBACK', 'dato privado']) {
    const { generation, owner } = setup({ generate: async () => { throw Object.assign(new Error('INVALID_RESPONSE'), { reason, raw: 'contenido privado' }); } });
    const result = await generation.generateH5P(request, { sender: owner });
    assert.equal(result.code, 'INVALID_RESPONSE');
    assert.equal(result.reason, reason === 'dato privado' ? undefined : reason);
    assert.doesNotMatch(JSON.stringify(result), /dato privado|contenido privado/);
  }
});
test('H5P-34 (BUG-14): distingue fallo de safeStorage, exige extensión .h5p con mensaje claro y tolera fallo de getPath("documents")', async t => {
  const failingKey = setup({ storage: { getApiKey: () => { throw new Error('llavero bloqueado'); } } });
  const keyResult = await failingKey.generation.generateH5P(request, { sender: failingKey.owner });
  assert.equal(keyResult.code, 'SECURE_STORAGE_UNAVAILABLE');
  assert.doesNotMatch(keyResult.message, /llavero bloqueado/);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-bug14-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let capturedDefaultPath = '';
  const { generation, owner } = setup({
    app: { getPath: name => { if (name === 'documents') throw new Error('no documents'); return dir; } },
    dialog: {
      showSaveDialog: async (_win, opts) => {
        capturedDefaultPath = opts.defaultPath;
        return { filePath: path.join(dir, 'sin-extension') };
      }
    }
  });
  const generated = await generation.generateH5P(request, { sender: owner });
  assert.equal(generated.status, 'ok');
  const saveResult = await generation.saveH5PFile({ packageId: generated.packageId, suggestedName: 'actividad' }, { sender: owner });
  assert.equal(saveResult.code, 'SAVE_FAILED');
  assert.match(saveResult.message, /\.h5p/);
  assert.equal(path.dirname(capturedDefaultPath), dir);
});

test('H5P-33 (BUG-08): cancelGeneration aborta la generación en curso, libera BUSY y permite reintentar', async () => {
  let calls = 0;
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const { generation, owner } = setup({
    generate: (_source, _key, _instructions, _count, options) => {
      calls++;
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          started();
          options.signal.addEventListener('abort', () => reject(new Error('GENERATION_CANCELLED')), { once: true });
        });
      }
      return Promise.resolve(questions);
    }
  });

  // Sin operación activa devuelve cancelled: false
  assert.deepEqual(await generation.cancelGeneration({}, { sender: owner }), { status: 'ok', cancelled: false });

  const inFlight = generation.generateH5P(request, { sender: owner });
  await startedPromise;
  // Mientras corre, otra generación recibe BUSY
  assert.equal((await generation.generateH5P(request, { sender: owner })).code, 'BUSY');
  // Al cancelar, aborta limpiamente sin cerrar la sesión de la ventana
  assert.deepEqual(await generation.cancelGeneration({}, { sender: owner }), { status: 'ok', cancelled: true });
  assert.equal((await inFlight).code, 'GENERATION_CANCELLED');

  // Inmediatamente después, una nueva generación en la misma ventana funciona sin BUSY
  const retry = await generation.generateH5P(request, { sender: owner });
  assert.equal(retry.status, 'ok');
  assert.equal(retry.questionCount, 1);
});

test('H5P-22: registra sourceFiles (solo nombres), devuelve projectId opaco y no crea registro si falla la escritura', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-22-save-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'evaluacion-u1.h5p');
  const secondDocId = '11234567-89ab-4cde-8fab-0123456789ab';
  const owner = sender();
  const docs = new Map([
    [documentId, { name: 'guia-unidad-1.pdf', text: 'Contenido secreto del apunte 1' }],
    [secondDocId, { name: 'lectura-complementaria.docx', text: 'Contenido secreto del apunte 2' }]
  ]);
  const projects = [];
  let dialogChoice = { canceled: false, filePath: destination };
  const generation = createH5PGeneration({
    inspection: { getDocument: (s, id) => s === owner ? docs.get(id) : undefined },
    storage: {
      getApiKey: () => 'clave-privada',
      getCourseById: id => id === 'curso-bio' ? { id: 'curso-bio' } : null,
      saveProject: project => {
        const record = { id: 'proj-h5p22-1', ...project };
        projects.push(record);
        return record;
      }
    },
    dialog: { showSaveDialog: async () => dialogChoice },
    BrowserWindow: { fromWebContents: () => ({}) },
    app: { getPath: () => dir },
    generate: async () => questions
  });

  const generated = await generation.generateH5P({
    documentIds: [documentId, secondDocId],
    activityType: 'questionset',
    questionCount: 1,
    instructions: 'Instrucciones privadas del docente'
  }, { sender: owner });
  assert.equal(generated.status, 'ok');

  // Ramo inexistente rechaza antes de abrir diálogo o escribir archivo
  const invalidCourse = await generation.saveH5PFile({
    packageId: generated.packageId,
    suggestedName: 'evaluacion-u1',
    courseId: 'ramo-inexistente'
  }, { sender: owner });
  assert.equal(invalidCourse.code, 'INVALID_COURSE');
  assert.equal(projects.length, 0);
  assert.deepEqual(await fs.readdir(dir), []);

  // Guardado confirmado escribe .h5p, registra sourceFiles sin texto/instrucciones y retorna projectId
  const saved = await generation.saveH5PFile({
    packageId: generated.packageId,
    suggestedName: 'evaluacion-u1.h5p',
    courseId: 'curso-bio'
  }, { sender: owner });
  assert.equal(saved.status, 'ok');
  assert.equal(saved.fileName, 'evaluacion-u1.h5p');
  assert.equal(saved.projectSaved, true);
  assert.equal(saved.projectId, 'proj-h5p22-1');
  assert.equal(projects.length, 1);
  assert.equal(projects[0].courseId, 'curso-bio');
  assert.equal(projects[0].filePath, destination);
  assert.equal(projects[0].h5pType, 'Cuestionario (H5P.QuestionSet)');
  assert.deepEqual(projects[0].sourceFiles, [
    { name: 'guia-unidad-1.pdf' },
    { name: 'lectura-complementaria.docx' }
  ]);
  assert.equal(JSON.stringify(projects[0]).includes('secreto'), false);
  assert.equal(JSON.stringify(projects[0]).includes('Instrucciones privadas'), false);

  // Cancelación posterior no genera un segundo registro
  dialogChoice = { canceled: true };
  const cancelled = await generation.saveH5PFile({
    packageId: generated.packageId,
    suggestedName: 'evaluacion-u1',
    courseId: 'curso-bio'
  }, { sender: owner });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(projects.length, 1);
});
