'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyGeminiKey } = require('../gemini');

test('comprueba la clave con el modelo de respaldo cuando el principal devuelve 404', async () => {
  const paths = [];
  const status = await verifyGeminiKey('clave-sintética', { fetch: async url => {
    paths.push(new URL(url).pathname);
    return paths.length === 1 ? new Response(null, { status: 404 }) : new Response('{}');
  } });
  assert.equal(status, 'valid');
  assert.deepEqual(paths, ['/v1beta/models/gemini-3.5-flash-lite:generateContent', '/v1beta/models/gemini-3.8-flash:generateContent']);
});

test('distingue clave inválida, acceso denegado y cuota, sin consultar otro modelo', async () => {
  for (const [httpStatus, reason, expected] of [
    [400, 'API_KEY_INVALID', 'invalid'], [400, undefined, 'error'],
    [403, 'ACCESS_DENIED', 'denied'], [429, undefined, 'quota']
  ]) {
    let calls = 0;
    const status = await verifyGeminiKey('clave-sintética', { fetch: async () => {
      calls++;
      return Response.json({ error: { message: 'detalle privado', details: [{ reason }] } }, { status: httpStatus });
    } });
    assert.equal(status, expected);
    assert.equal(calls, 1);
  }
});

test('informa ausencia de modelos y respeta el presupuesto total de verificación', async () => {
  let calls = 0;
  assert.equal(await verifyGeminiKey('clave-sintética', { fetch: async () => {
    calls++;
    return new Response(null, { status: 404 });
  } }), 'unavailable');
  assert.equal(calls, 2);
  const controller = new AbortController();
  calls = 0;
  assert.equal(await verifyGeminiKey('clave-sintética', { signal: controller.signal, fetch: async () => {
    calls++;
    controller.abort(new DOMException('tiempo', 'TimeoutError'));
    return new Response(null, { status: 404 });
  } }), 'error');
  assert.equal(calls, 1);
});
