'use strict';

const { resolveActivityType, isValidActivityCount } = require('./prompts');

const EDITABLE_TEXT_LIMITS = Object.freeze({ question: 2000, option: 1000, feedback: 2000 });

function optionTextKey(value) {
  return value.trim().toLocaleLowerCase('es');
}

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

function checkQuestions(value, count, normalizeOptionPrefixes) {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw invalidResponse('COUNT');
  if (!Array.isArray(value)) throw invalidResponse('STRUCTURE');
  if (value.length !== count) throw invalidResponse('COUNT');
  return value.map(item => {
    if (!isPlainObjectWithOnlyKeys(item, ['pregunta', 'opciones', 'respuestaCorrecta', 'retroalimentacion'])) throw invalidResponse('STRUCTURE');
    if (!isNonEmptyBoundedString(item.pregunta, EDITABLE_TEXT_LIMITS.question)) throw invalidResponse('QUESTION');
    if (!Array.isArray(item.opciones) || item.opciones.length !== 4 ||
        item.opciones.some(option => !isNonEmptyBoundedString(option, EDITABLE_TEXT_LIMITS.option))) throw invalidResponse('OPTIONS');
    if (typeof item.respuestaCorrecta !== 'string') throw invalidResponse('CORRECT_ANSWER');
    if (!isNonEmptyBoundedString(item.retroalimentacion, EDITABLE_TEXT_LIMITS.feedback)) throw invalidResponse('FEEDBACK');
    let options = item.opciones.map(option => option.trim());
    const correctIndex = options.indexOf(item.respuestaCorrecta.trim());
    if (correctIndex < 0) throw invalidResponse('CORRECT_ANSWER');
    if (normalizeOptionPrefixes) options = stripCompleteOptionPrefixes(options);
    if (new Set(options.map(optionTextKey)).size !== 4) throw invalidResponse('DUPLICATE_OPTIONS');
    return { pregunta: item.pregunta.trim(), opciones: options, respuestaCorrecta: options[correctIndex], retroalimentacion: item.retroalimentacion.trim() };
  });
}

function checkActivityItems(activityType, value, count, normalizeOptionPrefixes) {
  const canonical = resolveActivityType(activityType);
  if (!canonical) throw invalidResponse('STRUCTURE');
  if (!isValidActivityCount(canonical, count)) throw invalidResponse('COUNT');

  if (canonical === 'questionset' || canonical === 'multichoice') {
    return checkQuestions(value, count, normalizeOptionPrefixes);
  }

  if (!Array.isArray(value)) throw invalidResponse('STRUCTURE');
  if (value.length !== count) throw invalidResponse('COUNT');

  switch (canonical) {
    case 'truefalse': {
      return value.map(item => {
        if (!isPlainObjectWithOnlyKeys(item, ['afirmacion', 'esVerdadera', 'retroalimentacionCorrecta', 'retroalimentacionIncorrecta'])) {
          throw invalidResponse('STRUCTURE');
        }
        if (!isNonEmptyBoundedString(item.afirmacion, EDITABLE_TEXT_LIMITS.question)) throw invalidResponse('QUESTION');
        if (typeof item.esVerdadera !== 'boolean') throw invalidResponse('CORRECT_ANSWER');
        if (!isNonEmptyBoundedString(item.retroalimentacionCorrecta, EDITABLE_TEXT_LIMITS.feedback) ||
            !isNonEmptyBoundedString(item.retroalimentacionIncorrecta, EDITABLE_TEXT_LIMITS.feedback)) {
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
        if (normalizeOptionPrefixes) options = stripCompleteOptionPrefixes(options);
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

function validateQuestions(value, count) {
  return checkQuestions(value, count, true);
}

function validateActivityItems(activityType, value, count) {
  return checkActivityItems(activityType, value, count, true);
}

// La enumeración escrita por el docente forma parte del texto revisado.
function validateReviewedActivityItems(activityType, value, count) {
  return checkActivityItems(activityType, value, count, false);
}

module.exports = {
  EDITABLE_TEXT_LIMITS,
  invalidResponse,
  optionTextKey,
  validateQuestions,
  validateActivityItems,
  validateReviewedActivityItems
};
