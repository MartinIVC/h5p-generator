'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { registerH5PIpcHandlers, handler } = require('../../frontend/ipc/h5pHandlers');
const id = '01234567-89ab-4cde-8fab-0123456789ab';
const requests = {
  'h5p:inspect-document': { name: 'apunte.txt', bytes: new Uint8Array([1, 2]) },
  'h5p:generate': { documentIds: [id], activityType: 'multiple-choice', questionCount: 3, instructions: '' },
  'h5p:save-file': { packageId: id, suggestedName: 'actividad.h5p' }
};
function setup() {
  const handlers = new Map();
  registerH5PIpcHandlers({ handle: (channel, fn) => handlers.set(channel, fn) }, event => event.trusted, { inspect: async () => ({ status: 'ok', documentId: id }), release: async () => ({ status: 'ok' }) });
  return handlers;
}
test('preload conecta los métodos explícitos con los canales registrados', async () => {
  const handlers = setup();
  let api;
  const filename = path.join(__dirname, '../../frontend/preload.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (name, methods) => { assert.equal(name, 'academicAPI'); api = methods; } },
      ipcRenderer: { invoke: (channel, payload) => handlers.get(channel)({ trusted: true }, payload) }
    })
  }, { filename });
  for (const [method, channel] of [['inspectDocument', 'h5p:inspect-document'], ['generateH5P', 'h5p:generate'], ['saveH5PFile', 'h5p:save-file']]) {
    const result = await api[method](requests[channel]);
    assert.equal(result.status, method === 'inspectDocument' ? 'ok' : 'error');
  }
  assert.equal(typeof api.verifyApiKey, 'function');
  assert.equal(api.ipcRenderer, undefined);
});
test('rechaza emisores y argumentos inválidos antes de acceder a servicios', async () => {
  const handlers = setup();
  for (const [channel, fn] of handlers) {
    assert.equal((await fn({ trusted: false }, requests[channel])).code, 'INVALID_SENDER');
    assert.equal((await fn({ trusted: true }, null)).code, 'INVALID_ARGUMENT');
    assert.equal((await fn({ trusted: true }, { ...requests[channel], path: '/etc/passwd' })).code, 'INVALID_ARGUMENT');
  }
  const inspect = handlers.get('h5p:inspect-document');
  for (const value of [
    { name: '../secret.txt', bytes: new Uint8Array([1]) }, { name: 'a.exe', bytes: new Uint8Array([1]) },
    { name: 'a.txt', bytes: new Uint8Array() }, { name: 'a.txt', bytes: new Uint8Array(50 * 1024 * 1024 + 1) },
    { name: 'a.txt', bytes: 'privado' }
  ]) assert.equal((await inspect({ trusted: true }, value)).code, 'INVALID_ARGUMENT');
  const generate = handlers.get('h5p:generate');
  for (const value of [
    { ...requests['h5p:generate'], documentIds: [id, id] }, { ...requests['h5p:generate'], documentIds: ['ruta'] },
    { ...requests['h5p:generate'], questionCount: 0 }, { ...requests['h5p:generate'], instructions: 'x'.repeat(10001) }
  ]) assert.equal((await generate({ trusted: true }, value)).code, 'INVALID_ARGUMENT');
  assert.equal((await handlers.get('h5p:save-file')({ trusted: true }, { packageId: id, suggestedName: '../secret' })).code, 'INVALID_ARGUMENT');
});
test('captura errores sin revelar excepciones ni datos privados', async () => {
  const wrapped = handler(() => true, () => true, async () => { throw new Error('clave y documento privado'); });
  assert.deepEqual(await wrapped({}, {}), { status: 'error', code: 'INTERNAL_ERROR', message: 'No se pudo completar la operación.' });
  const badSender = handler(() => { throw new Error('secreto'); }, () => true, () => {});
  assert.equal((await badSender({}, {})).code, 'INTERNAL_ERROR');
});
test('el proceso principal valida el marco y captura errores de almacenamiento de la clave', async () => {
  const handlers = new Map();
  const mainFile = path.join(__dirname, '../../frontend/index.js');
  const frame = { url: require('node:url').pathToFileURL(path.join(path.dirname(mainFile), 'index.html')).href };
  const sender = Object.assign(new (require('node:events').EventEmitter)(), { mainFrame: frame, isDestroyed: () => false });
  const win = { webContents: sender, isDestroyed: () => false };
  const electron = {
    app: { commandLine: { appendSwitch() {} }, setName() {}, on() {}, whenReady: () => new Promise(() => {}) },
    BrowserWindow: { fromWebContents: candidate => candidate === sender ? win : null },
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) }, shell: {}, Notification: {}, dialog: {}
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(mainFile, 'utf8'), {
    module, __dirname: path.dirname(mainFile), process, Buffer, AbortSignal, console,
    require: name => {
      if (name === 'electron') return electron;
      if (name.endsWith('backend/storage.js')) return { academicStorage: { getApiKey() { throw new Error('clave privada'); } } };
      return require(name);
    }
  }, { filename: mainFile });
  module.exports.registerIpcHandlers();
  const inspect = handlers.get('h5p:inspect-document');
  const result = await inspect({ sender, senderFrame: frame }, { name: 'a.txt', bytes: new Uint8Array(Buffer.from('texto legible')) });
  assert.equal(result.status, 'ok');
  assert.equal(result.name, 'a.txt');
  assert.equal(result.text, undefined);
  assert.equal((await inspect({ sender, senderFrame: { url: frame.url } }, requests['h5p:inspect-document'])).code, 'INVALID_SENDER');
  assert.equal((await handlers.get('llm:verify-key')({ sender, senderFrame: frame }, null)).status, 'error');
  frame.url = 'https://example.com/';
  assert.equal((await inspect({ sender, senderFrame: frame }, requests['h5p:inspect-document'])).code, 'INVALID_SENDER');
  assert.equal((await handlers.get('llm:verify-key')({}, null)).status, 'error');
});
