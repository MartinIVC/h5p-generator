'use strict';

const { randomUUID } = require('node:crypto');
const { invalidResponse, validateReviewedActivityItems } = require('../activityValidation');
const { getActivitySpec, resolveActivityType } = require('../prompts');

const EDITABLE_ACTIVITY_SCHEMA_VERSION = 1;
const MAX_EDITABLE_TITLE_LENGTH = 180;

function normalizeEditableTitle(title) {
  return title.trim().replace(/(?:\s*\.h5p)+$/i, '').replace(/\s+/g, ' ').trim();
}

const choiceAdapter = {
  fromGenerated({ pregunta, opciones, respuestaCorrecta, retroalimentacion }) {
    const options = opciones.map(text => ({ id: randomUUID(), text }));
    const correctIndex = opciones.indexOf(respuestaCorrecta);
    return {
      id: randomUUID(),
      question: pregunta,
      options,
      correctOptionId: options[correctIndex].id,
      feedback: retroalimentacion
    };
  },
  toPackageItem({ question, options, correctOptionId, feedback }) {
    const correctOption = options.find(option => option.id === correctOptionId);
    if (!correctOption) throw invalidResponse('CORRECT_ANSWER');
    return {
      pregunta: question,
      opciones: options.map(option => option.text),
      respuestaCorrecta: correctOption.text,
      retroalimentacion: feedback
    };
  }
};

const trueFalseAdapter = {
  fromGenerated({ afirmacion, esVerdadera, retroalimentacionCorrecta, retroalimentacionIncorrecta }) {
    return {
      id: randomUUID(),
      statement: afirmacion,
      isTrue: esVerdadera,
      feedbackOnCorrect: retroalimentacionCorrecta,
      feedbackOnIncorrect: retroalimentacionIncorrecta
    };
  },
  toPackageItem({ statement, isTrue, feedbackOnCorrect, feedbackOnIncorrect }) {
    return {
      afirmacion: statement,
      esVerdadera: isTrue,
      retroalimentacionCorrecta: feedbackOnCorrect,
      retroalimentacionIncorrecta: feedbackOnIncorrect
    };
  }
};

const adapters = Object.freeze({
  questionset: choiceAdapter,
  multichoice: choiceAdapter,
  truefalse: trueFalseAdapter
});

function getAdapter(activityType) {
  if (!Object.hasOwn(adapters, activityType)) throw new Error('UNSUPPORTED_ACTIVITY_TYPE');
  return adapters[activityType];
}

function createEditableActivity({ activityType, title, items }) {
  const canonical = resolveActivityType(activityType);
  const adapter = getAdapter(canonical);
  const generatedItems = Array.isArray(items) ? [...items] : items;
  // El cliente LLM ya canonizó los ítems. Conserva cualquier prefijo literal restante.
  const validated = validateReviewedActivityItems(canonical, generatedItems, generatedItems?.length);
  return {
    schemaVersion: EDITABLE_ACTIVITY_SCHEMA_VERSION,
    activityId: randomUUID(),
    activityType: canonical,
    title: (title && normalizeEditableTitle(title)) || getActivitySpec(canonical).label,
    revision: 1,
    reviewedRevision: null,
    items: validated.map(adapter.fromGenerated)
  };
}

// Proyecta el modelo interno al contrato que valida el empaquetador.
function toPackageItems(activity) {
  if (activity.schemaVersion !== EDITABLE_ACTIVITY_SCHEMA_VERSION) throw invalidResponse('STRUCTURE');
  return activity.items.map(getAdapter(activity.activityType).toPackageItem);
}

module.exports = {
  EDITABLE_ACTIVITY_SCHEMA_VERSION,
  MAX_EDITABLE_TITLE_LENGTH,
  createEditableActivity,
  normalizeEditableTitle,
  toPackageItems
};
