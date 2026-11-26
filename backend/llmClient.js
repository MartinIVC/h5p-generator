'use strict';

const MAX_SOURCE_CHARS = 200000;
const { setTimeout: delay } = require('node:timers/promises');
const { MODELS, CAPACITY_UNAVAILABLE, canSwitchModel, requestGemini } = require('./gemini');
const { invalidResponse, validateQuestions, validateActivityItems } = require('./activityValidation');
const {
  ACTIVITY_SPECS,
  resolveActivityType,
  isValidActivityCount,
  buildActivityPrompt
} = require('./prompts');

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
  TOO_LARGE: 'La respuesta supera el tamaño permitido.',
  ITEM_FIELD: 'Uno o más elementos tienen campos vacíos o demasiado extensos.',
  DUPLICATE_ITEMS: 'La respuesta contiene elementos repetidos.',
  BLANK_SYNTAX: 'Los enunciados con espacios deben incluir contexto válido y una respuesta sin caracteres reservados.',
  WORD_FORMAT: 'Cada palabra debe ser un único término alfabético de entre 3 y 18 letras, sin espacios ni signos.',
  DISCONNECTED_WORDS: 'Las palabras del crucigrama deben compartir letras suficientes para cruzarse en una cuadrícula.'
});

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

function activitySchema(activityType, count) {
  const canonical = resolveActivityType(activityType);
  if (!canonical) throw new Error('INVALID_ARGUMENT');

  switch (canonical) {
    case 'questionset':
    case 'multichoice':
      return questionSchema(count);

    case 'truefalse':
      return {
        type: 'array', minItems: count, maxItems: count,
        items: {
          type: 'object', additionalProperties: false,
          required: ['afirmacion', 'esVerdadera', 'retroalimentacionCorrecta', 'retroalimentacionIncorrecta'],
          properties: {
            afirmacion: { type: 'string', description: 'Afirmación conceptual clara y verificable de hasta 2000 caracteres.' },
            esVerdadera: { type: 'boolean', description: 'true si la afirmación es verdadera según el material, false si es falsa.' },
            retroalimentacionCorrecta: { type: 'string', description: 'Explicación formativa cuando el estudiante responde correctamente (hasta 2000 caracteres).' },
            retroalimentacionIncorrecta: { type: 'string', description: 'Explicación formativa cuando el estudiante falla (hasta 2000 caracteres).' }
          }
        }
      };

    case 'singlechoiceset':
      return {
        type: 'array', minItems: count, maxItems: count,
        items: {
          type: 'object', additionalProperties: false,
          required: ['pregunta', 'opciones', 'respuestaCorrecta'],
          properties: {
            pregunta: { type: 'string', description: 'Pregunta breve y directa de hasta 2000 caracteres.' },
            opciones: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' }, description: 'Cuatro alternativas distintas, sin prefijos de enumeración.' },
            respuestaCorrecta: { type: 'string', description: 'Copia exacta de la alternativa correcta.' }
          }
        }
      };

    case 'blanks':
      return {
        type: 'array', minItems: count, maxItems: count,
        items: {
          type: 'object', additionalProperties: false,
          required: ['textoAntes', 'respuesta', 'textoDespues', 'pista'],
          properties: {
            textoAntes: { type: 'string', description: 'Fragmento previo al espacio en blanco, sin asteriscos ni saltos de línea.' },
            respuesta: { type: 'string', description: 'Término o frase breve exacta que completa el espacio (1 a 120 caracteres, sin *, : ni /).' },
            textoDespues: { type: 'string', description: 'Fragmento posterior al espacio en blanco, sin asteriscos ni saltos de línea.' },
            pista: { type: 'string', description: 'Pista breve opcional (sin * ni :) o cadena vacía.' }
          }
        }
      };

    case 'dragtext':
      return {
        type: 'array', minItems: count, maxItems: count,
        items: {
          type: 'object', additionalProperties: false,
          required: ['textoAntes', 'palabra', 'textoDespues', 'pista'],
          properties: {
            textoAntes: { type: 'string', description: 'Fragmento previo a la palabra arrastrable, sin asteriscos ni saltos de línea.' },
            palabra: { type: 'string', description: 'Palabra o término breve arrastrable (1 a 80 caracteres, sin *, : ni \\).' },
            textoDespues: { type: 'string', description: 'Fragmento posterior a la palabra arrastrable, sin asteriscos ni saltos de línea.' },
            pista: { type: 'string', description: 'Pista breve opcional (sin *, : ni \\) o cadena vacía.' }
          }
        }
      };

    case 'summary':
      return {
        type: 'array', minItems: count, maxItems: count,
        items: {
          type: 'object', additionalProperties: false,
          required: ['afirmacionCorrecta', 'distractores', 'pista'],
          properties: {
            afirmacionCorrecta: { type: 'string', description: 'Afirmación verdadera que resume una idea clave del material (hasta 600 caracteres).' },
            distractores: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string' }, description: 'Dos afirmaciones plausibles pero incorrectas y distintas entre sí.' },
            pista: { type: 'string', description: 'Pista breve opcional o cadena vacía.' }
          }
        }
      };

    case 'sortparagraphs':
      return {
        type: 'array', minItems: count, maxItems: count,
        items: {
          type: 'object', additionalProperties: false,
          required: ['parrafo'],
          properties: {
            parrafo: { type: 'string', description: 'Párrafo o paso breve en el orden lógico correcto, sin numeración explícita (hasta 1000 caracteres).' }
          }
        }
      };

    case 'crossword':
      return {
        type: 'array', minItems: count, maxItems: count,
        items: {
          type: 'object', additionalProperties: false,
          required: ['pista', 'palabra'],
          properties: {
            pista: { type: 'string', description: 'Definición o pista clara sin revelar la palabra (hasta 300 caracteres).' },
            palabra: { type: 'string', description: 'Una sola palabra de 3 a 18 letras españolas (A-Z y Ñ), sin espacios ni signos.' }
          }
        }
      };

    case 'findthewords':
      return {
        type: 'array', minItems: count, maxItems: count,
        items: {
          type: 'object', additionalProperties: false,
          required: ['palabra'],
          properties: {
            palabra: { type: 'string', description: 'Una sola palabra clave de 3 a 18 letras (a-z y ñ), sin espacios ni signos.' }
          }
        }
      };

    case 'accordion':
      return {
        type: 'array', minItems: count, maxItems: count,
        items: {
          type: 'object', additionalProperties: false,
          required: ['titulo', 'explicacion'],
          properties: {
            titulo: { type: 'string', description: 'Título conciso y único del concepto o pregunta guía (hasta 160 caracteres).' },
            explicacion: { type: 'string', description: 'Explicación clara y fundamentada en el material (hasta 2000 caracteres).' }
          }
        }
      };

    case 'flashcards':
      return {
        type: 'array', minItems: count, maxItems: count,
        items: {
          type: 'object', additionalProperties: false,
          required: ['pregunta', 'respuesta', 'pista'],
          properties: {
            pregunta: { type: 'string', description: 'Enunciado o pregunta breve de repaso activo (hasta 600 caracteres).' },
            respuesta: { type: 'string', description: 'Respuesta corta y exacta de 1 a 4 palabras (hasta 200 caracteres).' },
            pista: { type: 'string', description: 'Pista breve opcional o cadena vacía (hasta 300 caracteres).' }
          }
        }
      };

    default:
      throw new Error('INVALID_ARGUMENT');
  }
}

