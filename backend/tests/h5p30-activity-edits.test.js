'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEditableActivity, toPackageItems } = require('../editor/editableActivity');
const { applyActivityEdits, confirmActivityReview, getActivityIssues } = require('../editor/activityEdits');

const question = {
  pregunta: '¿Qué se mide en newtons?',
  opciones: ['Fuerza', 'Potencia', 'Masa', 'Tiempo'],
  respuestaCorrecta: 'Fuerza',
  retroalimentacion: 'El newton es la unidad de fuerza.'
};

function questionSet(count) {
  return createEditableActivity({ activityType: 'questionset', items: Array.from({ length: count }, () => question) });
}

test('QuestionSet aplica los límites de 1 y 20 ítems y conserva sus identificadores al moverlos', () => {
  const initial = questionSet(1);
  const first = initial.items[0];
  assert.throws(() => applyActivityEdits(initial, [{ type: 'removeItem', itemId: first.id }]), { code: 'ITEM_COUNT' });
  const full = applyActivityEdits(initial, Array.from({ length: 19 }, () => ({ type: 'addItem' })));
  assert.equal(full.items.length, 20);
  assert.equal(new Set(full.items.map(item => item.id)).size, 20);
  assert.equal(new Set(full.items[1].options.map(option => option.id)).size, 4);
  assert.equal(full.revision, initial.revision + 1);
  assert.throws(() => applyActivityEdits(full, [{ type: 'addItem' }]), { code: 'ITEM_COUNT' });
  const reordered = applyActivityEdits(full, [{ type: 'moveItem', itemId: first.id, index: 19 }]);
  assert.deepEqual(reordered.items.at(-1), first);
  const reduced = applyActivityEdits(reordered, [{ type: 'removeItem', itemId: first.id }]);
  assert.equal(reduced.items.length, 19);
  assert.deepEqual(reduced.items, reordered.items.slice(0, 19));
  assert.equal(initial.items.length, 1);
});

test('las marcas son opcionales y se retiran del ítem editado al invalidar la revisión global', () => {
  const initial = confirmActivityReview(questionSet(2));
  const [first, second] = initial.items;
  const marked = applyActivityEdits(initial, [
    { type: 'markItemReviewed', itemId: first.id, reviewed: true },
    { type: 'markItemReviewed', itemId: second.id, reviewed: true }
  ]);
  assert.equal(marked.revision, initial.revision);
  assert.equal(marked.reviewedRevision, initial.reviewedRevision);
  const edited = applyActivityEdits(marked, [
    { type: 'setTitle', title: '  Guía   de   Física.h5p  ' },
    { type: 'setOptionText', itemId: first.id, optionId: first.correctOptionId, text: ' Fuerza neta ' }
  ]);
  assert.equal(edited.title, 'Guía de Física');
  assert.equal(edited.items[0].reviewed, undefined);
  assert.equal(edited.items[1].reviewed, true);
  assert.equal(edited.reviewedRevision, null);
  assert.equal(edited.revision, initial.revision + 1);
  assert.equal(toPackageItems(edited)[0].respuestaCorrecta, 'Fuerza neta');
  assert.equal(confirmActivityReview(edited).reviewedRevision, edited.revision);
});

test('los borradores admiten errores de campo mientras la confirmación exige contenido completo', () => {
  const initial = createEditableActivity({ activityType: 'multichoice', items: [question] });
  const [item] = initial.items;
  const [first, second] = item.options;
  const draft = applyActivityEdits(initial, [
    { type: 'setTitle', title: '' },
    { type: 'setItemText', itemId: item.id, field: 'question', text: ' ' },
    { type: 'setItemText', itemId: item.id, field: 'feedback', text: '' },
    { type: 'setCorrectOption', itemId: item.id, optionId: null },
    { type: 'setOptionText', itemId: item.id, optionId: second.id, text: '  fUeRZa  ' }
  ]);
  assert.deepEqual(getActivityIssues(draft), [
    { field: 'title', code: 'REQUIRED' },
    { itemId: item.id, field: 'question', code: 'REQUIRED' },
    { itemId: item.id, field: 'feedback', code: 'REQUIRED' },
    { itemId: item.id, field: 'correctOptionId', code: 'REQUIRED' },
    { itemId: item.id, optionId: first.id, field: 'text', code: 'DUPLICATE_OPTION' },
    { itemId: item.id, optionId: second.id, field: 'text', code: 'DUPLICATE_OPTION' }
  ]);
  assert.throws(() => confirmActivityReview(draft), { code: 'INVALID_CONTENT', issues: getActivityIssues(draft) });
  assert.throws(() => applyActivityEdits(initial, [{ type: 'addItem' }]), { code: 'ITEM_COUNT' });
});

test('TrueFalse distingue una respuesta pendiente de false y reporta cada feedback', () => {
  const activity = createEditableActivity({ activityType: 'truefalse', items: [{
    afirmacion: 'El newton mide tiempo.',
    esVerdadera: true,
    retroalimentacionCorrecta: 'Comentario 1',
    retroalimentacionIncorrecta: 'Comentario 2'
  }] });
  const itemId = activity.items[0].id;
  const incomplete = applyActivityEdits(activity, [
    { type: 'setTrueFalseAnswer', itemId, value: null },
    { type: 'setItemText', itemId, field: 'feedbackOnIncorrect', text: '' }
  ]);
  assert.deepEqual(getActivityIssues(incomplete), [
    { itemId, field: 'feedbackOnIncorrect', code: 'REQUIRED' },
    { itemId, field: 'isTrue', code: 'REQUIRED' }
  ]);
  const complete = applyActivityEdits(incomplete, [
    { type: 'setTrueFalseAnswer', itemId, value: false },
    { type: 'setItemText', itemId, field: 'feedbackOnIncorrect', text: 'El segundo mide tiempo.' }
  ]);
  assert.equal(toPackageItems(confirmActivityReview(complete))[0].esVerdadera, false);
});

test('un lote inválido se rechaza completo y las operaciones no aceptan IDs ajenos o claves adicionales', () => {
  const activity = questionSet(2);
  const [first, second] = activity.items;
  const original = structuredClone(activity);
  assert.throws(() => applyActivityEdits(activity, [
    { type: 'setTitle', title: 'Cambio inicial' },
    { type: 'setCorrectOption', itemId: first.id, optionId: second.correctOptionId }
  ]), { code: 'INVALID_OPERATION' });
  assert.deepEqual(activity, original);
  assert.throws(() => applyActivityEdits(activity, [{ type: 'setTitle', title: 'Válido', revision: 99 }]), { code: 'INVALID_OPERATION' });
  assert.throws(() => applyActivityEdits(activity, [{ type: 'setItemText', itemId: first.id, field: 'question', text: 'x'.repeat(2001) }]), { code: 'INVALID_OPERATION' });
  assert.throws(() => getActivityIssues({ ...activity, items: [first, first] }), { code: 'INVALID_EDITABLE' });
});
