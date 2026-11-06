'use strict';

const MAX_SOURCE_CHARS = 200000;
const { setTimeout: delay } = require('node:timers/promises');
const MODEL = 'gemini-2.5-flash';
const { buildQuestionPrompt } = require('./prompts');

// Solo códigos y mensajes fijos: nunca se adjunta la respuesta del proveedor.
const RESPONSE_REASONS = Object.freeze({
  JSON: 'La respuesta no contiene JSON válido.',
  STRUCTURE: 'La respuesta no tiene la estructura de preguntas requerida.',
  COUNT: 'La cantidad de preguntas no coincide con la solicitada.',
  QUESTION: 'Hay una pregunta vacía o demasiado extensa.',
  OPTIONS: 'Cada pregunta debe tener cuatro opciones no vacías de hasta 1000 caracteres.',
  DUPLICATE_OPTIONS: 'Una pregunta tiene opciones repetidas.',
  CORRECT_ANSWER: 'La respuesta correcta no coincide exactamente con una opción.',
  FEEDBACK: 'Cada pregunta debe incluir una explicación formativa no vacía de hasta 2000 caracteres.',
  INCOMPLETE: 'Gemini interrumpió la respuesta por el límite de salida.',
  BLOCKED: 'Gemini no pudo completar la respuesta por sus restricciones de contenido.',
  EMPTY: 'Gemini devolvió una respuesta vacía.',
  TOO_LARGE: 'La respuesta supera el tamaño permitido.'
});
function invalidResponse(reason) {
  const error = new Error('INVALID_RESPONSE');
  error.reason = reason;
  return error;
}
function questionSchema(count) {
  return {
    type: 'array', minItems: count, maxItems: count,
    items: {
      type: 'object', additionalProperties: false,
      required: ['pregunta', 'opciones', 'respuestaCorrecta', 'retroalimentacion'],
      properties: {
        pregunta: { type: 'string', description: 'Pregunta no vacía de hasta 2000 caracteres.' },
        opciones: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' }, description: 'Cuatro textos distintos, sin enumeración, de hasta 1000 caracteres cada uno.' },
        respuestaCorrecta: { type: 'string', description: 'Copia exacta del texto de una de las cuatro opciones.' },
        retroalimentacion: { type: 'string', description: 'Explicación formativa no vacía, fundamentada en el material, de hasta 2000 caracteres.' }
      }
    }
  };
}
function validateQuestions(value, count) {
  if (!Array.isArray(value)) throw invalidResponse('STRUCTURE');
  if (value.length !== count) throw invalidResponse('COUNT');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some(key => !['pregunta', 'opciones', 'respuestaCorrecta', 'retroalimentacion'].includes(key))) throw invalidResponse('STRUCTURE');
    if (typeof item.pregunta !== 'string' || !item.pregunta.trim() || item.pregunta.length > 2000) throw invalidResponse('QUESTION');
    if (!Array.isArray(item.opciones) || item.opciones.length !== 4 ||
        item.opciones.some(option => typeof option !== 'string' || !option.trim() || option.length > 1000)) throw invalidResponse('OPTIONS');
    if (typeof item.respuestaCorrecta !== 'string') throw invalidResponse('CORRECT_ANSWER');
    if (typeof item.retroalimentacion !== 'string' || !item.retroalimentacion.trim() || item.retroalimentacion.length > 2000) throw invalidResponse('FEEDBACK');
    let options = item.opciones.map(option => option.trim());
    const correctIndex = options.indexOf(item.respuestaCorrecta.trim());
    if (correctIndex < 0) throw invalidResponse('CORRECT_ANSWER');
    // Solo elimina una enumeración completa A-D; preserva iniciales aisladas.
    const prefixes = options.map(option => option.match(/^(?:\(([a-d])\)|([a-d])[.):\-])\s+(?=\S)/i));
    if (prefixes.every(Boolean) && new Set(prefixes.map(match => (match[1] || match[2]).toUpperCase())).size === 4) {
      options = options.map((option, index) => option.slice(prefixes[index][0].length).trim());
    }
    if (new Set(options.map(option => option.toLocaleLowerCase('es'))).size !== 4) throw invalidResponse('DUPLICATE_OPTIONS');
    return { pregunta: item.pregunta.trim(), opciones: options, respuestaCorrecta: options[correctIndex], retroalimentacion: item.retroalimentacion.trim() };
  });
}
function parseQuestions(payload, count) {
  if (payload?.promptFeedback?.blockReason) throw invalidResponse('BLOCKED');
  const candidate = payload?.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') throw invalidResponse('INCOMPLETE');
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw invalidResponse('BLOCKED');
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) throw invalidResponse('EMPTY');
  const raw = parts.filter(part => part && !part.thought && typeof part.text === 'string').map(part => part.text).join('');
  if (!raw.trim()) throw invalidResponse('EMPTY');
  if (raw.length > 200000) throw invalidResponse('TOO_LARGE');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw invalidResponse('JSON'); }
  return validateQuestions(parsed, count);
}

