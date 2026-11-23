'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateQuestionsFromChunk } = require('../llmClient');
const questions = [{ pregunta: 'Pregunta', opciones: ['Uno', 'Dos', 'Tres', 'Cuatro'], respuestaCorrecta: 'Dos', retroalimentacion: 'Explicación de la respuesta.' }];
const success = () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(questions) }] } }] }) });
const generate = options => generateQuestionsFromChunk('texto sintético', 'clave-sintética', '', 1, options);
const primary = '/models/gemini-3.5-flash-lite:generateContent';
const backup = '/models/gemini-3.8-flash:generateContent';
test('recupera dos fallos transitorios en una sola generación, con espera creciente', async () => {
  const calls = []; const waits = [];
  const result = await generate({ fetch: async url => {
    calls.push(new URL(url).pathname.slice('/v1beta'.length));
    if (calls.length === 1) throw new Error('dato privado de red');
    if (calls.length === 2) return { ok: false, status: 503 };
    return success();
  }, wait: async ms => waits.push(ms) });
  assert.deepEqual(result, questions); assert.deepEqual(calls, [primary, primary, backup]);
  assert.equal(waits.length, 2); assert.ok(waits[0] >= 1000 && waits[0] < 1250); assert.ok(waits[1] >= 2000 && waits[1] < 2250);
});
test('usa el respaldo con el mismo esquema cuando el modelo no está disponible', async () => {
  const modelDenied = () => Response.json({ error: { details: [{ resourceName: 'models/gemini-3.5-flash-lite' }] } }, { status: 403 });
  for (const firstResponse of [() => new Response(null, { status: 404 }), modelDenied]) {
    const calls = [];
    const data = await generate({ fetch: async (url, request) => {
      calls.push({ path: new URL(url).pathname, body: request.body });
      return calls.length === 1 ? firstResponse() : success();
    }, wait: async () => assert.fail('cambio inmediato de modelo') });
    assert.deepEqual(data, questions);
    assert.deepEqual(calls.map(call => call.path), ['/v1beta' + primary, '/v1beta' + backup]);
    assert.equal(calls[0].body, calls[1].body);
  }
});
test('si ambos modelos son rechazados, no vuelve a consultar el primero', async () => {
  const calls = [];
  await assert.rejects(generate({ fetch: async url => {
    calls.push(new URL(url).pathname);
    return { ok: false, status: 404 };
  }, wait: async () => assert.fail('no debe esperar') }), { message: 'MODEL_UNAVAILABLE' });
  assert.deepEqual(calls, ['/v1beta' + primary, '/v1beta' + backup]);
});
test('limita los reintentos y no filtra errores de transporte', async () => {
  for (const [fetch, expected] of [[async () => { throw new Error('secreto'); }, 'NETWORK_ERROR'], [async () => ({ ok: false, status: 500 }), 'SERVICE_UNAVAILABLE']]) {
    let calls = 0;
    await assert.rejects(generate({ fetch: () => { calls++; return fetch(); }, wait: async () => {} }), { message: expected });
    assert.equal(calls, 3);
  }
});
test('no reintenta errores permanentes ni cuota', async () => {
  for (const [status, message] of [[400, 'API_REQUEST_FAILED'], [401, 'API_KEY_INVALID'], [403, 'API_ACCESS_DENIED'], [429, 'QUOTA']]) {
    let calls = 0;
    await assert.rejects(generate({ fetch: async () => { calls++; return { ok: false, status }; }, wait: async () => assert.fail('no debe esperar') }), { message });
    assert.equal(calls, 1);
  }
  await assert.rejects(generate({ fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('contenido privado'); } }), wait: async () => assert.fail() }), { message: 'INVALID_RESPONSE' });
});
test('el vencimiento de la solicitud mientras se lee el cuerpo permite reintentar', async t => {
  const nativeTimeout = AbortSignal.timeout;
  const attempts = [];
  t.mock.method(AbortSignal, 'timeout', ms => {
    if (ms !== 45000) return nativeTimeout(ms);
    const attempt = new AbortController();
    attempts.push(attempt);
    return attempt.signal;
  });
  let calls = 0;
  await assert.rejects(generate({ fetch: async () => {
    calls++;
    return { ok: true, json: async () => {
      attempts.at(-1).abort(new DOMException('tiempo', 'TimeoutError'));
      throw new Error('lectura interrumpida');
    } };
  }, wait: async () => {} }), { message: 'GENERATION_TIMEOUT' });
  assert.equal(calls, 3);
});
test('cancelar durante la espera impide otro envío y diferencia timeout', async () => {
  for (const reason of [new DOMException('cancelado', 'AbortError'), new DOMException('tiempo', 'TimeoutError')]) {
    const controller = new AbortController(); let calls = 0;
    await assert.rejects(generate({ signal: controller.signal, fetch: async () => { calls++; return { ok: false, status: 503 }; }, wait: async () => { controller.abort(reason); controller.signal.throwIfAborted(); } }), { message: reason.name === 'TimeoutError' ? 'GENERATION_TIMEOUT' : 'GENERATION_CANCELLED' });
    assert.equal(calls, 1);
  }
});
