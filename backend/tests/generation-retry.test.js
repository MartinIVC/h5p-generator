'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateQuestionsFromChunk } = require('../llmClient');
const questions = [{ pregunta: 'Pregunta', opciones: ['Uno', 'Dos', 'Tres', 'Cuatro'], respuestaCorrecta: 'Dos' }];
const success = () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(questions) }] } }] }) });
const generate = options => generateQuestionsFromChunk('texto sintético', 'clave-sintética', '', 1, options);
test('recupera dos fallos transitorios en una sola generación, con espera creciente', async () => {
  let calls = 0; const waits = [];
  const result = await generate({ fetch: async () => {
    calls++;
    if (calls === 1) throw new Error('dato privado de red');
    if (calls === 2) return { ok: false, status: 503 };
    return success();
  }, wait: async ms => waits.push(ms) });
  assert.deepEqual(result, questions); assert.equal(calls, 3);
  assert.equal(waits.length, 2); assert.ok(waits[0] >= 1000 && waits[0] < 1250); assert.ok(waits[1] >= 2000 && waits[1] < 2250);
});
test('limita los reintentos y no filtra errores de transporte', async () => {
  for (const [fetch, expected] of [[async () => { throw new Error('secreto'); }, 'NETWORK_ERROR'], [async () => ({ ok: false, status: 500 }), 'SERVICE_UNAVAILABLE']]) {
    let calls = 0;
    await assert.rejects(generate({ fetch: () => { calls++; return fetch(); }, wait: async () => {} }), { message: expected });
    assert.equal(calls, 3);
  }
});
test('no reintenta errores permanentes, cuota ni respuestas inválidas', async () => {
  for (const [status, message] of [[400, 'API_REQUEST_FAILED'], [401, 'API_KEY_INVALID'], [403, 'API_KEY_INVALID'], [404, 'API_REQUEST_FAILED'], [429, 'QUOTA']]) {
    let calls = 0;
    await assert.rejects(generate({ fetch: async () => { calls++; return { ok: false, status }; }, wait: async () => assert.fail('no debe esperar') }), { message });
    assert.equal(calls, 1);
  }
  await assert.rejects(generate({ fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('contenido privado'); } }), wait: async () => assert.fail() }), { message: 'INVALID_RESPONSE' });
});
test('cancelar durante la espera impide otro envío y diferencia timeout', async () => {
  for (const reason of [new DOMException('cancelado', 'AbortError'), new DOMException('tiempo', 'TimeoutError')]) {
    const controller = new AbortController(); let calls = 0;
    await assert.rejects(generate({ signal: controller.signal, fetch: async () => { calls++; return { ok: false, status: 503 }; }, wait: async () => { controller.abort(reason); controller.signal.throwIfAborted(); } }), { message: reason.name === 'TimeoutError' ? 'GENERATION_TIMEOUT' : 'GENERATION_CANCELLED' });
    assert.equal(calls, 1);
  }
});
