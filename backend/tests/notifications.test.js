const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function mainWithMocks({ focused = false, supported = true, writeFails = false } = {}) {
  const handlers = new Map();
  const notifications = [];
  const window = { isDestroyed: () => false, isFocused: () => focused };
  const electron = {
    app: {
      commandLine: { appendSwitch() {} }, setName() {}, on() {},
      getPath: () => '/tmp', whenReady: () => new Promise(() => {})
    },
    BrowserWindow: { fromWebContents: () => window },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    shell: {},
    Notification: class {
      static isSupported() { return supported; }
      constructor(options) { this.options = options; }
      show() { notifications.push(this.options); }
    },
    dialog: {
      showSaveDialog: async () => ({ canceled: false, filePath: '/tmp/backup.json' }),
      showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/backup.json'] })
    }
  };
  const storage = {
    createBackupPayload: () => ({ sample: 'private document text' }),
    inspectBackupPayload: () => ({ counts: { courses: 0 } }),
    restoreBackupPayload: () => ({ counts: { courses: 0 } })
  };
  const filename = path.join(__dirname, '../../frontend/index.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, __dirname: path.dirname(filename), process, Buffer, AbortSignal, console,
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === 'node:fs') return {
        writeFileSync() { if (writeFails) throw new Error('write failed'); },
        statSync: () => ({ size: 30 }),
        readFileSync: () => '{"sample":"private document text"}'
      };
      if (name.endsWith('backend/storage.js')) return { academicStorage: storage };
      return require(name);
    }
  }, { filename });
  module.exports.registerIpcHandlers();
  return { handlers, notifications };
}

describe('Avisos nativos de operaciones completadas', () => {
  it('muestra un texto fijo al terminar una copia con la ventana en segundo plano', async () => {
    const { handlers, notifications } = mainWithMocks();
    await handlers.get('academic:exportBackup')({ sender: {} });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].body, 'Copia de seguridad creada.');
    assert.ok(!JSON.stringify(notifications).includes('private document text'));
    assert.ok(!JSON.stringify(notifications).includes('/tmp/backup.json'));
  });

  it('devuelve el resultado sin aviso nativo cuando la ventana está activa o el sistema no lo soporta', async () => {
    for (const options of [{ focused: true }, { supported: false }]) {
      const { handlers, notifications } = mainWithMocks(options);
      const result = await handlers.get('academic:exportBackup')({ sender: {} });
      assert.equal(result.canceled, false);
      assert.equal(notifications.length, 0);
    }
  });

  it('no notifica una operación que falla', async () => {
    const { handlers, notifications } = mainWithMocks({ writeFails: true });
    await assert.rejects(handlers.get('academic:exportBackup')({ sender: {} }));
    assert.equal(notifications.length, 0);
  });

  it('notifica una restauración completada sin incluir datos de la copia', async () => {
    const { handlers, notifications } = mainWithMocks();
    const preview = await handlers.get('academic:previewBackup')({ sender: {} });
    await handlers.get('academic:restoreBackup')({ sender: {} }, { backupId: preview.backupId, strategy: 'merge' });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].body, 'Copia de seguridad restaurada.');
    assert.ok(!JSON.stringify(notifications).includes('private document text'));
  });
});

it('el aviso visible evita duplicados y distingue errores para lectores de pantalla', () => {
  function element() {
    return {
      children: [], dataset: {}, attributes: {}, classList: { toggle() {}, add() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
      appendChild(child) { child.parent = this; this.children.push(child); },
      remove() { this.parent.children = this.parent.children.filter(item => item !== this); },
      get firstElementChild() { return this.children[0]; }
    };
  }
  const body = element();
  const document = { body, documentElement: element(), createElement: element };
  const window = { matchMedia: () => ({ matches: false, addEventListener() {} }), setTimeout() {} };
  const filename = path.join(__dirname, '../../frontend/js/ui.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    document, window, localStorage: { getItem: () => null }
  }, { filename });

  window.uiMessage('Borrador guardado.', 'success');
  window.uiMessage('Borrador guardado.', 'success');
  window.uiMessage('No se pudo guardar.', 'error');

  assert.equal(body.children.length, 1);
  assert.equal(body.children[0].children.length, 2);
  assert.equal(body.children[0].children[0].attributes.role, 'status');
  assert.equal(body.children[0].children[1].attributes.role, 'alert');
  assert.equal(body.children[0].attributes['aria-live'], undefined);
});
