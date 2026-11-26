'use strict';
// Se ejecuta únicamente en una copia temporal del paquete, nunca se distribuye.
const { app, BrowserWindow, dialog, shell, Notification, ipcMain } = require('electron');
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
let keyStatusGate;
let saveDialogGate;
let rejectCancellation = false;
const handleIpc = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => handleIpc(channel, async (...args) => {
  if (channel === 'academic:getApiKeyStatus' && keyStatusGate) await keyStatusGate;
  if (channel === 'h5p:cancel-generation' && rejectCancellation) {
    rejectCancellation = false;
    return { status: 'error', code: 'INTERNAL_ERROR' };
  }
  return handler(...args);
});
let fetchCalls = 0;
let transientFailures = 0;
let invalidResponses = 0;
let notificationsSupported = true;
let simulatedFocused = true;
const nativeNotifications = [];
const revealedFiles = [];
Notification.isSupported = () => notificationsSupported;
Notification.prototype.show = function () {
  nativeNotifications.push({ title: this.title, body: this.body });
};
shell.showItemInFolder = target => { revealedFiles.push(target); };
const questions = [{ pregunta: '¿Qué conserva la integridad?', opciones: ['A) Exactitud', 'B) Publicidad', 'C) Velocidad', 'D) Color'], respuestaCorrecta: 'A) Exactitud', retroalimentacion: 'La integridad protege la exactitud de la información.' }];
global.fetch = async (url, options) => {
  assert.match(url, /^https:\/\/generativelanguage.googleapis.com\//);
  assert.equal(options.headers['x-goog-api-key'], 'synthetic-test-key');
  fetchCalls++;
  if (networkMode === 'slow') {
    await new Promise((_, reject) => {
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener('abort', abort, { once: true });
    });
  }
  if (networkMode === 'fallback' && url.includes('/gemini-3.5-flash-lite:')) return { ok: false, status: 404 };
  if (networkMode === 'unavailable') return { ok: false, status: 404 };
  if (networkMode === 'service503') return { ok: false, status: 503 };
  if (networkMode === 'transient' && transientFailures++ < 2) return { ok: false, status: 503 };
  if (networkMode === 'offline') throw new Error('private network error');
  if (networkMode === 'quota') return { ok: false, status: 429 };
  const schema = JSON.parse(options.body).generationConfig.responseJsonSchema;
  const count = schema?.minItems || 1;
  const required = schema?.items?.required || [];
  const effectiveCount = networkMode === 'invalid' && invalidResponses++ === 0 ? count - 1 : count;
  const values = required.includes('respuesta') && required.includes('pista')
    ? Array.from({ length: effectiveCount }, (_, i) => ({
      pregunta: `¿Qué garantiza la integridad ${i + 1}?`,
      respuesta: `Exactitud ${i + 1}`,
      pista: `Pista ${i + 1}`
    }))
    : Array.from({ length: effectiveCount }, (_, i) => ({
      ...questions[0],
      pregunta: `Pregunta ${i + 1}`,
      retroalimentacion: `${questions[0].retroalimentacion} Pregunta ${i + 1}.`
    }));
  return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(values) }] } }] }) };
};
const backupPath = path.join(directory, 'private-backup-name.json');
let cancelBackupSelection = false;
dialog.showOpenDialog = async () => cancelBackupSelection ? { canceled: true } : { filePaths: [backupPath] };
dialog.showSaveDialog = async (_window, options) => {
  if (saveDialogGate) return saveDialogGate;
  if (dialogMode === 'cancel') return { canceled: true };
  if (options.defaultPath.endsWith('.json')) return { filePath: backupPath };
  return { filePath: path.join(directory, dialogMode === 'failure' ? 'missing/output.h5p' : 'output.h5p') };
};

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
function buildSyntheticPdfBytes() {
  const stream = 'BT /F1 18 Tf 24 120 Td (Hola PDF Canvas) Tj ET\n';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream\nendobj\n`
  ];
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(out, 'utf8'));
    out += obj;
  }
  const xrefPos = Buffer.byteLength(out, 'utf8');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Array.from(Buffer.from(out, 'utf8'));
}
let window;
app.once('browser-window-created', (_event, win) => {
  window = win;
  win.isFocused = () => simulatedFocused;
  // El compositor puede cubrir la ventana de pruebas mientras PDF.js pinta en canvas.
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', () => run().catch(error => { console.error(error); app.exit(1); }));
});
require('./frontend/index');
async function run() {
  assert.equal(app.isPackaged, true);
  assertNoListeners();
  const preferences = window.webContents.getLastWebPreferences();
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.sandbox, true);
  const evaluate = expression => window.webContents.executeJavaScript(expression);
  const invoke = (method, request) => evaluate(`window.academicAPI.${method}(${JSON.stringify(request)})`);
  const waitFor = async expression => {
    const deadline = Date.now() + 15000;
    while (!(await evaluate(expression))) {
      if (Date.now() > deadline) throw new Error(`Tiempo agotado: ${expression}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  const measureContrast = selectorPairs => evaluate(`(() => {
    const parseRgb = str => {
      const nums = str.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number);
      return str.startsWith('color(srgb') ? nums.map(n => n * 255) : nums;
    };
    const lum = rgb => {
      const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
    };
    const ratio = (a, b) => {
      const l1 = lum(a), l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const prevLight = document.documentElement.classList.contains('light');
    const prevDark = document.documentElement.classList.contains('dark');
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(style);
    document.documentElement.getBoundingClientRect();
    try {
      const pairs = ${JSON.stringify(selectorPairs)};
      const measure = mode => {
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(mode);
        const out = {};
        for (const [key, fgSel, bgSel] of pairs) {
          const fg = document.querySelector(fgSel);
          const bg = document.querySelector(bgSel || fgSel);
          out[key] = ratio(parseRgb(getComputedStyle(fg).color), parseRgb(getComputedStyle(bg).backgroundColor));
        }
        return out;
      };
      return { dark: measure('dark'), light: measure('light') };
    } finally {
      style.remove();
      document.documentElement.classList.toggle('light', prevLight);
      document.documentElement.classList.toggle('dark', prevDark);
    }
  })()`);
  assert.deepEqual(await evaluate('[typeof require, typeof process, typeof window.academicAPI.ipcRenderer]'), ['undefined', 'undefined', 'undefined']);
  assert.equal(await invoke('verifyFileExists', '/etc/passwd'), false);
  assert.equal(await invoke('openExternalUrl', 'file:///etc/passwd'), false);
  assert.equal((await invoke('verifyApiKey', 'synthetic-test-key')).status, 'valid');
  // H5P-34 (BUG-22): clave malformada -> invalid sin red; doble 503 -> error (no unavailable)
  const beforeMalformed = fetchCalls;
  assert.equal((await invoke('verifyApiKey', 'AIza con espacio')).status, 'invalid');
  assert.equal(fetchCalls, beforeMalformed);
  networkMode = 'service503';
  const beforeDouble503 = fetchCalls;
  assert.equal((await invoke('verifyApiKey', 'synthetic-test-key')).status, 'error');
  assert.equal(fetchCalls - beforeDouble503, 2);
  networkMode = 'fallback';
  const beforeVerify = fetchCalls;
  await evaluate('window.configManager.openSettingsModal()');
  await waitFor('Boolean(document.getElementById("btn-verify-api-key"))');
  await evaluate('document.getElementById("btn-verify-api-key").click()');
  await waitFor('document.getElementById("api-key-verification").textContent === "Clave válida."');
  assert.equal(fetchCalls - beforeVerify, 2);
  await evaluate('document.getElementById("btn-close-settings-modal").click()');
  networkMode = 'ok';
  assert.equal((await invoke('inspectDocument', { name: '../private.txt', bytes: [1] })).code, 'INVALID_ARGUMENT');
  const inspect = text => evaluate(`window.academicAPI.inspectDocument({name:'sample.txt',bytes:new TextEncoder().encode(${JSON.stringify(text)})})`);
  assert.equal((await inspect('   ')).code, 'INSPECTION_FAILED');
  const inspected = await inspect('Material sintético: integridad significa exactitud de la información.');
  assert.equal(inspected.status, 'ok');
  // Navegación in-place vía skip-link (#main-content): no debe invalidar confianza IPC ni limpiar documentos.
  await evaluate('document.querySelector(".skip-link").click()');
  await waitFor('window.location.hash === "#main-content"');
  assert.equal(Array.isArray(await invoke('getCourses')), true);
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
  assert.equal((await invoke('generateH5P', request)).status, 'ok');
  assert.equal(fetchCalls - callsBeforeRecovery, 3);
  networkMode = 'unavailable';
  assert.equal((await invoke('generateH5P', request)).code, 'MODEL_UNAVAILABLE');
  networkMode = 'fallback';
  const beforeFallback = fetchCalls;
  const generated = await invoke('generateH5P', request);
  assert.equal(generated.status, 'ok');
  assert.equal(fetchCalls - beforeFallback, 2);
  networkMode = 'ok';
  const save = { packageId: generated.packageId, suggestedName: 'actividad' };
  assert.equal((await invoke('saveH5PFile', { packageId: generated.packageId, suggestedName: '.h5p' })).code, 'INVALID_ARGUMENT');
  assert.equal((await invoke('saveH5PFile', { packageId: generated.packageId, suggestedName: 'actividad:1' })).code, 'INVALID_ARGUMENT');
  assert.equal((await invoke('saveH5PFile', save)).status, 'cancelled');
  assert.equal(fs.existsSync(path.join(directory, 'output.h5p')), false);
  dialogMode = 'failure';
  assert.equal((await invoke('saveH5PFile', save)).code, 'SAVE_FAILED');
  dialogMode = 'ok';
  const saved = await invoke('saveH5PFile', save);
  assert.equal(saved.status, 'ok');
  assert.equal(saved.projectSaved, true);
  assert.equal(typeof saved.projectId, 'string');
  const JSZip = require('./backend/node_modules/jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(directory, 'output.h5p')));
  const content = JSON.parse(await zip.file('content/content.json').async('string'));
  assert.equal(content.questions[0].params.behaviour.randomAnswers, false);
  assert.equal(content.questions[0].params.answers[0].text, '<div>Exactitud</div>');
  assert.equal(content.questions[0].params.answers[0].correct, true);
  assert.deepEqual(content.questions[0].params.overallFeedback, [{ from: 0, to: 100, feedback: `${questions[0].retroalimentacion} Pregunta 1.` }]);
  const unassignedAfterFirstSave = await invoke('getProjects', 'unassigned');
  assert.equal(unassignedAfterFirstSave.length, 1);
  assert.equal(unassignedAfterFirstSave[0].id, saved.projectId);
  assert.equal(unassignedAfterFirstSave[0].fileExists, true);
  assert.deepEqual(unassignedAfterFirstSave[0].sourceFiles, [{ name: 'sample.txt' }]);
  networkMode = 'invalid';
  const beforeCorrection = fetchCalls;
  const twenty = await invoke('generateH5P', { ...request, questionCount: 20 });
  assert.equal(twenty.status, 'ok'); assert.equal(twenty.questionCount, 20);
  assert.equal(fetchCalls - beforeCorrection, 2);
  assert.equal((await invoke('saveH5PFile', { packageId: twenty.packageId, suggestedName: 'veinte' })).status, 'ok');
  // H5P-22: sobrescribir la misma ruta actualiza el registro sin duplicar proyectos
  assert.equal((await invoke('getProjects', 'unassigned')).length, 1);
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
  await assert.rejects(() => other.webContents.executeJavaScript('window.academicAPI.getCourses()'));
  other.destroy();
  // Recorre también la interfaz real: z-index, IME, vista previa parcial, visor PDF en <canvas>, aislamiento de borradores, contraste WCAG AA y cancelación.
  window.setSize(840, 600);
  // H5P-35 (BUG-16) + H5P-27: .ui-message-region por encima de modales, botón de cierre accesible y contraste WCAG AA en éxito y error
  await evaluate(`window.uiMessage('Aviso visible sobre modales', 'success'); window.uiMessage('Aviso de error visible', 'error');`);
  assert.equal(await evaluate(`(() => {
    const region = document.querySelector('.ui-message-region');
    const modal = document.getElementById('preview-modal');
    return Number(getComputedStyle(region).zIndex) > Number(getComputedStyle(modal).zIndex);
  })()`), true);
  const toastContrast = await measureContrast([
    ['success', '.ui-message-success'],
    ['error', '.ui-message-error']
  ]);
  assert.ok(toastContrast.light.success >= 4.5, `Contraste insuficiente en .ui-message-success (light): ${toastContrast.light.success}`);
  assert.ok(toastContrast.dark.success >= 4.5, `Contraste insuficiente en .ui-message-success (dark): ${toastContrast.dark.success}`);
  assert.ok(toastContrast.light.error >= 4.5, `Contraste insuficiente en .ui-message-error (light): ${toastContrast.light.error}`);
  assert.ok(toastContrast.dark.error >= 4.5, `Contraste insuficiente en .ui-message-error (dark): ${toastContrast.dark.error}`);
  await evaluate(`document.querySelectorAll('.ui-message-close').forEach(btn => btn.click())`);
  await waitFor('document.querySelectorAll(".ui-message").length === 0');
  // H5P-35 (BUG-19): buscador de Home preserva el nodo <input> al escribir (IME-safe)
  await invoke('saveCourse', { name: 'Arquitectura de Computadores', code: 'INF-245', term: '2026-1', section: '1' });
  await evaluate('window.coursesManager.navigateToHome()');
  await waitFor('Boolean(document.getElementById("search-courses-input"))');
  assert.equal(await evaluate(`(() => {
    const input = document.getElementById('search-courses-input');
    input.value = 'Arqui';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return document.getElementById('search-courses-input') === input;
  })()`), true);
  await evaluate(`window.coursesManager.startProjectCreation('unassigned')`);
  assert.equal(await evaluate('document.getElementById("btn-next-step").disabled'), true);
  // H5P-36: el campo de instrucciones ya no reside en Paso 1 (#panel-upload)
  assert.equal(await evaluate('document.querySelector("#panel-upload #upload-prompt-input")'), null);
  // H5P-35 (BUG-18): vista previa parcial a 512 KiB y exclusión de archivos rechazados en el visor
  await evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['A'.repeat(600 * 1024)], 'extenso.txt', { type: 'text/plain' }));
    transfer.items.add(new File(['bin'], 'rechazado.exe', { type: 'application/octet-stream' }));
    const input = document.getElementById('upload-file-input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-action="preview"]').click();
  })()`);
  await waitFor('Boolean(document.querySelector(".preview-text-notice"))');
  assert.equal(await evaluate('document.getElementById("preview-counter").textContent'), '1 / 1');
  assert.equal(await evaluate('document.querySelector(".preview-text-content code").textContent.length <= 512 * 1024'), true);
  await evaluate('window.previewManager.close(); window.uploadManager.clearFiles();');
  // H5P-32 (BUG-00): visor PDF en <canvas> con PDF.js sin iframe blob:
  const pdfBytes = buildSyntheticPdfBytes();
  await evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(${JSON.stringify(pdfBytes)})], 'guia.pdf', { type: 'application/pdf' }));
    const input = document.getElementById('upload-file-input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-action="preview"]').click();
  })()`);
  await waitFor('Boolean(document.querySelector(".preview-pdf-canvas")?.width > 0) && document.getElementById("pdf-page-indicator")?.textContent?.includes("1 / 1")');
  assert.equal(await evaluate('document.querySelectorAll(".preview-iframe").length'), 0);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor('!window.previewManager.isOpen() && document.getElementById("preview-body").innerHTML === ""');
  // H5P-33 (BUG-06): iniciar un nuevo proyecto en el mismo ramo no hereda archivos ni prompt del borrador anterior.
  await evaluate(`window.coursesManager.startProjectCreation('unassigned')`);
  assert.equal(await evaluate('window.uploadManager.getAllFiles().length'), 0);
  assert.equal(await evaluate('window.uploadManager.getPrompt()'), '');
  assert.equal(await evaluate('document.getElementById("btn-next-step").disabled'), true);
  await evaluate(`(() => {
    const file = new File(['Material sintético sobre integridad.'], 'ui.txt', {type:'text/plain', lastModified: 1700000000000});
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.getElementById('upload-file-input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
    // Volver a agregar exactamente el mismo archivo informa sin duplicar avisos
    const dupTransfer = new DataTransfer();
    dupTransfer.items.add(new File(['Material sintético sobre integridad.'], 'ui.txt', {type:'text/plain', lastModified: 1700000000000}));
    input.files = dupTransfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
    input.files = dupTransfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".ui-message-text")).filter(el => el.textContent.includes("ya está en la lista")).length'), 1);
  await waitFor('!document.getElementById("btn-next-step").disabled');
  await evaluate(`document.getElementById('btn-next-step').click()`);
  await waitFor('Boolean(document.getElementById("question-count"))');
  assert.equal(await evaluate('document.activeElement.id'), 'selector-title');
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".ui-message-success .ui-message-text")).some(el => el.textContent.includes("Documento inspeccionado"))'), true);
  // Verificar de forma síncrona (sin carrera con el gestor de ventanas) que el ancho del Paso 1 y del Paso 2 coinciden
  const measureStepWidths = () => evaluate(`(() => {
    const panelUpload = document.getElementById('panel-upload');
    const panelSelector = document.getElementById('panel-selector');
    const step2Rect = document.getElementById('activity-selector-card').getBoundingClientRect();
    const step2PanelRect = panelSelector.getBoundingClientRect();
    panelSelector.classList.add('hidden');
    panelUpload.classList.remove('hidden');
    const step1Rect = panelUpload.querySelector('.upload-card-wrapper').getBoundingClientRect();
    const step1PanelRect = panelUpload.getBoundingClientRect();
    panelUpload.classList.add('hidden');
    panelSelector.classList.remove('hidden');
    return {
      innerWidth: window.innerWidth,
      step1: step1Rect.width,
      step2: step2Rect.width,
      panel1: step1PanelRect.width,
      panel2: step2PanelRect.width
    };
  })()`);
  const widthsInitial = await measureStepWidths();
  assert.ok(Math.abs(widthsInitial.step1 - widthsInitial.step2) <= 1, `Ancho Paso 1 (${widthsInitial.step1}) != Paso 2 (${widthsInitial.step2}) en ancho ${widthsInitial.innerWidth}`);
  assert.ok(Math.abs(widthsInitial.step2 - widthsInitial.panel2) <= 1, `Paso 2 (${widthsInitial.step2}) no llena .step-panel (${widthsInitial.panel2})`);
  window.setSize(840, 600);
  await new Promise(resolve => setTimeout(resolve, 60));
  const widths840 = await measureStepWidths();
  assert.ok(Math.abs(widths840.step1 - widths840.step2) <= 1, `Ancho Paso 1 (${widths840.step1}) != Paso 2 (${widths840.step2}) en 840x600 (innerWidth=${widths840.innerWidth})`);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  // H5P-36 + H5P-35 (BUG-20): instrucciones con maxlength=10000 y contador en Paso 2 (#panel-selector)
  assert.equal(await evaluate('document.querySelector("#panel-selector #upload-prompt-input").maxLength'), 10000);
  await evaluate(`(() => {
    const prompt = document.getElementById('upload-prompt-input');
    prompt.value = 'Enfoca las preguntas en arquitectura.';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.match(await evaluate('document.getElementById("upload-prompt-counter").textContent'), /37 \/ 10\.000/);
  assert.equal(await evaluate('window.uploadManager.getPrompt()'), 'Enfoca las preguntas en arquitectura.');
  // Verificar alineación horizontal de Cantidad y Nombre (en ancho > 700 px) y uniformidad de cabecera en las 12 tarjetas
  const step2Alignment = await evaluate(`(() => {
    const countRect = document.getElementById('question-count').getBoundingClientRect();
    const nameRect = document.getElementById('h5p-name').getBoundingClientRect();
    const topHeights = Array.from(document.querySelectorAll('.activity-card-top')).map(el => el.getBoundingClientRect().height);
    return {
      innerWidth: window.innerWidth,
      inputTopDiff: Math.abs(countRect.top - nameRect.top),
      cardTopSpread: Math.max(...topHeights) - Math.min(...topHeights)
    };
  })()`);
  if (step2Alignment.innerWidth > 700) {
    assert.ok(step2Alignment.inputTopDiff <= 1, `Desalineación entre #question-count y #h5p-name: ${step2Alignment.inputTopDiff}px`);
  }
  assert.ok(step2Alignment.cardTopSpread <= 2, `Alturas irregulares en .activity-card-top: ${step2Alignment.cardTopSpread}px`);
  // CA-4 + H5P-16: botón Generar Evaluación deshabilitado antes de elegir formato y 12 formatos activos con filtros por categoría
  assert.equal(await evaluate('document.getElementById("btn-generate-h5p").disabled'), true);
  assert.equal(await evaluate('document.querySelectorAll(".activity-type-card").length'), 12);
  assert.equal(await evaluate('document.querySelectorAll(".activity-type-card.is-upcoming").length'), 0);
  await evaluate('document.querySelector(\'.activity-category-tab[data-category-filter="study"]\').click()');
  assert.equal(await evaluate('document.querySelectorAll(".activity-type-card:not(.hidden)").length'), 2);
  await evaluate('document.querySelector(\'.activity-category-tab[data-category-filter="practice"]\').click()');
  assert.equal(await evaluate('document.querySelectorAll(".activity-type-card:not(.hidden)").length'), 6);
  await evaluate('document.querySelector(\'.activity-category-tab[data-category-filter="evaluation"]\').click()');
  assert.equal(await evaluate('document.querySelectorAll(".activity-type-card:not(.hidden)").length'), 4);
  await evaluate('document.querySelector(\'.activity-category-tab[data-category-filter="all"]\').click()');
  assert.equal(await evaluate('document.querySelectorAll(".activity-type-card:not(.hidden)").length'), 12);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  // D1 + CA-1/CA-2: Opción Múltiple fija cantidad en 1, bloquea botones rápidos y habilita generación
  await evaluate('document.querySelector(\'.activity-type-card[data-activity-type="multichoice"]\').click()');
  assert.equal(await evaluate('document.querySelector(\'.activity-type-card[data-activity-type="multichoice"]\').classList.contains("selected")'), true);
  assert.equal(await evaluate('document.getElementById("question-count").value'), '1');
  assert.equal(await evaluate('document.getElementById("question-count").disabled'), true);
  assert.equal(await evaluate('document.querySelector(\'.btn-quick-count[data-count="3"]\').disabled'), true);
  assert.equal(await evaluate('document.getElementById("btn-generate-h5p").disabled'), false);
  assert.equal(await evaluate('window.uploadManager.getActivityType()'), 'multichoice');
  // CA-4: deseleccionar tarjeta vuelve a deshabilitar Generar Evaluación
  await evaluate('document.querySelector(\'.activity-type-card[data-activity-type="multichoice"]\').click()');
  assert.equal(await evaluate('document.getElementById("btn-generate-h5p").disabled'), true);
  assert.equal(await evaluate('window.uploadManager.getActivityType()'), null);
  // H5P-16: probar generación y guardado de un formato del catálogo ampliado (Tarjetas didácticas) con título en h5p.json
  await evaluate('document.querySelector(\'.activity-type-card[data-activity-type="flashcards"]\').click()');
  assert.equal(await evaluate('window.uploadManager.getActivityType()'), 'flashcards');
  // H5P-35 (BUG-17): verificar contraste WCAG AA (>= 4.5:1) en modo claro y oscuro en Paso 2
  const contrastCheck = await measureContrast([
    ['libRatio', '.activity-type-card.selected .activity-card-library'],
    ['descRatio', '.activity-type-card.selected .activity-card-desc', '.activity-type-card.selected']
  ]);
  assert.ok(contrastCheck.light.libRatio >= 4.5, `Contraste insuficiente en .activity-card-library (light): ${contrastCheck.light.libRatio}`);
  assert.ok(contrastCheck.light.descRatio >= 4.5, `Contraste insuficiente en .activity-card-desc seleccionada (light): ${contrastCheck.light.descRatio}`);
  assert.ok(contrastCheck.dark.libRatio >= 4.5, `Contraste insuficiente en .activity-card-library (dark): ${contrastCheck.dark.libRatio}`);
  assert.ok(contrastCheck.dark.descRatio >= 4.5, `Contraste insuficiente en .activity-card-desc seleccionada (dark): ${contrastCheck.dark.descRatio}`);
  // H5P-35 (BUG-20): aviso visible cuando el formato seleccionado queda oculto bajo otra pestaña
  await evaluate('document.querySelector(\'.activity-category-tab[data-category-filter="evaluation"]\').click()');
  assert.equal(await evaluate('document.getElementById("selected-format-hidden-notice").classList.contains("hidden")'), false);
  await evaluate('document.getElementById("btn-show-selected-format").click()');
  assert.equal(await evaluate('document.querySelector(\'.activity-category-tab[data-category-filter="study"]\').classList.contains("selected")'), true);
  await evaluate('document.querySelector(\'.activity-category-tab[data-category-filter="all"]\').click()');
  // H5P-35 (BUG-20): vaciar #question-count deshabilita botón sin disparar alert inmediato
  await evaluate(`(() => {
    const el = document.getElementById('question-count');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.equal(await evaluate('document.getElementById("btn-generate-h5p").disabled'), true);
  assert.notEqual(await evaluate('document.getElementById("generation-status").getAttribute("role")'), 'alert');
  await evaluate('document.querySelector(\'.btn-quick-count[data-count="3"]\').click()');
  await evaluate('document.getElementById("h5p-name").value = "Tarjetas INF-421"');
  await evaluate('document.getElementById("btn-generate-h5p").click()');
  await waitFor('!document.getElementById("btn-save-h5p").classList.contains("hidden")');
  dialogMode = 'ok';
  await evaluate('document.getElementById("btn-save-h5p").click()');
  await waitFor('document.getElementById("generation-status").textContent.includes("guardado y añadido")');
  // H5P-22: botón directo "Ver en carpeta" en Paso 2 localiza el archivo recién guardado y se oculta al cambiar formato
  assert.equal(await evaluate('document.getElementById("btn-reveal-saved-h5p").classList.contains("hidden")'), false);
  const revealsBeforeDirect = revealedFiles.length;
  await evaluate('document.getElementById("btn-reveal-saved-h5p").click()');
  await waitFor(`true`);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(revealedFiles.length, revealsBeforeDirect + 1);
  assert.equal(revealedFiles[revealedFiles.length - 1], path.join(directory, 'output.h5p'));
  const savedAfterUi = await invoke('getProjects', 'unassigned');
  assert.equal(savedAfterUi.length, 1);
  assert.deepEqual(savedAfterUi[0].sourceFiles, [{ name: 'ui.txt' }]);
  assert.equal(savedAfterUi[0].fileExists, true);
  const flashcardsZip = await JSZip.loadAsync(fs.readFileSync(path.join(directory, 'output.h5p')));
  const flashcardsMeta = JSON.parse(await flashcardsZip.file('h5p.json').async('string'));
  const flashcardsContent = JSON.parse(await flashcardsZip.file('content/content.json').async('string'));
  assert.equal(flashcardsMeta.mainLibrary, 'H5P.Flashcards');
  assert.equal(flashcardsMeta.title, 'Tarjetas INF-421');
  assert.equal(flashcardsContent.cards.length, 3);
  assert.equal(fs.readdirSync(directory).some(name => name.startsWith('.h5p-work-')), false);
  // CA-1/CA-2/CA-3: Cuestionario habilita botones rápidos 3/5/10 y selector 1..20
  const flashcardsPlaceholder = await evaluate('document.getElementById("upload-prompt-input").placeholder');
  await evaluate('document.querySelector(\'.activity-type-card[data-activity-type="questionset"]\').click()');
  const questionsetPlaceholder = await evaluate('document.getElementById("upload-prompt-input").placeholder');
  assert.notEqual(flashcardsPlaceholder, questionsetPlaceholder);
  assert.equal(await evaluate('document.getElementById("btn-reveal-saved-h5p").classList.contains("hidden")'), true);
  assert.equal(await evaluate('document.querySelector(\'.activity-type-card[data-activity-type="questionset"]\').classList.contains("selected")'), true);
  assert.equal(await evaluate('document.getElementById("question-count").disabled'), false);
  await evaluate('document.querySelector(\'.btn-quick-count[data-count="3"]\').click()');
  assert.equal(await evaluate('document.getElementById("question-count").value'), '3');
  assert.equal(await evaluate('window.uploadManager.getQuestionCount()'), 3);
  await evaluate('document.getElementById("question-count").focus()');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await waitFor('document.activeElement.id === "h5p-name"');
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await waitFor('document.activeElement.id === "upload-prompt-input"');
  // Cancelar antes de enviar la solicitud no llama a Gemini.
  const callsBeforeEarlyCancel = fetchCalls;
  let resolveKeyStatus;
  keyStatusGate = new Promise(resolve => { resolveKeyStatus = resolve; });
  await evaluate('document.getElementById("btn-generate-h5p").click()');
  await waitFor('document.getElementById("generation-progress-step").textContent.includes("Comprobando")');
  await evaluate('document.getElementById("btn-cancel-generation").click()');
  await waitFor('document.getElementById("generation-status").textContent.includes("cancelada")');
  resolveKeyStatus();
  keyStatusGate = null;
  await invoke('getApiKeyStatus');
  assert.equal(fetchCalls, callsBeforeEarlyCancel);
  assert.equal(await evaluate('document.getElementById("btn-generate-h5p").disabled'), false);

  // H5P-27: notificaciones nativas solo en segundo plano, respetando soporte del SO y preferencia del usuario, sin duplicar banners ni filtrar datos sensibles
  nativeNotifications.length = 0;
  simulatedFocused = false;
  notificationsSupported = true;
  networkMode = 'offline';
  await evaluate('document.getElementById("question-count").value = 1; document.getElementById("btn-generate-h5p").click()');
  await waitFor('document.getElementById("generation-status").getAttribute("role") === "alert"');
  assert.equal(await evaluate('document.getElementById("generation-status").getAttribute("aria-live")'), 'assertive');
  assert.equal(await evaluate('document.getElementById("generation-status").dataset.state'), 'error');
  assert.deepEqual(nativeNotifications.map(item => item.body), ['No se pudo completar la generación H5P.']);
  const errorStatusContrast = await measureContrast([['status', '#generation-status']]);
  assert.ok(errorStatusContrast.light.status >= 4.5, `Contraste insuficiente en #generation-status error (light): ${errorStatusContrast.light.status}`);
  assert.ok(errorStatusContrast.dark.status >= 4.5, `Contraste insuficiente en #generation-status error (dark): ${errorStatusContrast.dark.status}`);
  // H5P-33 (BUG-08) + H5P-36 + H5P-27: durante la generación no se duplica progreso en #generation-status; cancelar no dispara aviso nativo y usa role="status".
  networkMode = 'slow';
  await evaluate('document.getElementById("btn-generate-h5p").click()');
  await waitFor('!document.getElementById("generation-progress").classList.contains("hidden") && Boolean(document.getElementById("btn-cancel-generation"))');
  assert.equal(await evaluate('document.getElementById("generation-progress").getAttribute("role")'), 'status');
  assert.equal(await evaluate('document.getElementById("generation-status").textContent'), '');
  assert.equal(await evaluate('document.getElementById("upload-prompt-input").disabled'), true);
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal(await evaluate('document.getElementById("generation-progress-step").textContent'), 'Generando y preparando la actividad H5P…');
  rejectCancellation = true;
  await evaluate('document.getElementById("btn-cancel-generation").click()');
  await waitFor('document.getElementById("generation-progress-step").textContent.includes("No se pudo solicitar")');
  assert.equal(await evaluate('document.getElementById("btn-cancel-generation").disabled'), false);
  await evaluate('document.getElementById("btn-cancel-generation").click()');
  await waitFor('document.getElementById("generation-status").textContent.includes("cancelada")');
  assert.equal(await evaluate('document.getElementById("generation-status").getAttribute("role")'), 'status');
  assert.equal(await evaluate('document.getElementById("generation-status").getAttribute("aria-live")'), 'polite');
  assert.equal(await evaluate('document.getElementById("upload-prompt-input").disabled'), false);
  assert.equal(nativeNotifications.length, 1);
  networkMode = 'ok';
  await evaluate('document.getElementById("btn-generate-h5p").click()');
  await waitFor('!document.getElementById("btn-save-h5p").classList.contains("hidden")');
  assert.equal(await evaluate('document.getElementById("generation-status").dataset.state'), 'success');
  assert.equal(nativeNotifications.length, 2);
  assert.equal(nativeNotifications[1].body, 'Actividad H5P lista para guardar.');
  const successStatusContrast = await measureContrast([['status', '#generation-status']]);
  assert.ok(successStatusContrast.light.status >= 4.5, `Contraste insuficiente en #generation-status success (light): ${successStatusContrast.light.status}`);
  assert.ok(successStatusContrast.dark.status >= 4.5, `Contraste insuficiente en #generation-status success (dark): ${successStatusContrast.dark.status}`);
  // H5P-36: editar instrucciones tras generar invalida el paquete pendiente y oculta #btn-save-h5p
  await evaluate(`(() => {
    const prompt = document.getElementById('upload-prompt-input');
    prompt.value = 'Enfoca las preguntas en casos prácticos.';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.equal(await evaluate('document.getElementById("btn-save-h5p").classList.contains("hidden")'), true);
  assert.equal(await evaluate('document.getElementById("btn-reveal-saved-h5p").classList.contains("hidden")'), true);
  // H5P-27 CA-5: desactivar notificaciones del sistema desde Opciones silencia avisos nativos pero conserva avisos visibles en la UI
  await evaluate('window.configManager.openSettingsModal()');
  await waitFor('Boolean(document.querySelector(\'input[name="system-notifications"][value="disabled"]\'))');
  await evaluate('document.querySelector(\'input[name="system-notifications"][value="disabled"]\').click()');
  await waitFor('document.getElementById("notifications-preference-status").textContent.includes("desactivadas")');
  assert.deepEqual(await invoke('getNotificationSettings'), { enabled: false, supported: true });
  await evaluate('document.getElementById("btn-close-settings-modal").click()');
  await evaluate('document.getElementById("btn-generate-h5p").click()');
  await waitFor('!document.getElementById("btn-save-h5p").classList.contains("hidden")');
  assert.match(await evaluate('document.getElementById("generation-status").textContent'), /Comprueba las respuestas y explicaciones/);
  assert.equal(await evaluate('document.activeElement.id'), 'btn-save-h5p');
  assert.equal(nativeNotifications.length, 2);
  // Reactivar preferencia en Opciones y probar guardado cancelado (sin aviso nativo) vs guardado exitoso (con aviso nativo sin secretos)
  await evaluate('window.configManager.openSettingsModal()');
  await waitFor('Boolean(document.querySelector(\'input[name="system-notifications"][value="enabled"]\'))');
  await evaluate('document.querySelector(\'input[name="system-notifications"][value="enabled"]\').click()');
  await waitFor('document.getElementById("notifications-preference-status").textContent.includes("activadas")');
  await evaluate('document.getElementById("btn-close-settings-modal").click()');
  dialogMode = 'cancel';
  await evaluate('document.getElementById("btn-save-h5p").click()');
  await waitFor('document.getElementById("generation-status").textContent.includes("cancelado")');
  assert.equal(nativeNotifications.length, 2);
  dialogMode = 'ok';
  await evaluate('document.getElementById("btn-save-h5p").click()');
  await waitFor('document.getElementById("generation-status").textContent.includes("guardado y añadido")');
  assert.equal(nativeNotifications.length, 3);
  assert.equal(nativeNotifications[2].body, 'Archivo H5P guardado.');
  assert.doesNotMatch(JSON.stringify(nativeNotifications), /synthetic-test-key|integridad|output\.h5p|ui\.txt|Tarjetas/i);
  // H5P-27 CA-5: simular SO sin soporte de notificaciones nativas -> Opciones informa estado y bloquea radios
  notificationsSupported = false;
  await evaluate('window.configManager.openSettingsModal()');
  await waitFor('document.querySelector(\'input[name="system-notifications"][value="enabled"]\')?.disabled === true');
  assert.match(await evaluate('document.getElementById("notifications-preference-desc").textContent'), /no están disponibles/i);
  await evaluate('document.getElementById("btn-close-settings-modal").click()');
  notificationsSupported = true;
  simulatedFocused = true;
  // H5P-36: reanudar borrador con prompt guardado restaura las instrucciones al entrar al Paso 2, e iniciar nuevo proyecto las aísla
  const draftWithPrompt = await evaluate(`window.coursesManager.saveDraft({
    courseId: 'unassigned',
    courseName: 'Proyecto sin ramo',
    prompt: 'Instrucciones restauradas desde borrador',
    activityType: 'questionset',
    questionCount: 3,
    files: [{ name: 'ui.txt', size: 36, lastModified: Date.now() }]
  })`);
  await evaluate(`window.coursesManager.startProjectCreation('unassigned', ${JSON.stringify(draftWithPrompt)})`);
  assert.match(await evaluate('document.getElementById("draft-resume-files").textContent'), /Paso 2/);
  assert.equal(await evaluate('window.uploadManager.getPrompt()'), 'Instrucciones restauradas desde borrador');
  await evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Material sintético sobre integridad.'], 'ui.txt', {type:'text/plain'}));
    const input = document.getElementById('upload-file-input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor('document.getElementById("draft-save-status").textContent.includes("Borrador guardado")');
  assert.ok((await invoke('getDrafts')).some(draft => draft.id === draftWithPrompt.id && draft.files.length === 1));
  await evaluate('document.getElementById("btn-next-step").click()');
  await waitFor('!document.getElementById("panel-selector").classList.contains("hidden") && Boolean(document.getElementById("upload-prompt-input"))');
  assert.equal(await evaluate('document.getElementById("upload-prompt-input").value'), 'Instrucciones restauradas desde borrador');
  assert.match(await evaluate('document.getElementById("upload-prompt-counter").textContent'), /40 \/ 10\.000/);
  const saveProject = storage.saveProject;
  storage.saveProject = () => { throw new Error('private project error'); };
  await evaluate('document.getElementById("h5p-name").value = "private-activity"; document.getElementById("btn-generate-h5p").click()');
  await waitFor('!document.getElementById("btn-save-h5p").classList.contains("hidden")');
  dialogMode = 'ok';
  await evaluate('document.getElementById("btn-save-h5p").click()');
  await waitFor('document.getElementById("generation-status").dataset.state === "warning"');
  const warning = await evaluate('document.getElementById("generation-status").textContent');
  assert.match(warning, /guardado.*Aviso/);
  assert.doesNotMatch(warning, /private|output/);
  assert.ok(fs.existsSync(path.join(directory, 'output.h5p')));
  for (const [theme, ratios] of Object.entries(await measureContrast([['warning', '#generation-status']]))) {
    assert.ok(ratios.warning >= 4.5, `Contraste de advertencia (${theme}): ${ratios.warning}`);
  }
  storage.saveProject = saveProject;

  let resolveSaveDialog;
  saveDialogGate = new Promise(resolve => { resolveSaveDialog = resolve; });
  await evaluate('document.getElementById("btn-save-h5p").click()');
  await waitFor('document.getElementById("generation-status").dataset.state === "progress"');
  const nextDraft = await evaluate(`window.coursesManager.saveDraft({
    courseId: 'unassigned', prompt: 'Nuevo borrador', files: []
  })`);
  await evaluate(`window.coursesManager.startProjectCreation('unassigned', ${JSON.stringify(nextDraft)});
    document.getElementById('btn-trigger-upload').focus();
    window.h5pTestFocus = document.activeElement;
    true;`);
  resolveSaveDialog({ filePath: path.join(directory, 'output.h5p') });
  saveDialogGate = null;
  await waitFor('Array.from(document.querySelectorAll(".ui-message-text")).some(el => el.textContent.includes("guardado y añadido"))');
  assert.ok((await invoke('getDrafts')).some(draft => draft.id === nextDraft.id));
  assert.equal(await evaluate('document.activeElement === window.h5pTestFocus'), true);
  assert.equal(await evaluate('window.uploadManager.getPrompt()'), 'Nuevo borrador');
  assert.ok(fs.existsSync(path.join(directory, 'output.h5p')));
  await evaluate(`window.coursesManager.startProjectCreation('unassigned')`);
  assert.equal(await evaluate('window.uploadManager.getAllFiles().length'), 0);
  assert.equal(await evaluate('window.uploadManager.getPrompt()'), '');
  await evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([], 'private-empty.txt'));
    const input = document.getElementById('upload-file-input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('btn-next-step').click();
  })()`);
  await waitFor('document.getElementById("upload-summary-info").getAttribute("role") === "alert"');
  const inspectionError = await evaluate('document.getElementById("upload-summary-info").textContent');
  assert.match(inspectionError, /documento 1/);
  assert.doesNotMatch(inspectionError, /private-empty/);
  // H5P-22: tarjeta de proyecto muestra material fuente, "Ver en carpeta" localiza el archivo y comunica su ausencia posterior
  await evaluate(`window.coursesManager.navigateToCourseDetail('unassigned')`);
  await waitFor('Boolean(document.querySelector(".project-card .btn-reveal-project"))');
  assert.match(await evaluate('document.querySelector(".project-sources-info")?.textContent || ""'), /1 documento base/);
  assert.equal(await evaluate('document.querySelector(".project-sources-info")?.getAttribute("title")'), 'ui.txt');
  assert.equal(await evaluate('document.querySelectorAll(".project-missing-notice").length'), 0);
  const revealsBeforeCard = revealedFiles.length;
  await evaluate('document.querySelector(".project-card .btn-reveal-project").click()');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(revealedFiles.length, revealsBeforeCard + 1);
  // Eliminar el archivo en disco y verificar detección reactiva, aviso accesible, foco y contraste WCAG AA
  fs.unlinkSync(path.join(directory, 'output.h5p'));
  await evaluate('document.querySelector(".project-card .btn-reveal-project").click()');
  await waitFor('Boolean(document.querySelector(".project-card.is-file-missing .project-missing-notice"))');
  assert.equal(revealedFiles.length, revealsBeforeCard + 1);
  assert.equal(await evaluate('document.activeElement?.classList.contains("btn-reveal-project")'), true);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  const missingContrast = await measureContrast([['notice', '.project-missing-notice']]);
  assert.ok(missingContrast.light.notice >= 4.5, `Contraste insuficiente en .project-missing-notice (light): ${missingContrast.light.notice}`);
  assert.ok(missingContrast.dark.notice >= 4.5, `Contraste insuficiente en .project-missing-notice (dark): ${missingContrast.dark.notice}`);
  await evaluate('window.coursesManager.navigateToHome()');
  await evaluate('document.getElementById("btn-library-create-course").click()');
  await evaluate('document.getElementById("input-course-name").value = "Ramo sintético"; document.getElementById("btn-save-course").click()');
  await waitFor('Array.from(document.querySelectorAll(".ui-message-text")).some(el => el.textContent === "Ramo creado.")');
  const testCourse = (await invoke('getCourses')).find(course => course.name === 'Ramo sintético');
  assert.ok(testCourse);
  await evaluate(`window.coursesManager.navigateToCourseDetail(${JSON.stringify(testCourse.id)})`);
  await evaluate('document.getElementById("btn-detail-edit-course").click()');
  await evaluate('document.getElementById("input-course-name").value = "Ramo actualizado sintético"; document.getElementById("btn-save-course").click()');
  await waitFor('Array.from(document.querySelectorAll(".ui-message-text")).some(el => el.textContent === "Ramo actualizado.")');

  await evaluate('window.configManager.openSettingsModal()');
  const press = (keyCode, modifiers = []) => {
    for (const type of ['keyDown', 'keyUp']) window.webContents.sendInputEvent({ type, keyCode, modifiers });
  };
  await evaluate("document.querySelectorAll('.ui-message-close').forEach(btn => btn.click())");
  await waitFor('!document.querySelector(".ui-message")');
  await evaluate(`window.uiMessage('Aviso de prueba en opciones', 'error');
    document.getElementById('btn-close-settings-modal-footer').focus();`);
  press('Tab');
  await waitFor('document.activeElement.closest("[aria-modal=true]") && document.activeElement.matches(".ui-message-close")');
  await evaluate(`for (const message of ['Segundo aviso', 'Tercer aviso', 'Cuarto aviso']) window.uiMessage(message);`);
  assert.equal(await evaluate('document.querySelectorAll(".ui-message").length'), 3);
  assert.match(await evaluate('document.activeElement.parentElement.textContent'), /Aviso de prueba/);
  assert.equal(await evaluate(`(() => {
    const dialog = document.querySelector('#modal-settings [aria-modal=true]');
    const footer = dialog.querySelector('footer').getBoundingClientRect();
    const messages = dialog.querySelector('.ui-message-region').getBoundingClientRect();
    return footer.bottom <= messages.top && messages.bottom <= innerHeight;
  })()`), true);
  press('Tab', ['shift']);
  await waitFor('document.activeElement.id === "btn-close-settings-modal-footer"');
  press('Tab');
  await waitFor('document.activeElement.matches(".ui-message-close")');
  press('Enter');
  await waitFor('!Array.from(document.querySelectorAll(".ui-message-text")).some(el => el.textContent === "Aviso de prueba en opciones")');
  assert.equal(await evaluate('Boolean(document.activeElement.closest("#modal-settings"))'), true);

  dialogMode = 'cancel';
  await evaluate('document.getElementById("btn-export-backup").click()');
  await waitFor('document.getElementById("backup-operation-status").textContent.includes("cancelada")');
  dialogMode = 'ok';
  await evaluate('document.getElementById("btn-export-backup").click()');
  await waitFor('document.getElementById("backup-operation-status").textContent.includes("Copia creada")');
  assert.doesNotMatch(await evaluate('document.getElementById("backup-operation-status").textContent'), /private-backup/);
  assert.ok(fs.existsSync(backupPath));
  cancelBackupSelection = true;
  await evaluate('document.getElementById("btn-preview-backup").click()');
  await waitFor('document.getElementById("backup-operation-status").textContent.includes("Selección de copia cancelada")');
  cancelBackupSelection = false;
  await evaluate('document.getElementById("btn-preview-backup").click()');
  await waitFor('document.activeElement.id === "btn-merge-backup"');
  await evaluate('document.getElementById("btn-merge-backup").click()');
  await waitFor('document.getElementById("modal-settings").classList.contains("hidden") && Array.from(document.querySelectorAll(".ui-message-success")).some(el => el.textContent.includes("Copia restaurada"))');

  assertNoListeners();
  console.log('PASS: paquete Linux, aislamiento, preload/IPC, workers, prompt vacío, errores de red/lectura/escritura, cancelación, guardado, registro, permisos por ventana y ausencia de puertos TCP de escucha. Interfaz a 840 × 600 y foco por teclado comprobados. Gemini y diálogo simulados.');
  app.exit(0);
}
