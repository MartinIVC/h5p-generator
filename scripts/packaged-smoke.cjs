'use strict';
// Se ejecuta únicamente en una copia temporal del paquete, nunca se distribuye.
const { app, BrowserWindow, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const directory = process.env.H5P_TEST_DIRECTORY;
assert.ok(directory);
app.setPath('userData', path.join(directory, 'profile'));
app.setPath('sessionData', path.join(directory, 'session'));
const storage = require('./backend/storage').academicStorage;
storage.getApiKey = () => 'synthetic-test-key';
storage.getApiKeyStatus = () => ({ hasKey: true, maskedKey: 'test' });
let networkMode = 'ok';
let dialogMode = 'cancel';
let fetchCalls = 0;
let transientFailures = 0;
let invalidResponses = 0;
const questions = [{ pregunta: '¿Qué conserva la integridad?', opciones: ['A) Exactitud', 'B) Publicidad', 'C) Velocidad', 'D) Color'], respuestaCorrecta: 'A) Exactitud', retroalimentacion: 'La integridad protege la exactitud de la información.' }];
global.fetch = async (url, options) => {
  assert.match(url, /^https:\/\/generativelanguage.googleapis.com\//);
  assert.equal(options.headers['x-goog-api-key'], 'synthetic-test-key');
  fetchCalls++;
  if (networkMode === 'transient' && transientFailures++ < 2) return { ok: false, status: 503 };
  if (networkMode === 'offline') throw new Error('private network error');
  if (networkMode === 'quota') return { ok: false, status: 429 };
  const schema = JSON.parse(options.body).generationConfig.responseJsonSchema;
  const count = schema?.minItems || 1;
  const values = Array.from({ length: networkMode === 'invalid' && invalidResponses++ === 0 ? count - 1 : count }, (_, i) => ({ ...questions[0], pregunta: `Pregunta ${i + 1}`, retroalimentacion: `${questions[0].retroalimentacion} Pregunta ${i + 1}.` }));
  return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(values) }] } }] }) };
};
dialog.showSaveDialog = async () => dialogMode === 'cancel' ? { canceled: true } :
  { filePath: path.join(directory, dialogMode === 'failure' ? 'missing/output.h5p' : 'output.h5p') };

