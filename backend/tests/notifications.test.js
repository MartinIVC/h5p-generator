const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

function mainWithMocks({ focused = false, supported = true, writeFails = false, notificationFails = false, backupContents = '{"sample":"private document text"}', notificationsEnabled = true, minimized = false, generate = null, savePath = '/tmp/actividad.h5p' } = {}) {
  const handlers = new Map();
  const notifications = [];
  const notificationInstances = [];
  const windowActions = [];
  const filename = path.join(__dirname, '../../frontend/index.js');
  const frame = { url: pathToFileURL(path.join(path.dirname(filename), 'index.html')).href };
  const sender = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false });
  let isFocused = focused;
  let isSupported = supported;
  let enabledPref = notificationsEnabled;
  const window = {
    webContents: sender,
    isDestroyed: () => false,
    isFocused: () => isFocused,
    isMinimized: () => minimized,
    isVisible: () => true,
    restore: () => { windowActions.push('restore'); },
    show: () => { windowActions.push('show'); },
    focus: () => { windowActions.push('focus'); }
  };
  const trustedEvent = { sender, senderFrame: frame };
  const electron = {
    app: {
      commandLine: { appendSwitch() {} }, setName() {}, on() {},
      getPath: () => '/tmp', whenReady: () => new Promise(() => {})
    },
    BrowserWindow: { fromWebContents: candidate => candidate === sender ? window : null },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    shell: {},
    Notification: class extends EventEmitter {
      static isSupported() { return isSupported; }
      constructor(options) { super(); this.options = options; }
      show() {
        if (notificationFails) throw new Error('private notification error');
        notifications.push(this.options);
        notificationInstances.push(this);
      }
    },
    dialog: {
      showSaveDialog: async (_win, options) => ({
        canceled: false,
        filePath: options?.defaultPath?.endsWith('.h5p') ? savePath : '/tmp/backup.json'
      }),
      showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/backup.json'] })
    }
  };
  const storage = {
    createBackupPayload: () => ({ sample: 'private document text' }),
    inspectBackupPayload: () => ({ counts: { courses: 0 } }),
    restoreBackupPayload: () => ({ counts: { courses: 0 } }),
    getApiKey: () => 'AIza-clave-secreta',
    getCourseById: () => ({ id: 'curso' }),
    saveProject: project => ({ id: 'proj-1', ...project }),
    getSystemNotificationsEnabled: () => enabledPref,
    setSystemNotificationsEnabled: (value) => {
      if (typeof value !== 'boolean') throw new Error('invalid');
      enabledPref = value;
      return enabledPref;
    }
  };
  const realH5PGeneration = require('../../frontend/ipc/h5pGeneration');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, __dirname: path.dirname(filename), process, Buffer, AbortSignal, console,
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === 'node:fs') return {
        writeFileSync() { if (writeFails) throw new Error('/tmp/backup.json: private write failure'); },
        renameSync() {},
        rmSync() {},
        statSync: () => ({ size: 30 }),
        readFileSync: () => backupContents
      };
      if (name.endsWith('backend/storage.js')) return { academicStorage: storage };
      if (generate && name.endsWith(path.join('ipc', 'h5pGeneration.js'))) {
        return {
          createH5PGeneration: opts => realH5PGeneration.createH5PGeneration({ ...opts, generate })
        };
      }
      return require(name);
    }
  }, { filename });
  module.exports.registerIpcHandlers();
  return {
    handlers,
    notifications,
    notificationInstances,
    windowActions,
    trustedEvent,
    sender,
    setFocused: value => { isFocused = value; },
    setSupported: value => { isSupported = value; }
  };
}

