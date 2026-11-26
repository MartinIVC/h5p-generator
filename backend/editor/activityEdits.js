'use strict';

const { randomUUID } = require('node:crypto');
const { EDITABLE_TEXT_LIMITS: limits, optionTextKey } = require('../activityValidation');
const { isValidActivityCount } = require('../prompts');
const { EDITABLE_ACTIVITY_SCHEMA_VERSION, MAX_EDITABLE_TITLE_LENGTH, normalizeEditableTitle } = require('./editableActivity');

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const EDITABLE_TYPES = new Set(['questionset', 'multichoice', 'truefalse']);
const CHOICE_TEXT_FIELDS = Object.freeze({ question: limits.question, feedback: limits.feedback });
const TRUE_FALSE_TEXT_FIELDS = Object.freeze({
  statement: limits.question, feedbackOnCorrect: limits.feedback, feedbackOnIncorrect: limits.feedback
});

function editorError(code, issues) {
  const error = new Error(code);
  error.code = code;
  if (issues) error.issues = issues;
  return error;
}

function hasKeys(value, required, optional = []) {
  return Boolean(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

function isId(value) {
  return typeof value === 'string' && UUID.test(value);
}

function isText(value, limit) {
  return typeof value === 'string' && value.length <= limit;
}

function isTitle(value) {
  return isText(value, MAX_EDITABLE_TITLE_LENGTH) && !/[\x00-\x1f\x7f]/.test(value);
}

function assertEditableDraft(activity) {
  if (!hasKeys(activity, ['schemaVersion', 'activityId', 'activityType', 'title', 'revision', 'reviewedRevision', 'items']) ||
      activity.schemaVersion !== EDITABLE_ACTIVITY_SCHEMA_VERSION || !isId(activity.activityId) ||
      !EDITABLE_TYPES.has(activity.activityType) || !isTitle(activity.title) ||
      !Number.isSafeInteger(activity.revision) || activity.revision < 1 ||
      (activity.reviewedRevision !== null && activity.reviewedRevision !== activity.revision) ||
      !Array.isArray(activity.items) || !isValidActivityCount(activity.activityType, activity.items.length)) {
    throw editorError('INVALID_EDITABLE');
  }

  const itemIds = new Set();
  const isTrueFalse = activity.activityType === 'truefalse';
  const fields = isTrueFalse ? TRUE_FALSE_TEXT_FIELDS : CHOICE_TEXT_FIELDS;
  const required = ['id', ...Object.keys(fields), ...(isTrueFalse ? ['isTrue'] : ['options', 'correctOptionId'])];
  for (const item of activity.items) {
    if (!hasKeys(item, required, ['reviewed']) || !isId(item.id) || itemIds.has(item.id) ||
        (Object.hasOwn(item, 'reviewed') && typeof item.reviewed !== 'boolean') ||
        !Object.entries(fields).every(([field, limit]) => isText(item[field], limit))) {
      throw editorError('INVALID_EDITABLE');
    }
    itemIds.add(item.id);

    if (isTrueFalse) {
      if (item.isTrue !== null && typeof item.isTrue !== 'boolean') throw editorError('INVALID_EDITABLE');
      continue;
    }

    if (!Array.isArray(item.options) || item.options.length !== 4) throw editorError('INVALID_EDITABLE');
    const optionIds = new Set();
    for (const option of item.options) {
      if (!hasKeys(option, ['id', 'text']) || !isId(option.id) || optionIds.has(option.id) || !isText(option.text, limits.option)) {
        throw editorError('INVALID_EDITABLE');
      }
      optionIds.add(option.id);
    }
    if (item.correctOptionId !== null && !optionIds.has(item.correctOptionId)) throw editorError('INVALID_EDITABLE');
  }
}

function getActivityIssues(activity) {
  assertEditableDraft(activity);
  const issues = [];
  if (!normalizeEditableTitle(activity.title)) issues.push({ field: 'title', code: 'REQUIRED' });
  const isTrueFalse = activity.activityType === 'truefalse';
  const fields = isTrueFalse ? TRUE_FALSE_TEXT_FIELDS : CHOICE_TEXT_FIELDS;
  for (const item of activity.items) {
    const itemId = item.id;
    for (const field of Object.keys(fields)) {
      if (!item[field].trim()) issues.push({ itemId, field, code: 'REQUIRED' });
    }
    const answerField = isTrueFalse ? 'isTrue' : 'correctOptionId';
    if (item[answerField] === null) issues.push({ itemId, field: answerField, code: 'REQUIRED' });
    if (isTrueFalse) continue;

    const keys = item.options.map(option => optionTextKey(option.text));
    item.options.forEach((option, index) => {
      const key = keys[index];
      if (!key || keys.indexOf(key) !== keys.lastIndexOf(key)) {
        issues.push({ itemId, optionId: option.id, field: 'text', code: key ? 'DUPLICATE_OPTION' : 'REQUIRED' });
      }
    });
  }
  return issues;
}

function confirmActivityReview(activity) {
  const issues = getActivityIssues(activity);
  if (issues.length) throw editorError('INVALID_CONTENT', issues);
  return { ...activity, reviewedRevision: activity.revision };
}

function newChoiceItem() {
  return {
    id: randomUUID(),
    question: '',
    options: Array.from({ length: 4 }, () => ({ id: randomUUID(), text: '' })),
    correctOptionId: null,
    feedback: ''
  };
}

function replaceField(target, field, value) {
  if (target[field] === value) return false;
  target[field] = value;
  return true;
}

const operationKeys = Object.freeze({
  setTitle: ['title'],
  addItem: [],
  removeItem: ['itemId'],
  moveItem: ['itemId', 'index'],
  setItemText: ['itemId', 'field', 'text'],
  setOptionText: ['itemId', 'optionId', 'text'],
  setCorrectOption: ['itemId', 'optionId'],
  setTrueFalseAnswer: ['itemId', 'value'],
  markItemReviewed: ['itemId', 'reviewed']
});

function applyOperation(activity, operation) {
  const type = operation?.type;
  if (typeof type !== 'string' || !Object.hasOwn(operationKeys, type) ||
      !hasKeys(operation, ['type', ...operationKeys[type]])) throw editorError('INVALID_OPERATION');

  const { items, activityType } = activity;
  if (type === 'setTitle') {
    if (!isTitle(operation.title)) throw editorError('INVALID_OPERATION');
    return replaceField(activity, 'title', normalizeEditableTitle(operation.title));
  }
  if (type === 'addItem') {
    if (activityType !== 'questionset' || !isValidActivityCount(activityType, items.length + 1)) throw editorError('ITEM_COUNT');
    items.push(newChoiceItem());
    return true;
  }

  const position = items.findIndex(item => item.id === operation.itemId);
  if (position < 0) throw editorError('ITEM_NOT_FOUND');
  const item = items[position];
  if (type === 'removeItem') {
    if (activityType !== 'questionset' || !isValidActivityCount(activityType, items.length - 1)) throw editorError('ITEM_COUNT');
    items.splice(position, 1);
    return true;
  }
  if (type === 'moveItem') {
    const { index } = operation;
    if (activityType !== 'questionset' || !Number.isInteger(index) || index < 0 || index >= items.length) {
      throw editorError('INVALID_OPERATION');
    }
    if (index === position) return false;
    items.splice(position, 1);
    items.splice(index, 0, item);
    return true;
  }
  if (type === 'markItemReviewed') {
    if (typeof operation.reviewed !== 'boolean') throw editorError('INVALID_OPERATION');
    item.reviewed = operation.reviewed;
    return false;
  }

  const isTrueFalse = activityType === 'truefalse';
  let changed;
  switch (type) {
    case 'setItemText': {
      const fields = isTrueFalse ? TRUE_FALSE_TEXT_FIELDS : CHOICE_TEXT_FIELDS;
      const { field, text } = operation;
      if (typeof field !== 'string' || !Object.hasOwn(fields, field) || !isText(text, fields[field])) {
        throw editorError('INVALID_OPERATION');
      }
      changed = replaceField(item, field, text.trim());
      break;
    }
    case 'setOptionText': {
      const option = item.options?.find(entry => entry.id === operation.optionId);
      if (!option || !isText(operation.text, limits.option)) throw editorError('INVALID_OPERATION');
      changed = replaceField(option, 'text', operation.text.trim());
      break;
    }
    case 'setCorrectOption':
      if (isTrueFalse || (operation.optionId !== null && !item.options.some(option => option.id === operation.optionId))) {
        throw editorError('INVALID_OPERATION');
      }
      changed = replaceField(item, 'correctOptionId', operation.optionId);
      break;
    case 'setTrueFalseAnswer':
      if (!isTrueFalse || (operation.value !== null && typeof operation.value !== 'boolean')) throw editorError('INVALID_OPERATION');
      changed = replaceField(item, 'isTrue', operation.value);
      break;
  }
  if (changed) delete item.reviewed;
  return changed;
}

function applyActivityEdits(activity, operations) {
  assertEditableDraft(activity);
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 64) throw editorError('INVALID_OPERATION');

  const next = structuredClone(activity);
  let changed = false;
  for (const operation of operations) {
    if (applyOperation(next, operation)) changed = true;
  }
  if (changed) {
    if (next.revision === Number.MAX_SAFE_INTEGER) throw editorError('INVALID_EDITABLE');
    next.revision += 1;
    next.reviewedRevision = null;
  }
  return next;
}

module.exports = { applyActivityEdits, assertEditableDraft, confirmActivityReview, getActivityIssues };
