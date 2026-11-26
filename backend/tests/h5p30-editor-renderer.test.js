'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEditableActivity } = require('../editor/editableActivity');
const EditorState = require('../../frontend/js/editor/editorState');
const EditorAutosave = require('../../frontend/js/editor/editorAutosave');
const EditorForms = require('../../frontend/js/editor/editorForms');

function makeQuestionSet() {
  return createEditableActivity({
    activityType: 'questionset',
    title: 'Cuestionario sintético',
    items: [
      {
        pregunta: '¿Qué es integridad?',
        opciones: ['Exactitud', 'Velocidad', 'Tamaño', 'Color'],
        respuestaCorrecta: 'Exactitud',
        retroalimentacion: 'Protege exactitud.'
      },
      {
        pregunta: '¿Qué es disponibilidad?',
        opciones: ['Acceso oportuno', 'Cifrado', 'Formato', 'Compresión'],
        respuestaCorrecta: 'Acceso oportuno',
        retroalimentacion: 'Asegura acceso oportuno.'
      }
    ]
  });
}

function makeMultiChoice() {
  return createEditableActivity({
    activityType: 'multichoice',
    title: 'Reactivo único',
    items: [{
      pregunta: '¿Cuál protocolo cifra el tráfico web?',
      opciones: ['TLS', 'ICMP', 'ARP', 'DHCP'],
      respuestaCorrecta: 'TLS',
      retroalimentacion: 'TLS cifra el transporte.'
    }]
  });
}

function makeTrueFalse() {
  return createEditableActivity({
    activityType: 'truefalse',
    title: 'Afirmación de red',
    items: [{
      afirmacion: 'UDP garantiza entrega ordenada.',
      esVerdadera: false,
      retroalimentacionCorrecta: 'Correcto, UDP no garantiza orden.',
      retroalimentacionIncorrecta: 'Incorrecto, TCP es quien garantiza orden.'
    }]
  });
}

test('editorState calcula errores locales, navega al primer error y aplica ediciones optimistas en los 3 formatos', () => {
  // QuestionSet
  const qs = makeQuestionSet();
  let state = EditorState.createEditorState({ sessionId: 's1', draftId: 'd1', activity: qs });
  assert.deepEqual(state.issues, []);
  assert.equal(state.activeItemId, qs.items[0].id);

  // Mover pregunta 2 al principio conserva IDs estables y anula revisión
  const moved = EditorState.applyOptimisticOperation(state.activity, {
    type: 'moveItem',
    itemId: qs.items[1].id,
    index: 0
  });
  assert.equal(moved.changed, true);
  assert.equal(moved.activity.items[0].id, qs.items[1].id);
  assert.equal(moved.activity.items[1].id, qs.items[0].id);

  // Duplicar opción en la pregunta 2 (ahora en índice 0) produce error apuntando al optionId exacto
  const targetItem = moved.activity.items[0];
  const duped = EditorState.applyOptimisticOperation(moved.activity, {
    type: 'setOptionText',
    itemId: targetItem.id,
    optionId: targetItem.options[1].id,
    text: '  acceso oportuno  '
  });
  state.activity = duped.activity;
  state.issues = EditorState.computeLocalIssues(state.activity);
  assert.equal(state.issues.length, 2);
  assert.equal(state.issues[0].code, 'DUPLICATE_OPTION');
  const firstTarget = EditorState.getFirstIssueTarget(state);
  assert.equal(firstTarget.itemId, targetItem.id);
  assert.equal(firstTarget.selector, `#editor-option-${targetItem.options[0].id}`);

  // MultiChoice: renombrar la opción correcta conserva correctOptionId
  const mc = makeMultiChoice();
  const mcCorrectId = mc.items[0].correctOptionId;
  const renamed = EditorState.applyOptimisticOperation(mc, {
    type: 'setOptionText',
    itemId: mc.items[0].id,
    optionId: mcCorrectId,
    text: 'TLS 1.3'
  });
  assert.equal(renamed.activity.items[0].correctOptionId, mcCorrectId);
  assert.equal(EditorState.computeLocalIssues(renamed.activity).length, 0);

  // TrueFalse: conserva false sin error y detecta null o feedbacks vacíos
  const tf = makeTrueFalse();
  assert.equal(tf.items[0].isTrue, false);
  assert.equal(EditorState.computeLocalIssues(tf).length, 0);
  const tfPending = EditorState.applyOptimisticOperation(tf, {
    type: 'setTrueFalseAnswer',
    itemId: tf.items[0].id,
    value: null
  });
  const tfIssues = EditorState.computeLocalIssues(tfPending.activity);
  assert.deepEqual(tfIssues, [{ itemId: tf.items[0].id, field: 'isTrue', code: 'REQUIRED' }]);
  assert.equal(EditorState.getFirstIssueTarget({ activity: tfPending.activity, issues: tfIssues }).selector, '#editor-tf-true');
});