function parseActivityResponse(payload, activityType, count) {
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
  return validateActivityItems(activityType, parsed, count);
}

function buildCorrectionInstruction(activityType, reason, count) {
  const detail = RESPONSE_REASONS[reason] || RESPONSE_REASONS.STRUCTURE;
  if (activityType === 'questionset' || activityType === 'multichoice') {
    return `\nCorrección de formato: ${detail} Genera de nuevo exactamente ${count} preguntas completas y concisas siguiendo el esquema. Verifica opciones distintas y copia exactamente la opción correcta.`;
  }
  const spec = ACTIVITY_SPECS[activityType];
  const unit = count === 1 ? spec.unitSingular : spec.unitPlural;
  return `\nCorrección de formato: ${detail} Genera de nuevo exactamente ${count} ${unit} completos y concisos siguiendo estrictamente el esquema JSON de ${spec.label}.`;
}

async function generateQuestionsFromChunk(text, apiKey, instructions = '', count = 2, options = {}) {
  const canonicalType = resolveActivityType(options.activityType || 'questionset');
  if (!canonicalType || !apiKey || typeof text !== 'string' || !text.trim() || text.length > MAX_SOURCE_CHARS ||
      !isValidActivityCount(canonicalType, count) || typeof instructions !== 'string' || instructions.length > 10000) {
    throw new Error('INVALID_ARGUMENT');
  }
  const prompt = buildActivityPrompt({ activityType: canonicalType, text, instructions, count });
  const schema = activitySchema(canonicalType, count);
  // Un presupuesto total para solicitudes y esperas; navegar/cerrar cancela todo.
  const signal = AbortSignal.any([options.signal || new AbortController().signal, AbortSignal.timeout(90000)]);
  const wait = options.wait || ((ms, signal) => delay(ms, undefined, { signal }));
  let correction = '';
  let correctionsUsed = 0;
  let modelIndex = 0;
  const retryable = ['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', CAPACITY_UNAVAILABLE, 'GENERATION_TIMEOUT'];
  for (let attempt = 0; attempt < 3; attempt++) {
    const lastAttempt = attempt === 2;
    const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
    try {
      const response = await requestGemini(MODELS[modelIndex], apiKey, {
        ...prompt,
        contents: [{ ...prompt.contents[0], parts: [...prompt.contents[0].parts, ...(correction ? [{ text: correction }] : [])] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema }
      }, attemptSignal, options.fetch);
      let payload;
      try { payload = await response.json(); }
      catch (error) {
        throw error instanceof SyntaxError ? invalidResponse('JSON') : new Error('NETWORK_ERROR');
      }
      attemptSignal.throwIfAborted();
      return parseActivityResponse(payload, canonicalType, count);
    } catch (error) {
      if (signal.aborted) throw new Error(signal.reason?.name === 'TimeoutError' ? 'GENERATION_TIMEOUT' : 'GENERATION_CANCELLED');
      const attemptTimedOut = attemptSignal.aborted;
      if (attemptTimedOut) error = new Error('GENERATION_TIMEOUT');
      if (error.message === 'INVALID_RESPONSE') {
        if (error.reason === 'BLOCKED' || correctionsUsed >= 1 || lastAttempt) throw error;
        correctionsUsed++;
        // Regenera desde la fuente original y un diagnóstico fijo, sin reenviar
        // contenido defectuoso ni adivinar/cambiar respuestas correctas.
        correction = buildCorrectionInstruction(canonicalType, error.reason, count);
        continue;
      }
      if ((canSwitchModel(error) || attemptTimedOut) && !lastAttempt && modelIndex + 1 < MODELS.length) {
        modelIndex++;
        if (error.message === 'MODEL_UNAVAILABLE') continue;
      }
      if (lastAttempt || !retryable.includes(error.message)) {
        if (error.message === CAPACITY_UNAVAILABLE) throw new Error('SERVICE_UNAVAILABLE');
        throw error;
      }
      try { await wait(1000 * 2 ** attempt + Math.floor(Math.random() * 250), signal); }
      catch { throw new Error(signal.reason?.name === 'TimeoutError' ? 'GENERATION_TIMEOUT' : 'GENERATION_CANCELLED'); }
    }
  }
}

async function generateActivityFromChunk(activityType, text, apiKey, instructions = '', count, options = {}) {
  const canonicalType = resolveActivityType(activityType);
  if (!canonicalType) throw new Error('INVALID_ARGUMENT');
  const effectiveCount = count === undefined ? ACTIVITY_SPECS[canonicalType].defaultCount : count;
  return generateQuestionsFromChunk(text, apiKey, instructions, effectiveCount, { ...options, activityType: canonicalType });
}

module.exports = {
  generateQuestionsFromChunk,
  generateActivityFromChunk,
  validateQuestions,
  validateActivityItems,
  activitySchema,
  MAX_SOURCE_CHARS,
  RESPONSE_REASONS
};
