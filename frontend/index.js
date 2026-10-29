const { app, BrowserWindow, ipcMain, shell, Notification, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
app.setName('h5p-generator');
const { academicStorage } = require(path.join(__dirname, '..', 'backend', 'storage.js'));

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
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

function registerIpcHandlers() {
  if (ipcRegistered) return;
  ipcRegistered = true;
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

  ipcMain.handle('academic:restoreBackup', async (_event, { backupId, strategy } = {}) => {
    if (!pendingBackupImport || backupId !== pendingBackupImport.id) {
      throw new Error('La copia debe seleccionarse y revisarse antes de restaurarla.');
    }
    const result = academicStorage.restoreBackupPayload(pendingBackupImport.payload, strategy);
    pendingBackupImport = null;
    return result;
  });

  ipcMain.handle('academic:deleteCourse', async (_event, courseId) => {
    return academicStorage.deleteCourse(courseId);
  });

  // Proyectos Exportados (Projects)
  ipcMain.handle('academic:getProjects', async (_event, courseId) => {
    return academicStorage.getProjects(courseId);
  });

  ipcMain.handle('academic:saveProject', async (_event, projectData) => {
    return academicStorage.saveProject(projectData);
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

// =============================================================================
// NOTIFICACIONES DEL SISTEMA
// =============================================================================
ipcMain.handle('show-notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({
      title: title || 'H5P RAG Generator',
      body: body || ''
    }).show();
    return { success: true };
  }
  return { success: false, error: 'Notificaciones no soportadas' };
});
