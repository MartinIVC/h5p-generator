'use strict';

const { createDocumentInspection } = require('./documentInspection');

// Los límites se aplican antes de llamar a cualquier servicio o acceder al disco.
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const EXTENSIONS = new Set(['pdf', 'txt', 'md', 'csv', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'odp', 'odt', 'ods', 'rtf']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITOR_ITEM_TEXT_FIELDS = new Set(['question', 'feedback', 'statement', 'feedbackOnCorrect', 'feedbackOnIncorrect']);

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
  if (!objectWithKeys(value, ['documentIds', 'activityType', 'questionCount', 'instructions'], ['title'])) return false;
  return Array.isArray(value.documentIds) && value.documentIds.length > 0 && value.documentIds.length <= 20 &&
    value.documentIds.every(id => typeof id === 'string' && UUID.test(id)) &&
    new Set(value.documentIds).size === value.documentIds.length &&
    typeof value.activityType === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.activityType) &&
    Number.isInteger(value.questionCount) && value.questionCount >= 1 && value.questionCount <= 20 &&
    typeof value.instructions === 'string' && value.instructions.length <= 10000 &&
    (value.title === undefined || (typeof value.title === 'string' && value.title.length <= 180 && !/[\x00-\x1f\x7f]/.test(value.title)));
}

function validSave(value) {
  if (!objectWithKeys(value, ['packageId', 'suggestedName'], ['courseId'])) return false;
  if (typeof value.packageId !== 'string' || !UUID.test(value.packageId)) return false;
  if (value.courseId !== undefined && (typeof value.courseId !== 'string' || value.courseId.length === 0 || value.courseId.length > 128)) {
    return false;
  }
  if (typeof value.suggestedName !== 'string' || value.suggestedName.length === 0 || value.suggestedName.length > 200) {
    return false;
  }
  const trimmed = value.suggestedName.trim();
  const baseName = trimmed.replace(/\.h5p$/i, '').trim();
  return baseName.length > 0 &&
    !/[\\/:*?"<>|\x00-\x1f\x7f]/.test(trimmed) &&
    trimmed !== '.' && trimmed !== '..' &&
    baseName !== '.' && baseName !== '..';
}

function validRecordId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);
}

function validOpenEditor(value) {
  if (objectWithKeys(value, ['draftId'])) return validRecordId(value.draftId);
  if (objectWithKeys(value, ['projectId'])) return validRecordId(value.projectId);
  return false;
}

function validEditorOperation(op) {
  if (!op || typeof op !== 'object' || Array.isArray(op) || typeof op.type !== 'string') return false;
  switch (op.type) {
    case 'setTitle':
      return objectWithKeys(op, ['type', 'title']) &&
        typeof op.title === 'string' && op.title.length <= 180 && !/[\x00-\x1f\x7f]/.test(op.title);
    case 'addItem':
      return objectWithKeys(op, ['type']);
    case 'removeItem':
      return objectWithKeys(op, ['type', 'itemId']) && typeof op.itemId === 'string' && UUID.test(op.itemId);
    case 'moveItem':
      return objectWithKeys(op, ['type', 'itemId', 'index']) &&
        typeof op.itemId === 'string' && UUID.test(op.itemId) &&
        Number.isInteger(op.index) && op.index >= 0 && op.index < 20;
    case 'setItemText':
      return objectWithKeys(op, ['type', 'itemId', 'field', 'text']) &&
        typeof op.itemId === 'string' && UUID.test(op.itemId) &&
        EDITOR_ITEM_TEXT_FIELDS.has(op.field) &&
        typeof op.text === 'string' && op.text.length <= 2000;
    case 'setOptionText':
      return objectWithKeys(op, ['type', 'itemId', 'optionId', 'text']) &&
        typeof op.itemId === 'string' && UUID.test(op.itemId) &&
        typeof op.optionId === 'string' && UUID.test(op.optionId) &&
        typeof op.text === 'string' && op.text.length <= 1000;
    case 'setCorrectOption':
      return objectWithKeys(op, ['type', 'itemId', 'optionId']) &&
        typeof op.itemId === 'string' && UUID.test(op.itemId) &&
        (op.optionId === null || (typeof op.optionId === 'string' && UUID.test(op.optionId)));
    case 'setTrueFalseAnswer':
      return objectWithKeys(op, ['type', 'itemId', 'value']) &&
        typeof op.itemId === 'string' && UUID.test(op.itemId) &&
        (op.value === null || typeof op.value === 'boolean');
    case 'markItemReviewed':
      return objectWithKeys(op, ['type', 'itemId', 'reviewed']) &&
        typeof op.itemId === 'string' && UUID.test(op.itemId) &&
        typeof op.reviewed === 'boolean';
    default:
      return false;
  }
}

function validUpdateEditor(value) {
  return objectWithKeys(value, ['sessionId', 'expectedRevision', 'operations']) &&
    typeof value.sessionId === 'string' && UUID.test(value.sessionId) &&
    Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 1 &&
    Array.isArray(value.operations) && value.operations.length >= 1 && value.operations.length <= 64 &&
    value.operations.every(validEditorOperation);
}

function validCloseEditor(value) {
  return objectWithKeys(value, ['sessionId']) &&
    typeof value.sessionId === 'string' && UUID.test(value.sessionId);
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

function registerH5PIpcHandlers(ipcMain, isTrustedSender, inspection = createDocumentInspection(), generation = {}, editor = {}) {
  const unavailable = async () => failure('NOT_AVAILABLE');
  ipcMain.handle('h5p:inspect-document', handler(isTrustedSender, validDocument, inspection.inspect));
  ipcMain.handle('h5p:release-document', handler(isTrustedSender, value =>
    objectWithKeys(value, ['documentId']) && typeof value.documentId === 'string' && UUID.test(value.documentId), inspection.release));
  ipcMain.handle('h5p:generate', handler(isTrustedSender, validGeneration, generation.generateH5P || unavailable));
  ipcMain.handle('h5p:cancel-generation', handler(isTrustedSender, value => objectWithKeys(value, []), generation.cancelGeneration || unavailable));
  ipcMain.handle('h5p:save-file', handler(isTrustedSender, validSave, generation.saveH5PFile || unavailable));
  ipcMain.handle('h5p:open-editor', handler(isTrustedSender, validOpenEditor, editor.openEditor || unavailable));
  ipcMain.handle('h5p:update-editor', handler(isTrustedSender, validUpdateEditor, editor.updateEditor || unavailable));
  ipcMain.handle('h5p:close-editor', handler(isTrustedSender, validCloseEditor, editor.closeEditor || unavailable));
  return inspection;
}

module.exports = { registerH5PIpcHandlers, handler };
