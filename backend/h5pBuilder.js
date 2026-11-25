'use strict';

const crypto = require('node:crypto');
const { TEMPLATE_TYPES, loadTemplate, validateH5PMetadata } = require('./h5pTemplates');
const { validateActivityItems } = require('./llmClient');
const { resolveActivityType } = require('./prompts');

const HTML_ENTITIES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
});

function builderError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => HTML_ENTITIES[ch]);
}

function escapeFeedbackHtml(value) {
  // MultiChoice y TrueFalse sustituyen @score y @total antes de renderizar.
  return escapeHtml(value).replace(/@(?=score|total)/g, '&#64;');
}

function sanitizeTitle(rawTitle, fallback) {
  if (typeof rawTitle === 'string') {
    const cleaned = rawTitle
      .replace(/[\x00-\x1f\x7f]/g, ' ')
      .replace(/\.h5p$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 255);
    if (cleaned.length > 0) return cleaned;
  }
  const safeFallback = typeof fallback === 'string'
    ? fallback.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255)
    : '';
  return safeFallback || 'Actividad H5P';
}

function assembleInlineBlank(rawBefore, marker, rawAfter) {
  const before = typeof rawBefore === 'string' ? rawBefore.trim() : '';
  const after = typeof rawAfter === 'string' ? rawAfter.trim() : '';
  let result = '';
  if (before) {
    result += escapeHtml(before);
    if (!/[(\[¿¡"'«“‘]$/.test(before)) result += ' ';
  }
  result += marker;
  if (after) {
    if (!/^[,.;:?!)\]"'»”’]/.test(after)) result += ' ';
    result += escapeHtml(after);
  }
  return result;
}

function applyBehaviourOverrides(baseBehaviour, overrides) {
  if (!baseBehaviour || typeof baseBehaviour !== 'object' || Array.isArray(baseBehaviour)) {
    return baseBehaviour;
  }
  const copy = structuredClone(baseBehaviour);
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return copy;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(copy, key)) continue;
    const expectedType = typeof copy[key];
    if (expectedType === 'boolean' && typeof value === 'boolean') {
      copy[key] = value;
    } else if (expectedType === 'number' && typeof value === 'number' && Number.isFinite(value)) {
      copy[key] = value;
    }
  }
  return copy;
}

function buildMultiChoiceParams(baseContent, question, behaviourOverrides) {
  return {
    ...structuredClone(baseContent),
    behaviour: applyBehaviourOverrides(baseContent.behaviour, behaviourOverrides),
    question: `<p>${escapeHtml(question.pregunta)}</p>`,
    overallFeedback: [{ from: 0, to: 100, feedback: escapeFeedbackHtml(question.retroalimentacion) }],
    answers: question.opciones.map(option => ({
      text: `<div>${escapeHtml(option)}</div>`,
      correct: option === question.respuestaCorrecta,
      tipsAndFeedback: { tip: '', chosenFeedback: '', notChosenFeedback: '' }
    }))
  };
}

/**
 * Construye los objetos `h5p.json` (metadata) y `content/content.json` (content)
 * para cualquiera de los 12 formatos H5P registrados en `backend/templates/manifest.json`.
 */
async function buildH5PContent(activityType, items, options = {}) {
  const canonical = resolveActivityType(activityType);
  if (!canonical) {
    throw builderError('UNSUPPORTED_ACTIVITY_TYPE', `Tipo de actividad H5P no soportado: ${String(activityType)}.`);
  }

  const expectedCount = (canonical === TEMPLATE_TYPES.MULTICHOICE || canonical === TEMPLATE_TYPES.TRUEFALSE)
    ? 1
    : (Array.isArray(items) ? items.length : 0);
  const validated = validateActivityItems(canonical, items, expectedCount);

  const loadOpts = options.templatesDir ? { templatesDir: options.templatesDir } : {};
  const nextId = typeof options.idGenerator === 'function' ? options.idGenerator : () => crypto.randomUUID();
  const behaviourOverrides = options.behaviour;

  let metadata;
  let content;

  switch (canonical) {
    case TEMPLATE_TYPES.MULTICHOICE: {
      const mcTemplate = await loadTemplate(TEMPLATE_TYPES.MULTICHOICE, loadOpts);
      const first = validated[0];
      metadata = {
        ...mcTemplate.metadata,
        title: sanitizeTitle(options.title, first.pregunta.slice(0, 120) || mcTemplate.metadata.title)
      };
      content = buildMultiChoiceParams(mcTemplate.content, first, behaviourOverrides);
      break;
    }

    case TEMPLATE_TYPES.QUESTIONSET: {
      const qsTemplate = await loadTemplate(TEMPLATE_TYPES.QUESTIONSET, loadOpts);
      const mcTemplate = await loadTemplate(TEMPLATE_TYPES.MULTICHOICE, loadOpts);
      metadata = {
        ...qsTemplate.metadata,
        title: sanitizeTitle(options.title, qsTemplate.metadata.title)
      };
      content = {
        ...qsTemplate.content,
        questions: validated.map(question => ({
          library: mcTemplate.mainLibraryKey,
          subContentId: nextId(),
          metadata: {
            title: sanitizeTitle(question.pregunta.slice(0, 120), 'Pregunta de opción múltiple'),
            license: 'U',
            contentType: 'Multiple Choice'
          },
          params: buildMultiChoiceParams(mcTemplate.content, question, behaviourOverrides)
        }))
      };
      break;
    }

    case TEMPLATE_TYPES.TRUEFALSE: {
      const tfTemplate = await loadTemplate(TEMPLATE_TYPES.TRUEFALSE, loadOpts);
      const first = validated[0];
      metadata = {
        ...tfTemplate.metadata,
        title: sanitizeTitle(options.title, first.afirmacion.slice(0, 120) || tfTemplate.metadata.title)
      };
      const behaviour = {
        ...applyBehaviourOverrides(tfTemplate.content.behaviour, behaviourOverrides),
        feedbackOnCorrect: escapeFeedbackHtml(first.retroalimentacionCorrecta),
        feedbackOnWrong: escapeFeedbackHtml(first.retroalimentacionIncorrecta)
      };
      content = {
        ...tfTemplate.content,
        question: `<p>${escapeHtml(first.afirmacion)}</p>`,
        correct: first.esVerdadera ? 'true' : 'false',
        behaviour
      };
      break;
    }

    case TEMPLATE_TYPES.SINGLECHOICESET: {
      const scsTemplate = await loadTemplate(TEMPLATE_TYPES.SINGLECHOICESET, loadOpts);
      metadata = {
        ...scsTemplate.metadata,
        title: sanitizeTitle(options.title, scsTemplate.metadata.title)
      };
      content = {
        ...scsTemplate.content,
        behaviour: applyBehaviourOverrides(scsTemplate.content.behaviour, behaviourOverrides),
        choices: validated.map(item => {
          // En H5P.SingleChoiceSet, answers[0] es siempre la respuesta correcta.
          const distractors = item.opciones.filter(option => option !== item.respuestaCorrecta);
          return {
            subContentId: nextId(),
            question: `<p>${escapeHtml(item.pregunta)}</p>`,
            answers: [item.respuestaCorrecta, ...distractors].map(option => `<p>${escapeHtml(option)}</p>`)
          };
        })
      };
      break;
    }

    case TEMPLATE_TYPES.BLANKS: {
      const blanksTemplate = await loadTemplate(TEMPLATE_TYPES.BLANKS, loadOpts);
      metadata = {
        ...blanksTemplate.metadata,
        title: sanitizeTitle(options.title, blanksTemplate.metadata.title)
      };
      content = {
        ...blanksTemplate.content,
        behaviour: applyBehaviourOverrides(blanksTemplate.content.behaviour, behaviourOverrides),
        questions: validated.map(item => {
          const tipSuffix = item.pista ? `:${escapeHtml(item.pista)}` : '';
          const marker = `*${escapeHtml(item.respuesta)}${tipSuffix}*`;
          const sentence = assembleInlineBlank(
            item.textoAntes,
            marker,
            item.textoDespues
          );
          return `<p>${sentence}</p>`;
        })
      };
      break;
    }

    case TEMPLATE_TYPES.DRAGTEXT: {
      const dragTemplate = await loadTemplate(TEMPLATE_TYPES.DRAGTEXT, loadOpts);
      metadata = {
        ...dragTemplate.metadata,
        title: sanitizeTitle(options.title, dragTemplate.metadata.title)
      };
      const lines = validated.map(item => {
        const tipSuffix = item.pista ? `:${escapeHtml(item.pista)}` : '';
        const marker = `*${escapeHtml(item.palabra)}${tipSuffix}*`;
        return assembleInlineBlank(
          item.textoAntes,
          marker,
          item.textoDespues
        );
      });
      content = {
        ...dragTemplate.content,
        behaviour: applyBehaviourOverrides(dragTemplate.content.behaviour, behaviourOverrides),
        textField: lines.join('\n'),
        distractors: ''
      };
      break;
    }

    case TEMPLATE_TYPES.SUMMARY: {
      const summaryTemplate = await loadTemplate(TEMPLATE_TYPES.SUMMARY, loadOpts);
      metadata = {
        ...summaryTemplate.metadata,
        title: sanitizeTitle(options.title, summaryTemplate.metadata.title)
      };
      content = {
        ...summaryTemplate.content,
        summaries: validated.map(item => ({
          subContentId: nextId(),
          // En H5P.Summary, summary[0] es siempre la afirmación correcta.
          summary: [item.afirmacionCorrecta, ...item.distractores].map(statement => `<p>${escapeHtml(statement)}</p>`),
          tip: item.pista ? escapeHtml(item.pista) : ''
        }))
      };
      break;
    }

    case TEMPLATE_TYPES.SORTPARAGRAPHS: {
      const sortTemplate = await loadTemplate(TEMPLATE_TYPES.SORTPARAGRAPHS, loadOpts);
      metadata = {
        ...sortTemplate.metadata,
        title: sanitizeTitle(options.title, sortTemplate.metadata.title)
      };
      content = {
        ...sortTemplate.content,
        behaviour: applyBehaviourOverrides(sortTemplate.content.behaviour, behaviourOverrides),
        paragraphs: validated.map(item => `<p>${escapeHtml(item.parrafo)}</p>`)
      };
      break;
    }

    case TEMPLATE_TYPES.CROSSWORD: {
      const cwTemplate = await loadTemplate(TEMPLATE_TYPES.CROSSWORD, loadOpts);
      metadata = {
        ...cwTemplate.metadata,
        title: sanitizeTitle(options.title, cwTemplate.metadata.title)
      };
      content = {
        ...cwTemplate.content,
        behaviour: applyBehaviourOverrides(cwTemplate.content.behaviour, behaviourOverrides),
        words: validated.map(item => ({
          clue: item.pista,
          answer: item.palabra,
          fixWord: false
        }))
      };
      break;
    }

    case TEMPLATE_TYPES.FINDTHEWORDS: {
      const ftwTemplate = await loadTemplate(TEMPLATE_TYPES.FINDTHEWORDS, loadOpts);
      metadata = {
        ...ftwTemplate.metadata,
        title: sanitizeTitle(options.title, ftwTemplate.metadata.title)
      };
      content = {
        ...ftwTemplate.content,
        behaviour: applyBehaviourOverrides(ftwTemplate.content.behaviour, behaviourOverrides),
        wordList: validated.map(item => item.palabra).join(',')
      };
      break;
    }

    case TEMPLATE_TYPES.ACCORDION: {
      const accTemplate = await loadTemplate(TEMPLATE_TYPES.ACCORDION, loadOpts);
      const subLib = accTemplate.subContentLibraryKey || 'H5P.AdvancedText 1.1';
      metadata = {
        ...accTemplate.metadata,
        title: sanitizeTitle(options.title, accTemplate.metadata.title)
      };
      content = {
        ...accTemplate.content,
        panels: validated.map(item => ({
          // H5P.Accordion inyecta panel.title como HTML vía jQuery; se escapa para evitar inyección.
          title: escapeHtml(item.titulo),
          content: {
            library: subLib,
            subContentId: nextId(),
            metadata: {
              contentType: 'Text',
              license: 'U',
              title: sanitizeTitle(item.titulo.slice(0, 120), 'Concepto')
            },
            params: {
              text: `<p>${escapeHtml(item.explicacion)}</p>`
            }
          }
        }))
      };
      break;
    }

    case TEMPLATE_TYPES.FLASHCARDS: {
      const fcTemplate = await loadTemplate(TEMPLATE_TYPES.FLASHCARDS, loadOpts);
      metadata = {
        ...fcTemplate.metadata,
        title: sanitizeTitle(options.title, fcTemplate.metadata.title)
      };
      content = {
        ...fcTemplate.content,
        // H5P.Flashcards parsea card.answer como HTML ($converter.html().text()), lo inyecta en resultados
        // y divide alternativas por '/'. Se escapa HTML y '/' para evitar XSS y falsos errores de calificación.
        cards: validated.map(item => ({
          text: escapeHtml(item.pregunta),
          answer: escapeHtml(item.respuesta).replace(/\//g, '\\/'),
          tip: item.pista ? escapeHtml(item.pista) : ''
        }))
      };
      break;
    }

    default:
      throw builderError('UNSUPPORTED_ACTIVITY_TYPE', `Tipo de actividad H5P no soportado: ${canonical}.`);
  }

  validateH5PMetadata(metadata);

  return {
    type: canonical,
    metadata,
    content,
    itemCount: validated.length
  };
}

module.exports = {
  buildH5PContent,
  escapeHtml,
  escapeFeedbackHtml,
  sanitizeTitle,
  assembleInlineBlank
};
