'use strict';

const MAX_SOURCE_CHARS = 200000;
const { setTimeout: delay } = require('node:timers/promises');
const { MODELS, CAPACITY_UNAVAILABLE, canSwitchModel, requestGemini } = require('./gemini');
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

const SPANISH_VOWEL_ACCENTS = Object.freeze({
  á: 'a', à: 'a', ä: 'a', â: 'a',
  é: 'e', è: 'e', ë: 'e', ê: 'e',
  í: 'i', ì: 'i', ï: 'i', î: 'i',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u',
  Á: 'A', À: 'A', Ä: 'A', Â: 'A',
  É: 'E', È: 'E', Ë: 'E', Ê: 'E',
  Í: 'I', Ì: 'I', Ï: 'I', Î: 'I',
  Ó: 'O', Ò: 'O', Ö: 'O', Ô: 'O',
  Ú: 'U', Ù: 'U', Ü: 'U', Û: 'U'
});

function invalidResponse(reason) {
  const error = new Error('INVALID_RESPONSE');
  error.reason = reason;
  return error;
}

function isPlainObjectWithOnlyKeys(item, allowedKeys) {
  return Boolean(item) && typeof item === 'object' && !Array.isArray(item) &&
    Object.keys(item).every(key => allowedKeys.includes(key));
}

function isNonEmptyBoundedString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isOptionalBoundedString(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength;
}

function normalizeSpanishWord(raw, { uppercase = false } = {}) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const stripped = trimmed.replace(/[áàäâéèëêíìïîóòöôúùüûÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛ]/g, ch => SPANISH_VOWEL_ACCENTS[ch] || ch);
  const cased = uppercase ? stripped.toUpperCase() : stripped.toLowerCase();
  const re = uppercase ? /^[A-ZÑ]{3,18}$/ : /^[a-zñ]{3,18}$/;
  return re.test(cased) ? cased : null;
}

function canPlaceCrosswordGrid(words) {
  const ordered = [...words].sort((a, b) => b.length - a.length);
  const grid = new Map();
  const dirs = new Map();
  let steps = 0;
  const MAX_STEPS = 5000;

  const keyOf = (r, c) => `${r},${c}`;

  const canPlace = (word, startR, startC, dir) => {
    const dr = dir === 'V' ? 1 : 0;
    const dc = dir === 'H' ? 1 : 0;
    if (grid.has(keyOf(startR - dr, startC - dc))) return false;
    if (grid.has(keyOf(startR + word.length * dr, startC + word.length * dc))) return false;
    let intersections = 0;
    for (let i = 0; i < word.length; i++) {
      const r = startR + i * dr;
      const c = startC + i * dc;
      const key = keyOf(r, c);
      const existing = grid.get(key);
      if (existing !== undefined) {
        if (existing !== word[i]) return false;
        if (dirs.get(key)?.includes(dir)) return false;
        intersections++;
      } else {
        if (grid.has(keyOf(r + dc, c + dr)) || grid.has(keyOf(r - dc, c - dr))) return false;
      }
    }
    return intersections > 0;
  };

  const applyPlacement = (word, startR, startC, dir) => {
    const dr = dir === 'V' ? 1 : 0;
    const dc = dir === 'H' ? 1 : 0;
    const changes = [];
    for (let i = 0; i < word.length; i++) {
      const r = startR + i * dr;
      const c = startC + i * dc;
      const key = keyOf(r, c);
      changes.push([key, grid.get(key), dirs.get(key)]);
      grid.set(key, word[i]);
      const prevDir = dirs.get(key) || '';
      dirs.set(key, prevDir.includes(dir) ? prevDir : prevDir + dir);
    }
    return changes;
  };

  const undoPlacement = (changes) => {
    for (let i = changes.length - 1; i >= 0; i--) {
      const [key, prevChar, prevDir] = changes[i];
      if (prevChar === undefined) grid.delete(key);
      else grid.set(key, prevChar);
      if (prevDir === undefined) dirs.delete(key);
      else dirs.set(key, prevDir);
    }
  };

  applyPlacement(ordered[0], 0, 0, 'H');
  const remaining = ordered.slice(1);

  const solve = (pending) => {
    if (pending.length === 0) return true;
    if (steps >= MAX_STEPS) return true;

    for (let idx = 0; idx < pending.length; idx++) {
      const word = pending[idx];
      const placements = [];
      for (const [cellKey, ch] of grid.entries()) {
        const cellDir = dirs.get(cellKey);
        if (cellDir === 'HV' || cellDir === 'VH') continue;
        const targetDir = cellDir === 'H' ? 'V' : 'H';
        const [rStr, cStr] = cellKey.split(',');
        const r = Number(rStr);
        const c = Number(cStr);
        for (let pos = 0; pos < word.length; pos++) {
          if (word[pos] !== ch) continue;
          const startR = targetDir === 'V' ? r - pos : r;
          const startC = targetDir === 'H' ? c - pos : c;
          if (canPlace(word, startR, startC, targetDir)) {
            placements.push([startR, startC, targetDir]);
          }
        }
      }
      if (placements.length === 0) continue;

      const nextPending = pending.slice(0, idx).concat(pending.slice(idx + 1));
      for (const [startR, startC, targetDir] of placements) {
        steps++;
        if (steps >= MAX_STEPS) return true;
        const changes = applyPlacement(word, startR, startC, targetDir);
        if (solve(nextPending)) return true;
        undoPlacement(changes);
      }
    }
    return false;
  };

  return solve(remaining);
}