async function generateQuestionsFromChunk(text, apiKey, instructions = '', count = 2, options = {}) {
  if (!apiKey || typeof text !== 'string' || !text.trim() || text.length > MAX_SOURCE_CHARS ||
      !Number.isInteger(count) || count < 1 || count > 20 || typeof instructions !== 'string' || instructions.length > 10000) throw new Error('INVALID_ARGUMENT');
  const prompt = buildQuestionPrompt({ text, instructions, count });
  // Un presupuesto total para solicitudes y esperas; navegar/cerrar cancela todo.
  const signal = AbortSignal.any([options.signal || new AbortController().signal, AbortSignal.timeout(90000)]);
  const wait = options.wait || ((ms, signal) => delay(ms, undefined, { signal }));
  let correction = '';
  let correctionsUsed = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      signal.throwIfAborted();
      let response;
      try {
        response = await (options.fetch || fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ ...prompt, contents: [{ ...prompt.contents[0], parts: [...prompt.contents[0].parts, ...(correction ? [{ text: correction }] : [])] }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: questionSchema(count) } }),
          signal
        });
      } catch { signal.throwIfAborted(); throw new Error('NETWORK_ERROR'); }
      if (!response.ok) {
        // No conservar ni mostrar cuerpos de error del proveedor.
        await response.body?.cancel().catch(() => {});
        if ([401, 403].includes(response.status)) throw new Error('API_KEY_INVALID');
        if (response.status === 429) throw new Error('QUOTA');
        if ([408, 500, 502, 503, 504].includes(response.status)) throw new Error('SERVICE_UNAVAILABLE');
        throw new Error('API_REQUEST_FAILED');
      }
      let payload;
      try { payload = await response.json(); }
      catch (error) {
        signal.throwIfAborted();
        throw error instanceof SyntaxError ? invalidResponse('JSON') : new Error('NETWORK_ERROR');
      }
      signal.throwIfAborted();
      return parseQuestions(payload, count);
    } catch (error) {
      if (signal.aborted) throw new Error(signal.reason?.name === 'TimeoutError' ? 'GENERATION_TIMEOUT' : 'GENERATION_CANCELLED');
      if (error.message === 'INVALID_RESPONSE') {
        if (error.reason === 'BLOCKED' || correctionsUsed >= 1 || attempt === 2) throw error;
        correctionsUsed++;
        // Regenera desde la fuente original y un diagnóstico fijo, sin reenviar
        // contenido defectuoso ni adivinar/cambiar respuestas correctas.
        correction = `\nCorrección de formato: ${RESPONSE_REASONS[error.reason]} Genera de nuevo exactamente ${count} preguntas completas y concisas siguiendo el esquema. Verifica opciones distintas y copia exactamente la opción correcta.`;
        continue;
      }
      if (!['NETWORK_ERROR', 'SERVICE_UNAVAILABLE'].includes(error.message) || attempt === 2) throw error;
      try { await wait(1000 * 2 ** attempt + Math.floor(Math.random() * 250), signal); }
      catch { throw new Error(signal.reason?.name === 'TimeoutError' ? 'GENERATION_TIMEOUT' : 'GENERATION_CANCELLED'); }
    }
  }
}

module.exports = { generateQuestionsFromChunk, validateQuestions, MAX_SOURCE_CHARS, RESPONSE_REASONS };
