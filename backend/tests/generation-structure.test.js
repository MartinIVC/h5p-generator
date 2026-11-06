'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateQuestionsFromChunk, validateQuestions } = require('../llmClient');
const one = { pregunta: 'Pregunta sintética', opciones: ['Uno', 'Dos', 'Tres', 'Cuatro'], respuestaCorrecta: 'Dos', retroalimentacion: 'Explicación de la respuesta.' };
const twenty = Array.from({ length: 20 }, (_, i) => ({ ...one, pregunta: `Pregunta ${i + 1}` }));
const response = value => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }) });
const run = options => generateQuestionsFromChunk('fuente sintética', 'clave-sintética', 'Dificultad media', 20, options);
const invalids = [
  [twenty.slice(1), 'COUNT'],
  [[{ ...one, opciones: ['Uno', 'Dos', 'Dos', 'Cuatro'] }, ...twenty.slice(1)], 'DUPLICATE_OPTIONS'],
  [[{ ...one, respuestaCorrecta: 'no pertenece' }, ...twenty.slice(1)], 'CORRECT_ANSWER'],
  [[{ ...one, opciones: ['Uno', 'Dos'] }, ...twenty.slice(1)], 'OPTIONS'],
  [[{ ...one, pregunta: '' }, ...twenty.slice(1)], 'QUESTION'],
  [[{ ...one, retroalimentacion: undefined }, ...twenty.slice(1)], 'FEEDBACK'],
  [[{ ...one, retroalimentacion: '   ' }, ...twenty.slice(1)], 'FEEDBACK'],
  [[{ ...one, retroalimentacion: '' }, ...twenty.slice(1)], 'FEEDBACK'],
  [[{ ...one, retroalimentacion: null }, ...twenty.slice(1)], 'FEEDBACK'],
  [[{ ...one, retroalimentacion: { texto: 'No es una cadena' } }, ...twenty.slice(1)], 'FEEDBACK'],
  [[{ ...one, retroalimentacion: 42 }, ...twenty.slice(1)], 'FEEDBACK'],
  [[{ ...one, retroalimentacion: 'x'.repeat(2001) }, ...twenty.slice(1)], 'FEEDBACK'],
  [{ preguntas: twenty }, 'STRUCTURE']
];
test('exige un esquema de 20 preguntas y conserva las instrucciones al corregir', async () => {
  for (const [invalid, reason] of invalids) {
    let calls = 0;
    const result = await run({ fetch: async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      const schema = body.generationConfig.responseJsonSchema;
      assert.equal(schema.minItems, 20); assert.equal(schema.maxItems, 20);
      assert.equal(schema.items.properties.opciones.minItems, 4);
      assert.equal(schema.items.properties.opciones.maxItems, 4);
      assert.deepEqual(schema.items.required, ['pregunta', 'opciones', 'respuestaCorrecta', 'retroalimentacion']);
      assert.equal(schema.items.properties.retroalimentacion.type, 'string');
      const parts = body.contents[0].parts.map(part => part.text);
      assert.match(parts[1], /Dificultad media/);
      if (calls === 2) assert.match(parts[3], /Corrección de formato:/);
      return response(calls === 1 ? invalid : twenty);
    } });
    assert.deepEqual(result, twenty); assert.equal(calls, 2, reason);
  }
});
test('dos respuestas inválidas terminan con motivo fijo sin aceptar contenido parcial', async () => {
  for (const [invalid, reason] of invalids) {
    let calls = 0;
    await assert.rejects(run({ fetch: async () => { calls++; return response(invalid); } }), error => {
      assert.equal(error.message, 'INVALID_RESPONSE'); assert.equal(error.reason, reason);
      assert.doesNotMatch(JSON.stringify(error), /fuente sintética|clave-sintética|Pregunta sintética|no pertenece/);
      return true;
    });
    assert.equal(calls, 2);
  }
});
test('JSON truncado y salida incompleta permiten una corrección; bloqueos no se reintentan', async () => {
  for (const payload of [
    { candidates: [{ content: { parts: [{ text: '[{"pregunta":' }] } }] },
    { candidates: [{ finishReason: 'MAX_TOKENS' }] },
    { candidates: [] }
  ]) {
    let calls = 0;
    assert.deepEqual(await run({ fetch: async () => ++calls === 1 ? { ok: true, json: async () => payload } : response(twenty) }), twenty);
    assert.equal(calls, 2);
  }
  let calls = 0;
  await assert.rejects(run({ fetch: async () => { calls++; return { ok: true, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }; } }), { message: 'INVALID_RESPONSE', reason: 'BLOCKED' });
  assert.equal(calls, 1);
});
test('comparte el límite total de tres solicitudes entre red y corrección', async () => {
  for (const sequence of [ [503, invalids[0][0], twenty], [503, 503, invalids[0][0]] ]) {
    let calls = 0;
    const pending = run({ fetch: async () => {
      const value = sequence[calls++];
      assert.ok(calls <= 3);
      return value === 503 ? { ok: false, status: 503 } : response(value);
    }, wait: async () => {} });
    if (sequence[2] === twenty) assert.deepEqual(await pending, twenty);
    else await assert.rejects(pending, { message: 'INVALID_RESPONSE', reason: 'COUNT' });
    assert.equal(calls, 3);
  }
});
test('cancelación tras respuesta inválida impide enviar la corrección', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(run({ signal: controller.signal, fetch: async () => {
    calls++;
    return { ok: true, json: async () => { controller.abort(); return {}; } };
  } }), { message: 'GENERATION_CANCELLED' });
  assert.equal(calls, 1);
});
test('no corrige ni inventa la opción correcta al validar preguntas', () => {
  assert.throws(() => validateQuestions([{ ...one, respuestaCorrecta: 'B', retroalimentacion: 'Explicación de la respuesta.' }], 1), { message: 'INVALID_RESPONSE', reason: 'CORRECT_ANSWER' });
});
test('valida los límites y conserva la retroalimentación sin alterar su contenido', () => {
  const feedback = 'x'.repeat(2000);
  assert.equal(validateQuestions([{ ...one, retroalimentacion: feedback }], 1)[0].retroalimentacion, feedback);
  assert.equal(validateQuestions([{ ...one, retroalimentacion: '  Explicación válida.  ' }], 1)[0].retroalimentacion, 'Explicación válida.');
});
test('impide empaquetar cantidades fuera del contrato aunque coincidan con el array', () => {
  for (const count of [0, 21]) {
    assert.throws(() => validateQuestions(Array.from({ length: count }, () => one), count), { message: 'INVALID_RESPONSE', reason: 'COUNT' });
  }
});
test('rechaza JSON envuelto en Markdown sin extraerlo ni reparar la respuesta', async () => {
  let calls = 0;
  const wrapped = { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(twenty) + '\n```' }] } }] }) };
  await assert.rejects(run({ fetch: async () => { calls++; return wrapped; } }), { message: 'INVALID_RESPONSE', reason: 'JSON' });
  assert.equal(calls, 2);
});
