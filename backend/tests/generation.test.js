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
const questions = [{ pregunta: '¿Qué es <H5P>?', opciones: ['Una actividad', 'Otra', 'Tercera', 'Cuarta'], respuestaCorrecta: 'Una actividad' }];
const request = { documentIds: [documentId], activityType: 'multiple-choice', questionCount: 1, instructions: '' };
const sender = () => Object.assign(new EventEmitter(), { isDestroyed: () => false });
function setup(opts = {}) {
  const owner = sender(); const doc = { text: 'Texto privado del apunte' }; const projects = [];
  const storage = { getApiKey: () => 'clave-privada', getCourseById: () => ({ id: 'curso' }), saveProject: project => { projects.push(project); } };
  const generation = createH5PGeneration({
    inspection: { getDocument: (s, id) => s === owner && id === documentId ? doc : undefined },
    WorkerClass: opts.WorkerClass,
    storage: { ...storage, ...opts.storage }, dialog: opts.dialog || {}, BrowserWindow: { fromWebContents: () => ({}) },
    app: { getPath: () => os.tmpdir() }, generate: opts.generate || (async () => questions)
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
    const [result] = validateQuestions([{ pregunta: 'Pregunta', opciones: options, respuestaCorrecta: options[2] }], 1);
    assert.deepEqual(result.opciones, ['Primera', 'Segunda', 'Tercera', 'Cuarta']);
    assert.equal(result.respuestaCorrecta, 'Tercera');
  }
});
test('conserva iniciales aisladas y rechaza alternativas duplicadas después de limpiar', () => {
  const options = ['A. thaliana', 'Bacillus subtilis', 'Candida albicans', 'Drosophila'];
  const [result] = validateQuestions([{ pregunta: 'Pregunta', opciones: options, respuestaCorrecta: options[0] }], 1);
  assert.deepEqual(result.opciones, options);
  assert.throws(() => validateQuestions([{ pregunta: 'Pregunta', opciones: ['A) Igual', 'B) Igual', 'C) Otra', 'D) Distinta'], respuestaCorrecta: 'A) Igual' }], 1), /INVALID_RESPONSE/);
});
test('el paquete elimina etiquetas y conserva la opción correcta', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-labels-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'actividad.h5p');
  const labeled = [{ pregunta: 'Pregunta', opciones: ['A) Uno', 'B) Dos', 'C) Tres', 'D) Cuatro'], respuestaCorrecta: 'C) Tres' }];
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
