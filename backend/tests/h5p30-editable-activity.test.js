'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateActivityItems } = require('../activityValidation');
const { createEditableActivity, toPackageItems } = require('../editor/editableActivity');
const { buildH5PContent } = require('../h5pBuilder');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const choice = {
  pregunta: '¿Cuál es la unidad del SI para la fuerza?',
  opciones: ['Joule', 'Newton', 'Watt', 'Pascal'],
  respuestaCorrecta: 'Newton',
  retroalimentacion: 'El newton mide fuerza.'
};
const secondChoice = {
  pregunta: '¿Cuál es la unidad del SI para la potencia?',
  opciones: ['Joule', 'Newton', 'Watt', 'Pascal'],
  respuestaCorrecta: 'Watt',
  retroalimentacion: 'El watt mide potencia.'
};

test('QuestionSet asigna identificadores propios y conserva los ítems al serializar', () => {
  const generated = [choice, secondChoice];
  const activity = createEditableActivity({ activityType: 'question-set', title: '  Repaso de física  ', items: generated });
  const { items, ...metadata } = activity;
  assert.deepEqual(metadata, {
    schemaVersion: 1,
    activityId: activity.activityId,
    activityType: 'questionset',
    title: 'Repaso de física',
    revision: 1,
    reviewedRevision: null
  });
  const ids = [activity.activityId, ...items.flatMap(item => [item.id, ...item.options.map(option => option.id)])];
  for (const id of ids) assert.match(id, UUID_V4);
  assert.equal(new Set(ids).size, ids.length);
  const fromLegacyAlias = createEditableActivity({ activityType: 'multiple-choice', items: generated });
  assert.equal(fromLegacyAlias.activityType, 'questionset');
  assert.notEqual(fromLegacyAlias.activityId, activity.activityId);
  assert.equal(items[0].correctOptionId, items[0].options[1].id);
  assert.equal(items[1].correctOptionId, items[1].options[2].id);
  const restored = JSON.parse(JSON.stringify(activity));
  assert.deepEqual(restored, activity);
  assert.deepEqual(toPackageItems(restored), generated);
});

test('QuestionSet y MultiChoice conservan la selección al renombrar y reordenar alternativas', async () => {
  for (const activityType of ['questionset', 'multichoice']) {
    const generated = activityType === 'questionset' ? [choice, secondChoice] : [choice];
    const activity = createEditableActivity({ activityType, items: generated });
    const [item] = activity.items;
    const correctOption = item.options.splice(1, 1)[0];
    item.options.unshift(correctOption);
    const renamedOptions = ['A) Newton (N)', 'B) Joule', 'C) Watt', 'D) Pascal'];
    item.options.forEach((option, index) => { option.text = renamedOptions[index]; });
    if (activityType === 'questionset') activity.items.reverse();

    const expected = { ...choice, opciones: renamedOptions, respuestaCorrecta: renamedOptions[0] };
    const projected = toPackageItems(activity);
    assert.deepEqual(projected, activityType === 'questionset' ? [secondChoice, expected] : [expected]);
    assert.equal(item.correctOptionId, correctOption.id);
    assert.equal(choice.opciones[1], 'Newton');

    const { content } = await buildH5PContent(activityType, projected, { title: activity.title, reviewed: true });
    const answers = activityType === 'questionset' ? content.questions[1].params.answers : content.answers;
    assert.deepEqual(answers.map(answer => answer.text), renamedOptions.map(text => `<div>${text}</div>`));
    assert.deepEqual(answers.map(answer => answer.correct), [true, false, false, false]);
  }
});

test('MultiChoice conserva prefijos literales después de la validación de Gemini', () => {
  const opciones = ['A) A. Joule', 'B) B. Newton', 'C) C. Watt', 'D) D. Pascal'];
  const generated = validateActivityItems('multichoice', [{ ...choice, opciones, respuestaCorrecta: opciones[1] }], 1);
  const activity = createEditableActivity({ activityType: 'multichoice', items: generated });
  assert.equal(activity.activityType, 'multichoice');
  assert.equal(activity.items[0].options[1].text, 'B. Newton');
  assert.deepEqual(toPackageItems(activity), generated);
});

test('TrueFalse conserva false y las dos retroalimentaciones en la proyección y en H5P', async () => {
  const generated = [{
    afirmacion: 'El newton mide potencia.',
    esVerdadera: false,
    retroalimentacionCorrecta: 'El newton mide fuerza.',
    retroalimentacionIncorrecta: 'La potencia se mide en watts.'
  }];
  const activity = createEditableActivity({ activityType: 'truefalse', items: generated });
  assert.equal(activity.title, 'Verdadero o Falso');
  assert.deepEqual(activity.items[0], {
    id: activity.items[0].id,
    statement: generated[0].afirmacion,
    isTrue: false,
    feedbackOnCorrect: generated[0].retroalimentacionCorrecta,
    feedbackOnIncorrect: generated[0].retroalimentacionIncorrecta
  });
  const projected = toPackageItems(activity);
  assert.deepEqual(projected, generated);
  const { content } = await buildH5PContent(activity.activityType, projected, { title: activity.title, reviewed: true });
  assert.equal(content.correct, 'false');
  assert.equal(content.behaviour.feedbackOnCorrect, generated[0].retroalimentacionCorrecta);
  assert.equal(content.behaviour.feedbackOnWrong, generated[0].retroalimentacionIncorrecta);
});

test('los adaptadores rechazan formatos sin editor, cardinalidad inválida y referencias rotas', () => {
  assert.throws(() => createEditableActivity({ activityType: 'singlechoiceset', items: [] }), {
    message: 'UNSUPPORTED_ACTIVITY_TYPE'
  });
  assert.throws(() => createEditableActivity({ activityType: 'multichoice', items: [choice, secondChoice] }), {
    message: 'INVALID_RESPONSE', reason: 'COUNT'
  });
  const activity = createEditableActivity({ activityType: 'multichoice', items: [choice] });
  assert.throws(() => toPackageItems({ ...activity, schemaVersion: 2 }), {
    message: 'INVALID_RESPONSE', reason: 'STRUCTURE'
  });
  activity.items[0].options.splice(1, 1);
  assert.throws(() => toPackageItems(activity), { message: 'INVALID_RESPONSE', reason: 'CORRECT_ANSWER' });
});