function areWordsConnected(words) {
  if (!Array.isArray(words) || words.length < 2) return false;
  const charSets = words.map(word => new Set(word));
  const visited = new Set([0]);
  const queue = [0];
  while (queue.length > 0) {
    const current = queue.shift();
    for (let next = 0; next < words.length; next++) {
      if (visited.has(next)) continue;
      for (const ch of charSets[current]) {
        if (charSets[next].has(ch)) {
          visited.add(next);
          queue.push(next);
          break;
        }
      }
    }
  }
  if (visited.size !== words.length) return false;
  return canPlaceCrosswordGrid(words);
}

function stripCompleteOptionPrefixes(options) {
  // Solo elimina una enumeración completa A-D; preserva iniciales aisladas.
  const prefixes = options.map(option => option.match(/^(?:\(([a-d])\)|([a-d])[.):\-])\s+(?=\S)/i));
  if (prefixes.every(Boolean) && new Set(prefixes.map(match => (match[1] || match[2]).toUpperCase())).size === 4) {
    return options.map((option, index) => option.slice(prefixes[index][0].length).trim());
  }
  return options;
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

function validateQuestions(value, count) {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw invalidResponse('COUNT');
  if (!Array.isArray(value)) throw invalidResponse('STRUCTURE');
  if (value.length !== count) throw invalidResponse('COUNT');
  return value.map(item => {
    if (!isPlainObjectWithOnlyKeys(item, ['pregunta', 'opciones', 'respuestaCorrecta', 'retroalimentacion'])) throw invalidResponse('STRUCTURE');
    if (!isNonEmptyBoundedString(item.pregunta, 2000)) throw invalidResponse('QUESTION');
    if (!Array.isArray(item.opciones) || item.opciones.length !== 4 ||
        item.opciones.some(option => !isNonEmptyBoundedString(option, 1000))) throw invalidResponse('OPTIONS');
    if (typeof item.respuestaCorrecta !== 'string') throw invalidResponse('CORRECT_ANSWER');
    if (!isNonEmptyBoundedString(item.retroalimentacion, 2000)) throw invalidResponse('FEEDBACK');
    let options = item.opciones.map(option => option.trim());
    const correctIndex = options.indexOf(item.respuestaCorrecta.trim());
    if (correctIndex < 0) throw invalidResponse('CORRECT_ANSWER');
    options = stripCompleteOptionPrefixes(options);
    if (new Set(options.map(option => option.toLocaleLowerCase('es'))).size !== 4) throw invalidResponse('DUPLICATE_OPTIONS');
    return { pregunta: item.pregunta.trim(), opciones: options, respuestaCorrecta: options[correctIndex], retroalimentacion: item.retroalimentacion.trim() };
  });
}

