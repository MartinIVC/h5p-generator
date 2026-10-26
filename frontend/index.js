const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
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

  win.loadFile(path.join(__dirname, 'index.html'));
};

// ========================================================
// REGISTRO DE CANALES IPC PARA GESTIÓN ACADÉMICA Y PROYECTOS
// ========================================================

let ipcRegistered = false;

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

