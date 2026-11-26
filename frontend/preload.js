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
  revealProjectFile: (projectId) => ipcRenderer.invoke('academic:revealProjectFile', projectId),
  revealFile: (filePath) => ipcRenderer.invoke('academic:revealFile', filePath),
  verifyFileExists: (filePath) => ipcRenderer.invoke('academic:verifyFileExists', filePath),

  // Configuración y Clave API de Gemini
  getApiKeyStatus: () => ipcRenderer.invoke('academic:getApiKeyStatus'),
  saveApiKey: (apiKey) => ipcRenderer.invoke('academic:saveApiKey', apiKey),
  verifyApiKey: (apiKey) => ipcRenderer.invoke('llm:verify-key', apiKey),
  removeApiKey: () => ipcRenderer.invoke('academic:removeApiKey'),

  // Notificaciones del sistema
  getNotificationSettings: () => ipcRenderer.invoke('academic:getNotificationSettings'),
  setNotificationSettings: (settings) => ipcRenderer.invoke('academic:setNotificationSettings', settings),

  // Operaciones explícitas del flujo H5P.
  inspectDocument: (document) => ipcRenderer.invoke('h5p:inspect-document', document),
  releaseDocument: (documentId) => ipcRenderer.invoke('h5p:release-document', { documentId }),
  generateH5P: (request) => ipcRenderer.invoke('h5p:generate', request),
  cancelGeneration: () => ipcRenderer.invoke('h5p:cancel-generation', {}),
  saveH5PFile: (request) => ipcRenderer.invoke('h5p:save-file', request),
  openEditor: (request) => ipcRenderer.invoke('h5p:open-editor', request),
  updateEditor: (request) => ipcRenderer.invoke('h5p:update-editor', request),
  closeEditor: (request) => ipcRenderer.invoke('h5p:close-editor', request),

  // Enlaces Externos
  openExternalUrl: (url) => ipcRenderer.invoke('app:openExternalUrl', url)
});