test('editorAutosave agrupa ediciones en 350 ms, espera flush y reintenta sin perder cambios ante error', async () => {
  const scheduled = [];
  const states = [];
  const sentBatches = [];
  let revision = 1;
  let shouldFail = false;

  const queue = EditorAutosave.createAutosaveQueue({
    debounceMs: 350,
    getRevision: () => revision,
    setTimer: (fn, ms) => {
      const id = scheduled.length + 1;
      scheduled.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimer: id => {
      const entry = scheduled.find(item => item.id === id);
      if (entry) entry.cleared = true;
    },
    onStateChange: s => states.push(s),
    onSynced: res => { revision = res.activity.revision; },
    sendUpdate: async ({ expectedRevision, operations }) => {
      sentBatches.push({ expectedRevision, operations });
      if (shouldFail) return { status: 'error', code: 'PERSISTENCE_FAILED', message: 'Fallo temporal' };
      return { status: 'ok', activity: { revision: expectedRevision + 1, items: [] }, issues: [] };
    }
  });

  // Ediciones consecutivas sobre el mismo campo se coalescen en 1 sola operación
  queue.enqueue({ type: 'setTitle', title: 'T' });
  queue.enqueue({ type: 'setTitle', title: 'Tí' });
  queue.enqueue({ type: 'setTitle', title: 'Título final' });
  assert.equal(scheduled.at(-1).ms, 350);
  assert.equal(queue.getPendingCount(), 1);

  const flushed = await queue.flush();
  assert.equal(flushed.ok, true);
  assert.equal(revision, 2);
  assert.equal(sentBatches.length, 1);
  assert.deepEqual(sentBatches[0], {
    expectedRevision: 1,
    operations: [{ type: 'setTitle', title: 'Título final' }]
  });

  // Fallo de persistencia conserva el lote fallido + ediciones posteriores para reintentar
  shouldFail = true;
  queue.enqueue({ type: 'setTitle', title: 'Cambio 1' });
  const failed = await queue.flush();
  assert.equal(failed.ok, false);
  assert.equal(queue.hasFailed(), true);
  assert.equal(states.at(-1), 'error');

  shouldFail = false;
  queue.enqueue({ type: 'setTitle', title: 'Cambio 2' });
  const recovered = await queue.retry();
  assert.equal(recovered.ok, true);
  assert.equal(revision, 3);
  assert.equal(queue.hasFailed(), false);
  assert.equal(sentBatches.at(-1).operations.at(-1).title, 'Cambio 2');
});

test('editorForms renderiza QuestionSet con índice lateral y barra compacta (< 760px), y formatos de 1 elemento directamente', () => {
  const qsState = EditorState.createEditorState({ sessionId: 's1', draftId: 'd1', activity: makeQuestionSet() });
  const qsHtml = EditorForms.renderEditorTemplate(qsState);
  assert.match(qsHtml, /editor-question-sidebar/);
  assert.match(qsHtml, /editor-compact-nav/);
  assert.match(qsHtml, /id="editor-question-select"/);
  assert.match(qsHtml, /id="btn-editor-prev-item"/);
  assert.match(qsHtml, /id="btn-editor-next-item"/);
  assert.match(qsHtml, /id="btn-editor-move-up"/);
  assert.match(qsHtml, /id="btn-editor-add-item"/);
  assert.match(qsHtml, /is-questionset/);

  qsState.isCompact = true;
  const compactHtml = EditorForms.renderEditorTemplate(qsState);
  assert.match(compactHtml, /editor-panel-card is-compact is-questionset/);

  // MultiChoice: sin índice lateral ni selector compacto, formulario directo
  const mcState = EditorState.createEditorState({ sessionId: 's2', draftId: 'd2', activity: makeMultiChoice() });
  const mcHtml = EditorForms.renderEditorTemplate(mcState);
  assert.doesNotMatch(mcHtml, /editor-question-sidebar/);
  assert.doesNotMatch(mcHtml, /editor-compact-nav/);
  assert.match(mcHtml, /data-form-type="choice"/);
  assert.match(mcHtml, /is-single-item/);

  // TrueFalse: formulario directo con radio Verdadero y Falso marcado en false
  const tfState = EditorState.createEditorState({ sessionId: 's3', draftId: 'd3', activity: makeTrueFalse() });
  const tfHtml = EditorForms.renderEditorTemplate(tfState);
  assert.doesNotMatch(tfHtml, /editor-question-sidebar/);
  assert.match(tfHtml, /data-form-type="truefalse"/);
  assert.match(tfHtml, /id="editor-tf-false"[\s\S]*checked/);
  assert.match(tfHtml, /id="editor-feedback-correct"/);
  assert.match(tfHtml, /id="editor-feedback-incorrect"/);
});