function validateActivityItems(activityType, value, count) {
  const canonical = resolveActivityType(activityType);
  if (!canonical) throw invalidResponse('STRUCTURE');
  if (!isValidActivityCount(canonical, count)) throw invalidResponse('COUNT');

  if (canonical === 'questionset' || canonical === 'multichoice') {
    return validateQuestions(value, count);
  }

  if (!Array.isArray(value)) throw invalidResponse('STRUCTURE');
  if (value.length !== count) throw invalidResponse('COUNT');

  switch (canonical) {
    case 'truefalse': {
      return value.map(item => {
        if (!isPlainObjectWithOnlyKeys(item, ['afirmacion', 'esVerdadera', 'retroalimentacionCorrecta', 'retroalimentacionIncorrecta'])) {
          throw invalidResponse('STRUCTURE');
        }
        if (!isNonEmptyBoundedString(item.afirmacion, 2000)) throw invalidResponse('QUESTION');
        if (typeof item.esVerdadera !== 'boolean') throw invalidResponse('CORRECT_ANSWER');
        if (!isNonEmptyBoundedString(item.retroalimentacionCorrecta, 2000) ||
            !isNonEmptyBoundedString(item.retroalimentacionIncorrecta, 2000)) {
          throw invalidResponse('FEEDBACK');
        }
        return {
          afirmacion: item.afirmacion.trim(),
          esVerdadera: item.esVerdadera,
          retroalimentacionCorrecta: item.retroalimentacionCorrecta.trim(),
          retroalimentacionIncorrecta: item.retroalimentacionIncorrecta.trim()
        };
      });
    }

    case 'singlechoiceset': {
      return value.map(item => {
        if (!isPlainObjectWithOnlyKeys(item, ['pregunta', 'opciones', 'respuestaCorrecta'])) throw invalidResponse('STRUCTURE');
        if (!isNonEmptyBoundedString(item.pregunta, 2000)) throw invalidResponse('QUESTION');
        if (!Array.isArray(item.opciones) || item.opciones.length !== 4 ||
            item.opciones.some(option => !isNonEmptyBoundedString(option, 1000))) throw invalidResponse('OPTIONS');
        if (typeof item.respuestaCorrecta !== 'string') throw invalidResponse('CORRECT_ANSWER');
        let options = item.opciones.map(option => option.trim());
        const correctIndex = options.indexOf(item.respuestaCorrecta.trim());
        if (correctIndex < 0) throw invalidResponse('CORRECT_ANSWER');
        options = stripCompleteOptionPrefixes(options);
        if (new Set(options.map(option => option.toLocaleLowerCase('es'))).size !== 4) throw invalidResponse('DUPLICATE_OPTIONS');
        return {
          pregunta: item.pregunta.trim(),
          opciones: options,
          respuestaCorrecta: options[correctIndex]
        };
      });
    }

    case 'blanks': {
      return value.map(item => {
        if (!isPlainObjectWithOnlyKeys(item, ['textoAntes', 'respuesta', 'textoDespues', 'pista'])) throw invalidResponse('STRUCTURE');
        if (!isOptionalBoundedString(item.textoAntes, 1000) || !isOptionalBoundedString(item.textoDespues, 1000) ||
            !isOptionalBoundedString(item.pista, 240)) throw invalidResponse('ITEM_FIELD');
        if (!isNonEmptyBoundedString(item.respuesta, 120)) throw invalidResponse('ITEM_FIELD');
        const textoAntes = item.textoAntes.trim();
        const textoDespues = item.textoDespues.trim();
        const respuesta = item.respuesta.trim();
        const pista = item.pista.trim();
        if (!textoAntes && !textoDespues) throw invalidResponse('BLANK_SYNTAX');
        if (/[*\r\n]/.test(textoAntes) || /[*\r\n]/.test(textoDespues)) throw invalidResponse('BLANK_SYNTAX');
        if (/[*:/\r\n]/.test(respuesta) || /[*:\r\n]/.test(pista)) throw invalidResponse('BLANK_SYNTAX');
        return { textoAntes, respuesta, textoDespues, pista };
      });
    }

    case 'dragtext': {
      return value.map(item => {
        if (!isPlainObjectWithOnlyKeys(item, ['textoAntes', 'palabra', 'textoDespues', 'pista'])) throw invalidResponse('STRUCTURE');
        if (!isOptionalBoundedString(item.textoAntes, 1000) || !isOptionalBoundedString(item.textoDespues, 1000) ||
            !isOptionalBoundedString(item.pista, 200)) throw invalidResponse('ITEM_FIELD');
        if (!isNonEmptyBoundedString(item.palabra, 80)) throw invalidResponse('ITEM_FIELD');
        const textoAntes = item.textoAntes.trim();
        const textoDespues = item.textoDespues.trim();
        const palabra = item.palabra.trim();
        const pista = item.pista.trim();
        if (!textoAntes && !textoDespues) throw invalidResponse('BLANK_SYNTAX');
        if (/[*\r\n]/.test(textoAntes) || /[*\r\n]/.test(textoDespues)) throw invalidResponse('BLANK_SYNTAX');
        if (/[*:\\\r\n]/.test(palabra) || /[*:\\\r\n]/.test(pista)) throw invalidResponse('BLANK_SYNTAX');
        return { textoAntes, palabra, textoDespues, pista };
      });
    }

    case 'summary': {
      return value.map(item => {
        if (!isPlainObjectWithOnlyKeys(item, ['afirmacionCorrecta', 'distractores', 'pista'])) throw invalidResponse('STRUCTURE');
        if (!isNonEmptyBoundedString(item.afirmacionCorrecta, 600) || !isOptionalBoundedString(item.pista, 240)) {
          throw invalidResponse('ITEM_FIELD');
        }
        if (!Array.isArray(item.distractores) || item.distractores.length < 2 || item.distractores.length > 3 ||
            item.distractores.some(dist => !isNonEmptyBoundedString(dist, 600))) {
          throw invalidResponse('OPTIONS');
        }
        const afirmacionCorrecta = item.afirmacionCorrecta.trim();
        const distractores = item.distractores.map(dist => dist.trim());
        const all = [afirmacionCorrecta, ...distractores];
        if (new Set(all.map(entry => entry.toLocaleLowerCase('es'))).size !== all.length) {
          throw invalidResponse('DUPLICATE_OPTIONS');
        }
        return { afirmacionCorrecta, distractores, pista: item.pista.trim() };
      });
    }

    case 'sortparagraphs': {
      const normalized = value.map(item => {
        if (!isPlainObjectWithOnlyKeys(item, ['parrafo'])) throw invalidResponse('STRUCTURE');
        if (!isNonEmptyBoundedString(item.parrafo, 1000)) throw invalidResponse('ITEM_FIELD');
        return { parrafo: item.parrafo.trim() };
      });
      if (new Set(normalized.map(entry => entry.parrafo.toLocaleLowerCase('es'))).size !== normalized.length) {
        throw invalidResponse('DUPLICATE_ITEMS');
      }
      return normalized;
    }

    case 'crossword': {
      const normalized = value.map(item => {
        if (!isPlainObjectWithOnlyKeys(item, ['pista', 'palabra'])) throw invalidResponse('STRUCTURE');
        if (!isNonEmptyBoundedString(item.pista, 300)) throw invalidResponse('ITEM_FIELD');
        const palabra = normalizeSpanishWord(item.palabra, { uppercase: true });
        if (!palabra) throw invalidResponse('WORD_FORMAT');
        return { pista: item.pista.trim(), palabra };
      });
      if (new Set(normalized.map(entry => entry.palabra)).size !== normalized.length) {
        throw invalidResponse('DUPLICATE_ITEMS');
      }
      if (!areWordsConnected(normalized.map(entry => entry.palabra))) {
        throw invalidResponse('DISCONNECTED_WORDS');
      }
      return normalized;
    }

    case 'findthewords': {
      const normalized = value.map(item => {
        if (!isPlainObjectWithOnlyKeys(item, ['palabra'])) throw invalidResponse('STRUCTURE');
        const palabra = normalizeSpanishWord(item.palabra, { uppercase: false });
        if (!palabra) throw invalidResponse('WORD_FORMAT');
        return { palabra };
      });
      if (new Set(normalized.map(entry => entry.palabra)).size !== normalized.length) {
        throw invalidResponse('DUPLICATE_ITEMS');
      }
      return normalized;
    }

    case 'accordion': {
      const normalized = value.map(item => {
        if (!isPlainObjectWithOnlyKeys(item, ['titulo', 'explicacion'])) throw invalidResponse('STRUCTURE');
        if (!isNonEmptyBoundedString(item.titulo, 160) || !isNonEmptyBoundedString(item.explicacion, 2000)) {
          throw invalidResponse('ITEM_FIELD');
        }
        return { titulo: item.titulo.trim(), explicacion: item.explicacion.trim() };
      });
      if (new Set(normalized.map(entry => entry.titulo.toLocaleLowerCase('es'))).size !== normalized.length) {
        throw invalidResponse('DUPLICATE_ITEMS');
      }
      return normalized;
    }

    case 'flashcards': {
      const normalized = value.map(item => {
        if (!isPlainObjectWithOnlyKeys(item, ['pregunta', 'respuesta', 'pista'])) throw invalidResponse('STRUCTURE');
        if (!isNonEmptyBoundedString(item.pregunta, 600) ||
            !isNonEmptyBoundedString(item.respuesta, 200) ||
            !isOptionalBoundedString(item.pista, 300)) {
          throw invalidResponse('ITEM_FIELD');
        }
        return {
          pregunta: item.pregunta.trim(),
          respuesta: item.respuesta.trim(),
          pista: item.pista.trim()
        };
      });
      if (new Set(normalized.map(entry => entry.pregunta.toLocaleLowerCase('es'))).size !== normalized.length) {
        throw invalidResponse('DUPLICATE_ITEMS');
      }
      return normalized;
    }

    default:
      throw invalidResponse('STRUCTURE');
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
