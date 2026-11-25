const { app, BrowserWindow, ipcMain, shell, Notification, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL, URL } = require('node:url');
const { registerH5PIpcHandlers } = require(path.join(__dirname, 'ipc', 'h5pHandlers.js'));
const { createDocumentInspection } = require(path.join(__dirname, 'ipc', 'documentInspection.js'));
const { createH5PGeneration } = require(path.join(__dirname, 'ipc', 'h5pGeneration.js'));
const { verifyGeminiKey } = require(path.join(__dirname, '..', 'backend', 'gemini.js'));
// Chromium no detecta automáticamente Libsecret en sesiones Hyprland.
if (process.platform === 'linux' && (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase().split(':').includes('hyprland')) {
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}
app.setName('h5p-generator');
app.commandLine.appendSwitch('lang', 'es');
const { academicStorage } = require(path.join(__dirname, '..', 'backend', 'storage.js'));

const APP_INDEX_URL = pathToFileURL(path.join(__dirname, 'index.html')).href;

function isAppIndexUrl(url) {
  if (typeof url !== 'string') return false;
  const hashIndex = url.indexOf('#');
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  return base === APP_INDEX_URL;
}

function parseExternalHttpUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > 2048) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    backgroundColor: '#f7f7f2',
    minWidth: 840,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    const safeUrl = parseExternalHttpUrl(url);
    if (safeUrl) {
      shell.openExternal(safeUrl);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppIndexUrl(url)) {
      event.preventDefault();
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Main] Proceso renderer finalizado inesperadamente:', details?.reason || 'unknown', details?.exitCode ?? '');
  });

  win.loadFile(path.join(__dirname, 'index.html'));
};

// ========================================================
// REGISTRO DE CANALES IPC PARA GESTIÓN ACADÉMICA Y PROYECTOS
// ========================================================

let ipcRegistered = false;
const pendingBackupImports = new WeakMap();

function notifyWhenInBackground(event, body) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || win.isFocused() || !Notification.isSupported()) return;
  try {
    new Notification({ title: 'Generador H5P', body }).show();
  } catch {
    // El aviso visible dentro de la aplicación sigue disponible.
  }
}

function setPendingBackup(sender, entry) {
  if (!pendingBackupImports.has(sender) && typeof sender?.once === 'function') {
    const clear = () => {
      pendingBackupImports.delete(sender);
      sender.removeListener?.('destroyed', clear);
      sender.removeListener?.('did-start-navigation', onNavigation);
    };
    const onNavigation = (_event, _url, inPlace, isMainFrame) => {
      if (isMainFrame && !inPlace) clear();
    };
    sender.once('destroyed', clear);
    sender.on?.('did-start-navigation', onNavigation);
  }
  pendingBackupImports.set(sender, entry);
}

