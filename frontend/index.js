const { app, BrowserWindow, ipcMain, shell, Notification, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { registerH5PIpcHandlers } = require(path.join(__dirname, 'ipc', 'h5pHandlers.js'));
// Chromium no detecta automáticamente Libsecret en sesiones Hyprland.
if (process.platform === 'linux' && (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase().split(':').includes('hyprland')) {
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}
app.setName('h5p-generator');
app.commandLine.appendSwitch('lang', 'es');
const { academicStorage } = require(path.join(__dirname, '..', 'backend', 'storage.js'));

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
      nodeIntegration: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.loadFile(path.join(__dirname, 'index.html'));
};

// ========================================================
// REGISTRO DE CANALES IPC PARA GESTIÓN ACADÉMICA Y PROYECTOS
// ========================================================

let ipcRegistered = false;
let pendingBackupImport = null;

function notifyWhenInBackground(event, body) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || win.isFocused() || !Notification.isSupported()) return;
  try {
    new Notification({ title: 'Generador H5P', body }).show();
  } catch {
    // El aviso visible dentro de la aplicación sigue disponible.
  }
}

function registerIpcHandlers() {
  if (ipcRegistered) return;
  ipcRegistered = true;
  registerH5PIpcHandlers(ipcMain, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const frame = event.senderFrame;
    return Boolean(win && !win.isDestroyed() && win.webContents === event.sender &&
      frame && frame === event.sender.mainFrame &&
      frame.url === pathToFileURL(path.join(__dirname, 'index.html')).href);
  });
  // Ramos (Courses)
  ipcMain.handle('academic:getCourses', async () => {
    return academicStorage.getAllCourses();
  });

  ipcMain.handle('academic:getCourseById', async (_event, courseId) => {
    return academicStorage.getCourseById(courseId);
  });

  ipcMain.handle('academic:saveCourse', async (_event, courseData) => {
    return academicStorage.saveCourse(courseData);
  });

  ipcMain.handle('academic:setCourseOrganization', async (_event, courseId, changes) => {
    return academicStorage.setCourseOrganization(courseId, changes);
  });

  ipcMain.handle('academic:markCourseOpened', async (_event, courseId) => {
    return academicStorage.markCourseOpened(courseId);
  });

  ipcMain.handle('academic:getDrafts', async () => {
    return academicStorage.getDrafts();
  });

  ipcMain.handle('academic:saveDraft', async (_event, draftData) => {
    return academicStorage.saveDraft(draftData);
  });

  ipcMain.handle('academic:deleteDraft', async (_event, draftId) => {
    return academicStorage.deleteDraft(draftId);
  });

  ipcMain.handle('academic:exportBackup', async (event) => {
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Crear copia de seguridad',
      defaultPath: path.join(app.getPath('documents'), `generador-h5p-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'Copia del Generador H5P', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { canceled: true };

    const payload = academicStorage.createBackupPayload();
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { encoding: 'utf-8', mode: 0o600 });
    notifyWhenInBackground(event, 'Copia de seguridad creada.');
    return {
      canceled: false,
      filePath,
      summary: academicStorage.inspectBackupPayload(payload)
    };
  });

  ipcMain.handle('academic:previewBackup', async (event) => {
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
    pendingBackupImport = { id: crypto.randomUUID(), payload };
    return { canceled: false, backupId: pendingBackupImport.id, ...summary };
  });

  ipcMain.handle('academic:restoreBackup', async (event, { backupId, strategy } = {}) => {
    if (!pendingBackupImport || backupId !== pendingBackupImport.id) {
      throw new Error('La copia debe seleccionarse y revisarse antes de restaurarla.');
    }
    const result = academicStorage.restoreBackupPayload(pendingBackupImport.payload, strategy);
    pendingBackupImport = null;
    notifyWhenInBackground(event, 'Copia de seguridad restaurada.');
    return result;
  });

  ipcMain.handle('academic:deleteCourse', async (_event, courseId) => {
    return academicStorage.deleteCourse(courseId);
  });
  ipcMain.handle('academic:getTrash', async () => academicStorage.getTrash());
  ipcMain.handle('academic:restoreTrashItem', async (_event, trashId) => academicStorage.restoreTrashItem(trashId));
  ipcMain.handle('academic:permanentlyDeleteTrashItem', async (_event, trashId) => academicStorage.permanentlyDeleteTrashItem(trashId));

  // Proyectos Exportados (Projects)
  ipcMain.handle('academic:getProjects', async (_event, courseId) => {
    return academicStorage.getProjects(courseId);
  });

  ipcMain.handle('academic:saveProject', async (_event, projectData) => {
    return academicStorage.saveProject(projectData);
  });

  ipcMain.handle('academic:assignProject', async (_event, projectId, courseId) => {
    return academicStorage.assignProject(projectId, courseId);
  });

  ipcMain.handle('academic:deleteProject', async (_event, projectId) => {
    return academicStorage.deleteProject(projectId);
  });

  // Integración con Sistema de Archivos
  ipcMain.handle('academic:revealFile', async (_event, filePath) => {
    if (!filePath || typeof filePath !== 'string') return false;
    try {
      shell.showItemInFolder(filePath);
      return true;
    } catch (err) {
      console.error('[IPC] Error mostrando archivo en carpeta:', err);
      return false;
    }
  });

  ipcMain.handle('academic:verifyFileExists', async (_event, filePath) => {
    return academicStorage.verifyFileExists(filePath);
  });

  // Credenciales y Configuración (Gemini API Key)
  ipcMain.handle('academic:getApiKeyStatus', async () => {
    return academicStorage.getApiKeyStatus();
  });

  ipcMain.handle('academic:saveApiKey', async (_event, apiKey) => {
    return academicStorage.saveApiKey(apiKey);
  });

  ipcMain.handle('llm:verify-key', async (_event, candidate) => {
    if (candidate != null && (typeof candidate !== 'string' || candidate.length > 1024)) {
      return { status: 'error' };
    }
    try {
      const key = candidate == null ? academicStorage.getApiKey() : candidate.trim();
      if (!key) return { status: 'missing' };
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde OK.' }] }], generationConfig: { maxOutputTokens: 8 } }),
        signal: AbortSignal.timeout(15000)
      });
      if (response.ok) return { status: 'valid' };
      if (response.status === 400 || response.status === 401 || response.status === 403) return { status: 'invalid' };
      if (response.status === 429) return { status: 'quota' };
      return { status: 'error' };
    } catch {
      return { status: 'error' };
    }
  });

  ipcMain.handle('academic:removeApiKey', async () => {
    return academicStorage.removeApiKey();
  });

  // Enlaces Externos
  ipcMain.handle('app:openExternalUrl', async (_event, url) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });
}

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
