'use strict';

const MODELS = Object.freeze(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
const CAPACITY_UNAVAILABLE = 'CAPACITY_UNAVAILABLE';

function canSwitchModel(error) {
  return error.message === 'MODEL_UNAVAILABLE' || error.message === CAPACITY_UNAVAILABLE;
}

async function readErrorDetails(response) {
  try {
    const { error } = await response.json();
    return Array.isArray(error?.details) ? error.details : [];
  } catch {
    return [];
  }
}

function refersToModel(detail, model) {
  const names = [detail?.metadata?.model, detail?.metadata?.resource, detail?.resourceName];
  return names.some(name => name === model || name === `models/${model}` ||
    name === `//generativelanguage.googleapis.com/models/${model}`);
}

async function getFailureCode(response, model) {
  if (response.status === 400 || response.status === 403) {
    // Solo se consultan campos estructurados. Nunca se propaga el cuerpo ni el mensaje de Gemini.
    const details = await readErrorDetails(response);
    if (details.some(detail => detail?.reason === 'API_KEY_INVALID')) return 'API_KEY_INVALID';
    if (response.status === 403) {
      return details.some(detail => refersToModel(detail, model)) ? 'MODEL_UNAVAILABLE' : 'API_ACCESS_DENIED';
    }
  }
  if (response.status === 401) return 'API_KEY_INVALID';
  if (response.status === 404) return 'MODEL_UNAVAILABLE';
  if (response.status === 429) return 'QUOTA';
  if (response.status === 503) return CAPACITY_UNAVAILABLE;
  if ([408, 500, 502, 504].includes(response.status)) return 'SERVICE_UNAVAILABLE';
  return 'API_REQUEST_FAILED';
}

async function requestGemini(model, apiKey, body, signal, fetchRequest = fetch) {
  signal.throwIfAborted();
  let response;
  try {
    response = await fetchRequest(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal
    });
  } catch {
    signal.throwIfAborted();
    throw new Error('NETWORK_ERROR');
  }
  if (response.ok) return response;

  const code = await getFailureCode(response, model);
  if (!response.bodyUsed) await response.body?.cancel().catch(() => {});
  signal.throwIfAborted();
  throw new Error(code);
}

async function verifyGeminiKey(apiKey, { fetch: fetchRequest, signal = AbortSignal.timeout(15000) } = {}) {
  const body = {
    contents: [{ parts: [{ text: 'Responde OK.' }] }],
    generationConfig: { maxOutputTokens: 64, thinkingConfig: { thinkingLevel: 'LOW' } }
  };
  for (const model of MODELS) {
    // Reserva parte del presupuesto para el segundo modelo si el primero no responde.
    const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(7500)]);
    try {
      const response = await requestGemini(model, apiKey, body, attemptSignal, fetchRequest);
      await response.body?.cancel().catch(() => {});
      attemptSignal.throwIfAborted();
      return 'valid';
    } catch (error) {
      if (signal.aborted) return 'error';
      if (canSwitchModel(error) || attemptSignal.aborted) continue;
      if (error.message === 'API_KEY_INVALID') return 'invalid';
      if (error.message === 'API_ACCESS_DENIED') return 'denied';
      if (error.message === 'QUOTA') return 'quota';
      return 'error';
    }
  }
  return 'unavailable';
}

module.exports = { MODELS, CAPACITY_UNAVAILABLE, canSwitchModel, requestGemini, verifyGeminiKey };