function assertNoListeners() {
  // Verifica sockets TCP LISTEN de main, renderer y procesos auxiliares.
  const sockets = new Set();
  for (const { pid } of app.getAppMetrics()) {
    let descriptors;
    try { descriptors = fs.readdirSync(`/proc/${pid}/fd`); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const fd of descriptors) {
      try {
        const match = fs.readlinkSync(`/proc/${pid}/fd/${fd}`).match(/^socket:\[(\d+)\]$/);
        if (match) sockets.add(match[1]);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    for (const row of fs.readFileSync(table, 'utf8').trim().split('\n').slice(1)) {
      const columns = row.trim().split(/\s+/);
      assert.ok(!(columns[3] === '0A' && sockets.has(columns[9])), 'La aplicación abrió un puerto TCP de escucha');
    }
  }
}
let window;
app.once('browser-window-created', (_event, win) => {
  window = win;
  win.webContents.once('did-finish-load', () => run().catch(error => { console.error(error); app.exit(1); }));
});
require('./frontend/index');
async function run() {
  assert.equal(app.isPackaged, true);
  assertNoListeners();
  const preferences = window.webContents.getLastWebPreferences();
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  const evaluate = expression => window.webContents.executeJavaScript(expression);
  const invoke = (method, request) => evaluate(`window.academicAPI.${method}(${JSON.stringify(request)})`);
  assert.deepEqual(await evaluate('[typeof require, typeof process, typeof window.academicAPI.ipcRenderer]'), ['undefined', 'undefined', 'undefined']);
  assert.equal((await invoke('verifyApiKey', 'synthetic-test-key')).status, 'valid');
  assert.equal((await invoke('inspectDocument', { name: '../private.txt', bytes: [1] })).code, 'INVALID_ARGUMENT');
  const inspect = text => evaluate(`window.academicAPI.inspectDocument({name:'sample.txt',bytes:new TextEncoder().encode(${JSON.stringify(text)})})`);
  assert.equal((await inspect('   ')).code, 'INSPECTION_FAILED');
  const inspected = await inspect('Material sintético: integridad significa exactitud de la información.');
  assert.equal(inspected.status, 'ok');
  const request = { documentIds: [inspected.documentId], activityType: 'multiple-choice', questionCount: 1, instructions: '' };
  const before = fetchCalls;
  assert.equal((await invoke('generateH5P', { ...request, extra: 'invalid' })).code, 'INVALID_ARGUMENT');
  assert.equal(fetchCalls, before);
  networkMode = 'offline';
  assert.equal((await invoke('generateH5P', request)).code, 'NETWORK_ERROR');
  networkMode = 'quota';
  assert.equal((await invoke('generateH5P', request)).code, 'QUOTA');
  networkMode = 'transient';
  const callsBeforeRecovery = fetchCalls;
  const generated = await invoke('generateH5P', request);
  assert.equal(generated.status, 'ok');
  assert.equal(fetchCalls - callsBeforeRecovery, 3);
  networkMode = 'ok';
  const save = { packageId: generated.packageId, suggestedName: 'actividad' };
  assert.equal((await invoke('saveH5PFile', save)).status, 'cancelled');
  assert.equal(fs.existsSync(path.join(directory, 'output.h5p')), false);
  dialogMode = 'failure';
  assert.equal((await invoke('saveH5PFile', save)).code, 'SAVE_FAILED');
  dialogMode = 'ok';
  const saved = await invoke('saveH5PFile', save);
  assert.equal(saved.status, 'ok');
  assert.equal(saved.projectSaved, true);
  const JSZip = require('./backend/node_modules/jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(directory, 'output.h5p')));
  const content = JSON.parse(await zip.file('content/content.json').async('string'));
  assert.equal(content.questions[0].params.behaviour.randomAnswers, false);
  assert.equal(content.questions[0].params.answers[0].text, '<div>Exactitud</div>');
  assert.equal(content.questions[0].params.answers[0].correct, true);
  assert.deepEqual(content.questions[0].params.overallFeedback, [{ from: 0, to: 100, feedback: `${questions[0].retroalimentacion} Pregunta 1.` }]);
  assert.equal((await invoke('getProjects', 'unassigned')).length, 1);
  networkMode = 'invalid';
  const beforeCorrection = fetchCalls;
  const twenty = await invoke('generateH5P', { ...request, questionCount: 20 });
  assert.equal(twenty.status, 'ok'); assert.equal(twenty.questionCount, 20);
  assert.equal(fetchCalls - beforeCorrection, 2);
  assert.equal((await invoke('saveH5PFile', { packageId: twenty.packageId, suggestedName: 'veinte' })).status, 'ok');
  const recoveredZip = await JSZip.loadAsync(fs.readFileSync(path.join(directory, 'output.h5p')));
  const recoveredContent = JSON.parse(await recoveredZip.file('content/content.json').async('string'));
  assert.equal(recoveredContent.questions.length, 20);
  for (const [i, question] of recoveredContent.questions.entries()) {
    assert.equal(question.params.answers.length, 4);
    assert.equal(question.params.answers.filter(answer => answer.correct).length, 1);
    assert.deepEqual(question.params.overallFeedback, [{ from: 0, to: 100, feedback: `${questions[0].retroalimentacion} Pregunta ${i + 1}.` }]);
  }
  networkMode = 'ok';
  assert.equal((await invoke('releaseDocument', inspected.documentId)).status, 'ok');
  assert.equal((await invoke('generateH5P', request)).code, 'DOCUMENT_NOT_FOUND');
  // Segundo renderer local: los UUID de otro propietario no son utilizables.
  const other = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'frontend/preload.js'), contextIsolation: true, nodeIntegration: false } });
  await other.loadFile(path.join(__dirname, 'frontend/index.html'));
  assert.equal((await other.webContents.executeJavaScript(`window.academicAPI.saveH5PFile(${JSON.stringify(save)})`)).code, 'NOT_FOUND');
  await other.loadURL('data:text/html,untrusted');
  assert.equal((await other.webContents.executeJavaScript('window.academicAPI.verifyApiKey("synthetic-test-key")')).status, 'error');
  assert.equal((await other.webContents.executeJavaScript(`window.academicAPI.saveH5PFile(${JSON.stringify(save)})`)).code, 'INVALID_SENDER');
  other.destroy();
  // Recorre también la interfaz real con un archivo sintético.
  const waitFor = async expression => {
    const deadline = Date.now() + 15000;
    while (!(await evaluate(expression))) {
      if (Date.now() > deadline) throw new Error(`Tiempo agotado: ${expression}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  window.setSize(840, 600);
  await evaluate(`window.coursesManager.startProjectCreation('unassigned')`);
  assert.equal(await evaluate('document.getElementById("btn-next-step").disabled'), true);
  await evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Material sintético sobre integridad.'], 'ui.txt', {type:'text/plain'}));
    const input = document.getElementById('upload-file-input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
    document.getElementById('btn-next-step').click();
  })()`);
  await waitFor('Boolean(document.getElementById("question-count"))');
  assert.equal(await evaluate('document.activeElement.id'), 'selector-title');
  await evaluate('document.getElementById("question-count").focus()');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await waitFor('document.activeElement.id === "h5p-name"');
  networkMode = 'offline';
  await evaluate('document.getElementById("question-count").value = 1; document.getElementById("btn-generate-h5p").click()');
  await waitFor('document.getElementById("generation-status").getAttribute("role") === "alert"');
  networkMode = 'ok';
  await evaluate('document.getElementById("btn-generate-h5p").click()');
  await waitFor('!document.getElementById("btn-save-h5p").classList.contains("hidden")');
  assert.equal(await evaluate('document.activeElement.id'), 'btn-save-h5p');
  dialogMode = 'cancel';
  await evaluate('document.getElementById("btn-save-h5p").click()');
  await waitFor('document.getElementById("generation-status").textContent.includes("cancelado")');
  dialogMode = 'ok';
  await evaluate('document.getElementById("btn-save-h5p").click()');
  await waitFor('document.getElementById("generation-status").textContent.includes("guardado y añadido")');
  assertNoListeners();
  console.log('PASS: paquete Linux, aislamiento, preload/IPC, workers, prompt vacío, errores de red/lectura/escritura, cancelación, guardado, registro, permisos por ventana y ausencia de puertos TCP de escucha. Interfaz a 840 × 600 y foco por teclado comprobados. Gemini y diálogo simulados.');
  app.exit(0);
}
