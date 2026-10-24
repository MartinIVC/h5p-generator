/**
 * frontend/preload.js
 * Script de precarga seguro para Electron.
 * Expone la API de gestión académica (Ramos y Proyectos) al contexto del frontend (renderer)
 * a través de contextBridge, manteniendo aislados los módulos nativos de Node.js.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('academicAPI', {
  // Ramos (Courses)
  getCourses: () => ipcRenderer.invoke('academic:getCourses'),
  getCourseById: (courseId) => ipcRenderer.invoke('academic:getCourseById', courseId),
  saveCourse: (courseData) => ipcRenderer.invoke('academic:saveCourse', courseData),
  deleteCourse: (courseId) => ipcRenderer.invoke('academic:deleteCourse', courseId),

  // Proyectos Exportados (Projects)
  getProjects: (courseId) => ipcRenderer.invoke('academic:getProjects', courseId),
  saveProject: (projectData) => ipcRenderer.invoke('academic:saveProject', projectData),
  deleteProject: (projectId) => ipcRenderer.invoke('academic:deleteProject', projectId),

  // Sistema de Archivos Local
  revealFile: (filePath) => ipcRenderer.invoke('academic:revealFile', filePath),
  verifyFileExists: (filePath) => ipcRenderer.invoke('academic:verifyFileExists', filePath),

  // Configuración y Clave API de Gemini
  getApiKeyStatus: () => ipcRenderer.invoke('academic:getApiKeyStatus'),
  saveApiKey: (apiKey) => ipcRenderer.invoke('academic:saveApiKey', apiKey),
  removeApiKey: () => ipcRenderer.invoke('academic:removeApiKey')
});
