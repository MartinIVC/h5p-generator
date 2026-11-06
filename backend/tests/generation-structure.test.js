'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateQuestionsFromChunk, validateQuestions } = require('../llmClient');
const one = { pregunta: 'Pregunta sintética', opciones: ['Uno', 'Dos', 'Tres', 'Cuatro'], respuestaCorrecta: 'Dos' };
const twenty = Array.from({ length: 20 }, (_, i) => ({ ...one, pregunta: `Pregunta ${i + 1}` }));
const response = value => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }) });
const run = options => generateQuestionsFromChunk('fuente sintética', 'clave-sintética', 'Dificultad media', 20, options);
const invalids = [
  [twenty.slice(1), 'COUNT'],
  [[{ ...one, opciones: ['Uno', 'Dos', 'Dos', 'Cuatro'] }, ...twenty.slice(1)], 'DUPLICATE_OPTIONS'],
  [[{ ...one, respuestaCorrecta: 'no pertenece' }, ...twenty.slice(1)], 'CORRECT_ANSWER'],
  [[{ ...one, opciones: ['Uno', 'Dos'] }, ...twenty.slice(1)], 'OPTIONS'],
  [[{ ...one, pregunta: '' }, ...twenty.slice(1)], 'QUESTION'],
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
      assert.deepEqual(schema.items.required, ['pregunta', 'opciones', 'respuestaCorrecta']);
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
  assert.throws(() => validateQuestions([{ ...one, respuestaCorrecta: 'B' }], 1), { message: 'INVALID_RESPONSE', reason: 'CORRECT_ANSWER' });
});
