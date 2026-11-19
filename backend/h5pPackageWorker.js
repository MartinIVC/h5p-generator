'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const crypto = require('node:crypto');
const { validateQuestions } = require('./llmClient');
const { TEMPLATE_TYPES, loadTemplate, createBasePackageZip } = require('./h5pTemplates');

function html(value) {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function feedbackHtml(value) {
  // MultiChoice sustituye estas marcas por puntuaciones antes de renderizar.
  return html(value).replace(/@(?=score|total)/g, '&#64;');
}

(async () => {
  try {
    const questions = validateQuestions(workerData.questions, workerData.questions.length);
    const qsTemplate = await loadTemplate(TEMPLATE_TYPES.QUESTIONSET);
    const mcTemplate = await loadTemplate(TEMPLATE_TYPES.MULTICHOICE);
    const zip = await createBasePackageZip(TEMPLATE_TYPES.QUESTIONSET);

    const metadata = qsTemplate.metadata;
    const template = qsTemplate.content;
    const base = mcTemplate.content;

    template.questions = questions.map(question => ({
      library: mcTemplate.mainLibraryKey,
      subContentId: crypto.randomUUID(),
      metadata: { title: question.pregunta.slice(0, 120), license: 'U', contentType: 'Multiple Choice' },
      params: {
        ...base,
        question: `<p>${html(question.pregunta)}</p>`,
        overallFeedback: [{ from: 0, to: 100, feedback: feedbackHtml(question.retroalimentacion) }],
        answers: question.opciones.map(option => ({
          text: `<div>${html(option)}</div>`,
          correct: option === question.respuestaCorrecta,
          tipsAndFeedback: { tip: '', chosenFeedback: '', notChosenFeedback: '' }
        }))
      }
    }));

    zip.file('h5p.json', JSON.stringify(metadata));
    zip.file('content/content.json', JSON.stringify(template));
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    parentPort.postMessage({ bytes });
  } catch { parentPort.postMessage({ error: true }); }
})();
