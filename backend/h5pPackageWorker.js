'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const { validateQuestions } = require('./llmClient');

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
    const zip = await JSZip.loadAsync(await fs.readFile(path.join(__dirname, 'templates', 'question-set-616.h5p')));
    const metadata = JSON.parse(await zip.file('h5p.json').async('string'));
    const template = JSON.parse(await zip.file('content/content.json').async('string'));
    const sample = template.questions.find(question => question.library === 'H5P.MultiChoice 1.14');
    if (!sample) throw new Error('TEMPLATE');
    const base = sample.params;
    delete base.media;
    delete base.overallFeedback;
    // Evita que etiquetas que formen parte del contenido queden desordenadas.
    base.behaviour = { ...base.behaviour, randomAnswers: false };
    base.UI = { showSolutionButton: 'Mostrar solución', tryAgainButton: 'Reintentar', checkAnswerButton: 'Comprobar', tipsLabel: 'Mostrar pista', scoreBarLabel: 'Obtuviste :num de :total puntos', tipAvailable: 'Pista disponible', feedbackAvailable: 'Comentarios disponibles', readFeedback: 'Leer comentarios', wrongAnswer: 'Respuesta incorrecta', correctAnswer: 'Respuesta correcta', shouldCheck: 'Debía seleccionarse', shouldNotCheck: 'No debía seleccionarse', noInput: 'Responde antes de ver la solución' };
    template.questions = questions.map(question => ({
      library: 'H5P.MultiChoice 1.14', subContentId: crypto.randomUUID(),
      metadata: { title: question.pregunta.slice(0, 120), license: 'U', contentType: 'Multiple Choice' },
      params: { ...base, question: `<p>${html(question.pregunta)}</p>`, overallFeedback: [{ from: 0, to: 100, feedback: feedbackHtml(question.retroalimentacion) }], answers: question.opciones.map(option => ({ text: `<div>${html(option)}</div>`, correct: option === question.respuestaCorrecta, tipsAndFeedback: { tip: '', chosenFeedback: '', notChosenFeedback: '' } })) }
    }));
    template.texts = { prevButton: 'Anterior', nextButton: 'Siguiente', finishButton: 'Finalizar', textualProgress: 'Pregunta @current de @total', questionLabel: 'Pregunta', jumpToQuestion: 'Ir a la pregunta %d', readSpeakerProgress: 'Pregunta @current de @total', unansweredText: 'Sin responder', answeredText: 'Respondida', currentQuestionText: 'Pregunta actual' };
    template.endGame = { ...template.endGame, message: 'Tu resultado:', finishButtonText: 'Finalizar', solutionButtonText: 'Mostrar solución', retryButtonText: 'Reintentar', noResultMessage: 'Finalizado', overallFeedback: [{ from: 0, to: 100, feedback: 'Obtuviste @score de @total puntos.' }] };
    delete template.endGame.oldFeedback;
    template.introPage = { showIntroPage: false, startButtonText: 'Comenzar', introduction: '' };
    metadata.title = 'Cuestionario generado'; metadata.language = 'es'; metadata.license = 'U';
    zip.remove('content');
    zip.file('h5p.json', JSON.stringify(metadata));
    zip.file('content/content.json', JSON.stringify(template));
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    parentPort.postMessage({ bytes });
  } catch { parentPort.postMessage({ error: true }); }
})();
