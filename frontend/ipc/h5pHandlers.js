'use strict';

const { createDocumentInspection } = require('./documentInspection');

// Los límites se aplican antes de llamar a cualquier servicio o acceder al disco.
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const EXTENSIONS = new Set(['pdf', 'txt', 'md', 'csv', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'odp', 'odt', 'ods', 'rtf']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const errors = {
  INVALID_SENDER: 'La solicitud no proviene de la ventana de la aplicación.',
  INVALID_ARGUMENT: 'Los datos de la solicitud no son válidos.',
  NOT_AVAILABLE: 'Esta función todavía no está disponible.',
  INTERNAL_ERROR: 'No se pudo completar la operación.'
};

function failure(code) {
  return { status: 'error', code, message: errors[code] };
}

function objectWithKeys(value, required, optional = []) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

function validDocument(value) {
  if (!objectWithKeys(value, ['name', 'bytes'])) return false;
  const { name, bytes } = value;
  if (typeof name !== 'string' || name.length < 1 || name.length > 255 ||
      /[\\/\x00-\x1f\x7f]/.test(name)) return false;
  const extension = name.split('.').pop().toLowerCase();
  if (!name.includes('.') || !EXTENSIONS.has(extension)) return false;
  return bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= MAX_DOCUMENT_BYTES;
}

function validGeneration(value) {
  if (!objectWithKeys(value, ['documentIds', 'activityType', 'questionCount', 'instructions'])) return false;
  return Array.isArray(value.documentIds) && value.documentIds.length > 0 && value.documentIds.length <= 20 &&
    value.documentIds.every(id => typeof id === 'string' && UUID.test(id)) &&
    new Set(value.documentIds).size === value.documentIds.length &&
    typeof value.activityType === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.activityType) &&
    Number.isInteger(value.questionCount) && value.questionCount >= 1 && value.questionCount <= 20 &&
    typeof value.instructions === 'string' && value.instructions.length <= 10000;
}

function validSave(value) {
  return objectWithKeys(value, ['packageId', 'suggestedName'], ['courseId']) &&
    typeof value.packageId === 'string' && UUID.test(value.packageId) &&
    (value.courseId === undefined || (typeof value.courseId === 'string' && value.courseId.length > 0 && value.courseId.length <= 128)) &&
    typeof value.suggestedName === 'string' && value.suggestedName.length > 0 &&
    value.suggestedName.length <= 200 && !/[\\/\x00-\x1f\x7f]/.test(value.suggestedName) &&
    value.suggestedName !== '.' && value.suggestedName !== '..';
}

// Un único límite de errores para los nuevos canales. Nunca serializa excepciones.
function handler(isTrustedSender, validate, operation) {
  return async (event, request) => {
    try {
      if (!isTrustedSender(event)) return failure('INVALID_SENDER');
      if (!validate(request)) return failure('INVALID_ARGUMENT');
      return await operation(request, event);
    } catch {
      return failure('INTERNAL_ERROR');
    }
  };
}

function registerH5PIpcHandlers(ipcMain, isTrustedSender, inspection = createDocumentInspection(), generation = {}) {
  const unavailable = async () => failure('NOT_AVAILABLE');
  ipcMain.handle('h5p:inspect-document', handler(isTrustedSender, validDocument, inspection.inspect));
  ipcMain.handle('h5p:release-document', handler(isTrustedSender, value =>
    objectWithKeys(value, ['documentId']) && typeof value.documentId === 'string' && UUID.test(value.documentId), inspection.release));
  ipcMain.handle('h5p:generate', handler(isTrustedSender, validGeneration, generation.generateH5P || unavailable));
  ipcMain.handle('h5p:save-file', handler(isTrustedSender, validSave, generation.saveH5PFile || unavailable));
  return inspection;
}

module.exports = { registerH5PIpcHandlers, handler };