describe('Avisos nativos de operaciones completadas', () => {
  it('muestra un texto fijo al terminar una copia con la ventana en segundo plano', async () => {
    const { handlers, notifications, trustedEvent } = mainWithMocks();
    await handlers.get('academic:exportBackup')(trustedEvent);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].body, 'Copia de seguridad creada.');
    assert.ok(!JSON.stringify(notifications).includes('private document text'));
    assert.ok(!JSON.stringify(notifications).includes('/tmp/backup.json'));
  });

  it('devuelve el resultado sin aviso nativo cuando la ventana está activa o el sistema no lo soporta', async () => {
    for (const options of [{ focused: true }, { supported: false }]) {
      const { handlers, notifications, trustedEvent } = mainWithMocks(options);
      const result = await handlers.get('academic:exportBackup')(trustedEvent);
      assert.equal(result.canceled, false);
      assert.equal(notifications.length, 0);
    }
  });

  it('no notifica una operación que falla', async () => {
    const { handlers, notifications, trustedEvent } = mainWithMocks({ writeFails: true });
    await assert.rejects(handlers.get('academic:exportBackup')(trustedEvent), { message: 'No se pudo crear la copia de seguridad.' });
    assert.equal(notifications.length, 0);
  });

  it('notifica una restauración completada sin incluir datos de la copia y aisla por ventana', async () => {
    const { handlers, notifications, trustedEvent, sender } = mainWithMocks();
    const preview = await handlers.get('academic:previewBackup')(trustedEvent);
    await assert.rejects(
      handlers.get('academic:restoreBackup')({ sender: {} }, { backupId: preview.backupId, strategy: 'merge' }),
      /ventana de la aplicación/
    );
    await handlers.get('academic:restoreBackup')(trustedEvent, { backupId: preview.backupId, strategy: 'merge' });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].body, 'Copia de seguridad restaurada.');
    assert.ok(!JSON.stringify(notifications).includes('private document text'));

    // Una nueva vista previa se descarta al navegar fuera del documento principal.
    const preview2 = await handlers.get('academic:previewBackup')(trustedEvent);
    sender.emit('did-start-navigation', {}, 'https://example.com', false, true);
    await assert.rejects(
      handlers.get('academic:restoreBackup')(trustedEvent, { backupId: preview2.backupId, strategy: 'merge' }),
      /revisarse antes/
    );
  });

  it('limpia los listeners de copia al restaurar, navegar o destruir la ventana', async () => {
    const { handlers, trustedEvent, sender } = mainWithMocks();
    const preview = () => handlers.get('academic:previewBackup')(trustedEvent);
    const listeners = () => ['destroyed', 'did-start-navigation'].map(event => sender.listenerCount(event));
    for (let i = 0; i < 3; i++) {
      await preview();
      const { backupId } = await preview();
      assert.deepEqual(listeners(), [1, 1]);
      await handlers.get('academic:restoreBackup')(trustedEvent, { backupId, strategy: 'merge' });
      assert.deepEqual(listeners(), [0, 0]);
    }
    await preview();
    sender.emit('did-start-navigation', {}, '#main-content', true, true);
    assert.deepEqual(listeners(), [1, 1]);
    sender.emit('did-start-navigation', {}, 'about:blank', false, true);
    assert.deepEqual(listeners(), [0, 0]);
    await preview();
    sender.emit('destroyed');
    assert.deepEqual(listeners(), [0, 0]);
  });

  it('entrega el resumen sin ruta aunque falle el notificador y usa un error fijo para JSON inválido', async () => {
    const { handlers, trustedEvent, notifications } = mainWithMocks({
      notificationFails: true, backupContents: 'private invalid JSON'
    });
    const result = await handlers.get('academic:exportBackup')(trustedEvent);
    assert.equal(result.canceled, false);
    assert.equal(result.summary.counts.courses, 0);
    assert.equal(Object.hasOwn(result, 'filePath'), false);
    assert.equal(notifications.length, 0);
    await assert.rejects(handlers.get('academic:previewBackup')(trustedEvent), {
      message: 'No se pudo leer la copia de seguridad.'
    });
  });

  it('H5P-27: respeta preferencia del usuario, valida canales IPC de notificaciones y restaura foco al hacer clic', async () => {
    const { handlers, notifications, notificationInstances, windowActions, trustedEvent, setSupported } = mainWithMocks({ minimized: true });
    assert.deepEqual({ ...(await handlers.get('academic:getNotificationSettings')(trustedEvent)) }, { enabled: true, supported: true });

    await handlers.get('academic:exportBackup')(trustedEvent);
    assert.equal(notifications.length, 1);
    notificationInstances[0].emit('click');
    assert.deepEqual(windowActions, ['restore', 'focus']);

    // Rechaza emisores no confiables y argumentos inválidos o propiedades extra
    await assert.rejects(handlers.get('academic:setNotificationSettings')({ sender: {} }, { enabled: false }), /ventana de la aplicación/);
    await assert.rejects(handlers.get('academic:setNotificationSettings')(trustedEvent, { enabled: 'no' }), /no es válida/);
    await assert.rejects(handlers.get('academic:setNotificationSettings')(trustedEvent, { enabled: false, extra: 1 }), /no es válida/);

    // Desactivar preferencia suprime notificaciones nativas aun con ventana en segundo plano y SO compatible
    assert.deepEqual({ ...(await handlers.get('academic:setNotificationSettings')(trustedEvent, { enabled: false })) }, { enabled: false, supported: true });
    await handlers.get('academic:exportBackup')(trustedEvent);
    assert.equal(notifications.length, 1);

    // Reactivar preferencia y reflejar soporte del SO
    assert.deepEqual({ ...(await handlers.get('academic:setNotificationSettings')(trustedEvent, { enabled: true })) }, { enabled: true, supported: true });
    await handlers.get('academic:exportBackup')(trustedEvent);
    assert.equal(notifications.length, 2);

    setSupported(false);
    assert.deepEqual({ ...(await handlers.get('academic:getNotificationSettings')(trustedEvent)) }, { enabled: true, supported: false });
    await handlers.get('academic:exportBackup')(trustedEvent);
    assert.equal(notifications.length, 2);
  });

  it('H5P-27: el proceso principal conecta h5p:generate y h5p:save-file a notifyWhenInBackground respetando foco y preferencia', async t => {
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-main-notify-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const savePath = path.join(dir, 'evaluacion-privada.h5p');
    let shouldFail = false;
    const sampleQuestions = [{
      pregunta: '¿Qué protege la integridad?',
      opciones: ['Exactitud', 'Color', 'Peso', 'Ruido'],
      respuestaCorrecta: 'Exactitud',
      retroalimentacion: 'Protege la exactitud de la información.'
    }];
    const { handlers, notifications, trustedEvent, setFocused } = mainWithMocks({
      focused: false,
      supported: true,
      savePath,
      generate: async () => {
        if (shouldFail) throw new Error('NETWORK_ERROR');
        return sampleQuestions;
      }
    });

    const inspected = await handlers.get('h5p:inspect-document')(trustedEvent, {
      name: 'apunte-confidencial.txt',
      bytes: new Uint8Array(Buffer.from('Texto confidencial del apunte'))
    });
    assert.equal(inspected.status, 'ok');
    const req = {
      documentIds: [inspected.documentId],
      activityType: 'questionset',
      questionCount: 1,
      instructions: 'Instrucción privada'
    };

    // En segundo plano: error remoto y éxito generan avisos nativos sin datos sensibles
    shouldFail = true;
    assert.equal((await handlers.get('h5p:generate')(trustedEvent, req)).code, 'NETWORK_ERROR');
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].body, 'No se pudo completar la generación H5P.');

    shouldFail = false;
    const generated = await handlers.get('h5p:generate')(trustedEvent, req);
    assert.equal(generated.status, 'ok');
    assert.equal(notifications.length, 2);
    assert.equal(notifications[1].body, 'Actividad H5P lista para guardar.');

    const saved = await handlers.get('h5p:save-file')(trustedEvent, {
      packageId: generated.packageId,
      suggestedName: 'evaluacion-privada'
    });
    assert.equal(saved.status, 'ok');
    assert.equal(notifications.length, 3);
    assert.equal(notifications[2].body, 'Archivo H5P guardado.');
    assert.doesNotMatch(JSON.stringify(notifications), /AIza|confidencial|privad/i);

    // Con ventana enfocada o preferencia desactivada: sin notificaciones nativas
    setFocused(true);
    const focusedGen = await handlers.get('h5p:generate')(trustedEvent, req);
    assert.equal(focusedGen.status, 'ok');
    assert.equal(notifications.length, 3);

    setFocused(false);
    await handlers.get('academic:setNotificationSettings')(trustedEvent, { enabled: false });
    const mutedGen = await handlers.get('h5p:generate')(trustedEvent, req);
    assert.equal(mutedGen.status, 'ok');
    assert.equal(notifications.length, 3);
  });

  it('H5P-27: AcademicStorage persiste la preferencia de notificaciones del sistema con valor por defecto true', () => {
    const os = require('node:os');
    const { AcademicStorage } = require('../storage');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-notif-pref-'));
    try {
      const storePath = path.join(dir, 'academic_store.json');
      const store = new AcademicStorage(storePath);
      assert.equal(store.getSystemNotificationsEnabled(), true);
      assert.equal(store.setSystemNotificationsEnabled(false), false);
      assert.equal(new AcademicStorage(storePath).getSystemNotificationsEnabled(), false);
      assert.equal(store.setSystemNotificationsEnabled(true), true);
      assert.equal(new AcademicStorage(storePath).getSystemNotificationsEnabled(), true);
      assert.throws(() => store.setSystemNotificationsEnabled('false'), /no es válida/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

it('el aviso visible evita duplicados, permite cierre accesible y distingue errores para lectores de pantalla', () => {
  function element() {
    const listeners = {};
    return {
      children: [], dataset: {}, attributes: {}, classList: { toggle() {}, add() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
      emit(name) { (listeners[name] || []).forEach(fn => fn()); },
      click() { this.emit('click'); },
      appendChild(child) { child.parent = this; this.children.push(child); },
      contains(child) { return child === this || this.children.some(item => item.contains(child)); },
      remove() { this.parent.children = this.parent.children.filter(item => item !== this); },
      get firstElementChild() { return this.children[0]; }
    };
  }
  const body = element();
  const document = { body, documentElement: element(), createElement: element };
  const scheduled = new Map();
  let nextTimer = 0;
  const window = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout(fn, delay) {
      scheduled.set(++nextTimer, { fn, delay });
      return nextTimer;
    },
    clearTimeout(id) { scheduled.delete(id); }
  };
  const filename = path.join(__dirname, '../../frontend/js/ui.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    document, window, localStorage: { getItem: () => null }
  }, { filename });

  window.uiMessage('Borrador guardado.', 'success');
  window.uiMessage('  Borrador guardado.  ', 'success');
  window.uiMessage('No se pudo guardar.', 'error');

  assert.equal(body.children.length, 1);
  const region = body.children[0];
  assert.equal(region.children.length, 2);
  assert.equal(region.children[0].attributes.role, 'status');
  assert.equal(region.children[0].attributes['aria-live'], 'polite');
  assert.equal(region.children[0].attributes['aria-atomic'], 'true');
  assert.equal(region.children[1].attributes.role, 'alert');
  assert.equal(region.children[1].attributes['aria-live'], 'assertive');
  assert.equal(region.children[1].attributes['aria-atomic'], 'true');
  assert.equal(region.attributes['aria-live'], undefined);
  assert.equal(region.children[0].children[1].attributes['aria-label'], 'Cerrar aviso');
  const first = region.children[0];
  first.emit('focusin');
  assert.deepEqual(Array.from(scheduled.keys()), [2]);
  first.emit('focusout');
  assert.ok(scheduled.get(3).delay <= 6500);
  first.children[1].click();
  assert.equal(scheduled.has(3), false);
  scheduled.get(4).fn();
  assert.equal(scheduled.has(4), false);
  assert.equal(region.children.length, 1);
  for (const message of ['Segundo', 'Tercero', 'Cuarto']) window.uiMessage(message);
  assert.equal(scheduled.has(2), false);
  assert.equal(scheduled.size, 3);
  assert.equal(region.children.length, 3);
  assert.equal(window.uiEscapeHtml(`<img "x" 'y' &>`), '&lt;img &quot;x&quot; &#39;y&#39; &amp;&gt;');
});