function registerIpcHandlers() {
  if (ipcRegistered) return;
  ipcRegistered = true;
  const inspection = createDocumentInspection();
  const generation = createH5PGeneration({ inspection, storage: academicStorage, dialog, BrowserWindow, app });
  const isTrustedSender = (event) => {
    const win = BrowserWindow.fromWebContents(event?.sender);
    const frame = event?.senderFrame;
    return Boolean(win && !win.isDestroyed() && win.webContents === event.sender &&
      frame && frame === event.sender.mainFrame &&
      isAppIndexUrl(frame.url));
  };
  const handleTrusted = (channel, operation) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event)) {
        throw new Error('La solicitud no proviene de la ventana de la aplicación.');
      }
      return operation(event, ...args);
    });
  };
  const isRegisteredProjectPath = (filePath) => {
    if (typeof filePath !== 'string' || !filePath.trim()) return false;
    try {
      const projects = academicStorage.getProjects();
      return Array.isArray(projects) && projects.some(project => typeof project?.filePath === 'string' && project.filePath === filePath);
    } catch {
      return false;
    }
  };
  registerH5PIpcHandlers(ipcMain, isTrustedSender, inspection, generation);
  // Ramos (Courses)
  handleTrusted('academic:getCourses', async () => {
    return academicStorage.getAllCourses();
  });

  handleTrusted('academic:getCourseById', async (_event, courseId) => {
    if (!isValidId(courseId)) return null;
    return academicStorage.getCourseById(courseId);
  });

  handleTrusted('academic:saveCourse', async (_event, courseData) => {
    if (!isPlainObject(courseData)) throw new Error('Los datos del ramo no son válidos.');
    return academicStorage.saveCourse(courseData);
  });

  handleTrusted('academic:setCourseOrganization', async (_event, courseId, changes) => {
    if (!isValidId(courseId) || !isPlainObject(changes)) throw new Error('Los datos de organización no son válidos.');
    return academicStorage.setCourseOrganization(courseId, changes);
  });

  handleTrusted('academic:markCourseOpened', async (_event, courseId) => {
    if (!isValidId(courseId)) return false;
    return academicStorage.markCourseOpened(courseId);
  });

  handleTrusted('academic:getDrafts', async () => {
    return academicStorage.getDrafts();
  });

  handleTrusted('academic:saveDraft', async (_event, draftData) => {
    if (!isPlainObject(draftData)) throw new Error('El borrador no es válido.');
    return academicStorage.saveDraft(draftData);
  });

  handleTrusted('academic:deleteDraft', async (_event, draftId) => {
    if (!isValidId(draftId)) return false;
    return academicStorage.deleteDraft(draftId);
  });

  function resolveDocumentsDir() {
    for (const key of ['documents', 'home']) {
      try {
        const dir = app?.getPath?.(key);
        if (typeof dir === 'string' && dir) return dir;
      } catch {}
    }
    return os.homedir();
  }

  handleTrusted('academic:exportBackup', async (event) => {
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Crear copia de seguridad',
      defaultPath: path.join(resolveDocumentsDir(), `generador-h5p-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'Copia del Generador H5P', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { canceled: true };

    const payload = academicStorage.createBackupPayload();
    const serialized = JSON.stringify(payload, null, 2);
    if (typeof fs.renameSync === 'function') {
      const tempPath = `${filePath}.tmp.${crypto.randomUUID()}`;
      try {
        fs.writeFileSync(tempPath, serialized, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
        fs.renameSync(tempPath, filePath);
      } catch (err) {
        try { fs.rmSync?.(tempPath, { force: true }); } catch {}
        throw err;
      }
    } else {
      fs.writeFileSync(filePath, serialized, { encoding: 'utf-8', mode: 0o600 });
    }
    notifyWhenInBackground(event, 'Copia de seguridad creada.');
    return {
      canceled: false,
      filePath,
      summary: academicStorage.inspectBackupPayload(payload)
    };
  });

  handleTrusted('academic:previewBackup', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Seleccionar copia de seguridad',
      properties: ['openFile'],
      filters: [{ name: 'Copia del Generador H5P', extensions: ['json'] }]
    });
    if (canceled || !filePaths[0]) return { canceled: true };

    const filePath = filePaths[0];
    const fileSize = fs.statSync(filePath).size;
    if (fileSize > 25 * 1024 * 1024) throw new Error('La copia supera el límite de 25 MB.');
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const summary = academicStorage.inspectBackupPayload(payload);
    const pending = { id: crypto.randomUUID(), payload };
    setPendingBackup(event.sender, pending);
    return { canceled: false, backupId: pending.id, ...summary };
  });

  handleTrusted('academic:restoreBackup', async (event, request = {}) => {
    if (!isPlainObject(request)) throw new Error('La solicitud de restauración no es válida.');
    const { backupId, strategy } = request;
    const pending = pendingBackupImports.get(event.sender);
    if (!pending || typeof backupId !== 'string' || backupId !== pending.id) {
      throw new Error('La copia debe seleccionarse y revisarse antes de restaurarla.');
    }
    const result = academicStorage.restoreBackupPayload(pending.payload, strategy);
    pendingBackupImports.delete(event.sender);
    notifyWhenInBackground(event, 'Copia de seguridad restaurada.');
    return result;
  });

  handleTrusted('academic:deleteCourse', async (_event, courseId) => {
    if (!isValidId(courseId)) return false;
    return academicStorage.deleteCourse(courseId);
  });
  handleTrusted('academic:getTrash', async () => academicStorage.getTrash());
  handleTrusted('academic:restoreTrashItem', async (_event, trashId) => {
    if (!isValidId(trashId)) return false;
    return academicStorage.restoreTrashItem(trashId);
  });
  handleTrusted('academic:permanentlyDeleteTrashItem', async (_event, trashId) => {
    if (!isValidId(trashId)) return false;
    return academicStorage.permanentlyDeleteTrashItem(trashId);
  });

  // Proyectos Exportados (Projects)
  handleTrusted('academic:getProjects', async (_event, courseId) => {
    if (courseId !== undefined && courseId !== null && !isValidId(courseId)) return [];
    return academicStorage.getProjects(courseId);
  });

  handleTrusted('academic:saveProject', async (_event, projectData) => {
    if (!isPlainObject(projectData)) throw new Error('Los datos del proyecto no son válidos.');
    return academicStorage.saveProject(projectData);
  });

  handleTrusted('academic:assignProject', async (_event, projectId, courseId) => {
    if (!isValidId(projectId) || !isValidId(courseId)) throw new Error('Los identificadores no son válidos.');
    return academicStorage.assignProject(projectId, courseId);
  });

  handleTrusted('academic:deleteProject', async (_event, projectId) => {
    if (!isValidId(projectId)) return false;
    return academicStorage.deleteProject(projectId);
  });

  // Integración con Sistema de Archivos (nunca confía en rutas arbitrarias del renderer)
  handleTrusted('academic:revealProjectFile', async (_event, projectId) => {
    if (!isValidId(projectId)) return { status: 'not_found' };
    const project = academicStorage.getProjects().find(item => item.id === projectId);
    if (!project) return { status: 'not_found' };
    if (!project.filePath || typeof project.filePath !== 'string') return { status: 'no_path' };
    if (!academicStorage.verifyFileExists(project.filePath)) return { status: 'missing' };
    try {
      shell.showItemInFolder(project.filePath);
      return { status: 'ok' };
    } catch {
      return { status: 'error' };
    }
  });

  handleTrusted('academic:revealFile', async (_event, filePath) => {
    if (!isRegisteredProjectPath(filePath)) return false;
    try {
      shell.showItemInFolder(filePath);
      return true;
    } catch {
      return false;
    }
  });

  handleTrusted('academic:verifyFileExists', async (_event, filePath) => {
    if (!isRegisteredProjectPath(filePath)) return false;
    return academicStorage.verifyFileExists(filePath);
  });

  // Credenciales y Configuración (Gemini API Key)
  handleTrusted('academic:getApiKeyStatus', async () => {
    return academicStorage.getApiKeyStatus();
  });

  handleTrusted('academic:saveApiKey', async (_event, apiKey) => {
    if (typeof apiKey !== 'string' || apiKey.length > 1024) {
      throw new Error('La clave API no es válida.');
    }
    return academicStorage.saveApiKey(apiKey);
  });

  ipcMain.handle('llm:verify-key', async (event, candidate) => {
    if (!isTrustedSender(event)) return { status: 'error' };
    if (candidate != null && (typeof candidate !== 'string' || candidate.length > 1024)) {
      return { status: 'error' };
    }
    try {
      const key = candidate == null ? academicStorage.getApiKey() : candidate.trim();
      if (!key) return { status: 'missing' };
      return { status: await verifyGeminiKey(key) };
    } catch {
      return { status: 'error' };
    }
  });

  handleTrusted('academic:removeApiKey', async () => {
    return academicStorage.removeApiKey();
  });

  // Enlaces Externos
  handleTrusted('app:openExternalUrl', async (_event, url) => {
    const safeUrl = parseExternalHttpUrl(url);
    if (safeUrl) {
      await shell.openExternal(safeUrl);
      return true;
    }
    return false;
  });
}

app.on('child-process-gone', (_event, details) => {
  console.error('[Main] Proceso auxiliar finalizado inesperadamente:', details?.type || 'unknown', details?.reason || 'unknown', details?.exitCode ?? '');
});

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

module.exports = {
  registerIpcHandlers,
  createWindow
};
