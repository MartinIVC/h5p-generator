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
  getTrash: () => ipcRenderer.invoke('academic:getTrash'),
  restoreTrashItem: (trashId) => ipcRenderer.invoke('academic:restoreTrashItem', trashId),
  permanentlyDeleteTrashItem: (trashId) => ipcRenderer.invoke('academic:permanentlyDeleteTrashItem', trashId),
  setCourseOrganization: (courseId, changes) => ipcRenderer.invoke('academic:setCourseOrganization', courseId, changes),
  markCourseOpened: (courseId) => ipcRenderer.invoke('academic:markCourseOpened', courseId),

  // Borradores locales del asistente
  getDrafts: () => ipcRenderer.invoke('academic:getDrafts'),
  saveDraft: (draftData) => ipcRenderer.invoke('academic:saveDraft', draftData),
  deleteDraft: (draftId) => ipcRenderer.invoke('academic:deleteDraft', draftId),

  // Copias de seguridad: los diálogos y el acceso a disco se mantienen en el proceso principal
  exportBackup: () => ipcRenderer.invoke('academic:exportBackup'),
  previewBackup: () => ipcRenderer.invoke('academic:previewBackup'),
  restoreBackup: (backupId, strategy) => ipcRenderer.invoke('academic:restoreBackup', { backupId, strategy }),

  // Proyectos Exportados (Projects)
  getProjects: (courseId) => ipcRenderer.invoke('academic:getProjects', courseId),
  saveProject: (projectData) => ipcRenderer.invoke('academic:saveProject', projectData),
  deleteProject: (projectId) => ipcRenderer.invoke('academic:deleteProject', projectId),
  assignProject: (projectId, courseId) => ipcRenderer.invoke('academic:assignProject', projectId, courseId),

  // Sistema de Archivos Local
  revealFile: (filePath) => ipcRenderer.invoke('academic:revealFile', filePath),
  verifyFileExists: (filePath) => ipcRenderer.invoke('academic:verifyFileExists', filePath),

  // Configuración y Clave API de Gemini
  getApiKeyStatus: () => ipcRenderer.invoke('academic:getApiKeyStatus'),
  saveApiKey: (apiKey) => ipcRenderer.invoke('academic:saveApiKey', apiKey),
  removeApiKey: () => ipcRenderer.invoke('academic:removeApiKey'),

  // Notificaciones del Sistema
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),

  // Enlaces Externos
  openExternalUrl: (url) => ipcRenderer.invoke('app:openExternalUrl', url)
});
