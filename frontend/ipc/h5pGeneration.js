'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { generateQuestionsFromChunk, MAX_SOURCE_CHARS } = require('../../backend/llmClient');

const messages = {
  DOCUMENT_NOT_FOUND: 'Los documentos ya no están disponibles. Vuelve a seleccionarlos.',
  SOURCE_TOO_LARGE: 'El texto de los documentos supera el límite para una generación.',
  MISSING_KEY: 'Configura una clave de Gemini antes de generar.',
  API_KEY_INVALID: 'La clave de Gemini no es válida o no tiene acceso al modelo.',
  QUOTA: 'Gemini ha alcanzado el límite de solicitudes. Inténtalo más tarde.',
  INVALID_RESPONSE: 'Gemini no devolvió preguntas válidas. Inténtalo nuevamente.',
  GENERATION_FAILED: 'No se pudo generar el cuestionario. Comprueba la conexión e inténtalo nuevamente.',
  NOT_FOUND: 'El cuestionario ya no está disponible. Vuelve a generarlo.',
  INVALID_COURSE: 'El ramo seleccionado ya no está disponible.',
  UNSUPPORTED_TYPE: 'El tipo de actividad no está disponible.',
  BUSY: 'Hay una operación en curso. Espera a que termine.',
  SAVE_FAILED: 'No se pudo guardar el archivo. Inténtalo nuevamente.'
};
const fail = code => ({ status: 'error', code, message: messages[code] });

function createH5PGeneration({ inspection, storage, dialog, BrowserWindow, app, generate = generateQuestionsFromChunk, WorkerClass = Worker, fileSystem = fs }) {
  const sessions = new WeakMap();
  function sessionFor(sender) {
    let session = sessions.get(sender);
    if (session) return session;
    session = { closed: false, busy: false, package: null, abort: new AbortController(), worker: null };
    sessions.set(sender, session);
    const close = () => {
      session.closed = true; session.package = null; session.abort.abort();
      if (session.worker) session.worker.terminate();
      if (sessions.get(sender) === session) sessions.delete(sender);
      sender.removeListener('destroyed', close); sender.removeListener('did-start-navigation', navigation);
    };
    const navigation = (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) close(); };
    sender.once('destroyed', close); sender.on('did-start-navigation', navigation);
    return session;
  }
  async function buildPackage(questions, session) {
    const worker = new WorkerClass(path.join(__dirname, '../../backend/h5pPackageWorker.js'), { workerData: { questions } });
    session.worker = worker;
    try {
      return await new Promise((resolve, reject) => {
        let done = false;
        const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
        const timer = setTimeout(() => finish(new Error('timeout')), 60000);
        worker.once('message', value => value?.bytes ? finish(null, Buffer.from(value.bytes)) : finish(new Error('worker')));
        worker.once('error', () => finish(new Error('worker')));
        worker.once('exit', () => finish(new Error('worker')));
      });
    } finally { await worker.terminate(); session.worker = null; }
  }
  async function generateH5P(request, event) {
    const sender = event.sender;
    const session = sessionFor(sender);
    if (session.busy) return fail('BUSY');
    if (request.activityType !== 'multiple-choice' || request.questionCount > 20) return fail('UNSUPPORTED_TYPE');
    const documents = request.documentIds.map(id => inspection.getDocument(sender, id));
    if (documents.some(doc => !doc)) return fail('DOCUMENT_NOT_FOUND');
    const source = documents.map(doc => doc.text).join('\n\n');
    if (source.length > MAX_SOURCE_CHARS) return fail('SOURCE_TOO_LARGE');
    session.busy = true;
    try {
      let key;
      try { key = storage.getApiKey(); } catch { return fail('MISSING_KEY'); }
      if (!key) return fail('MISSING_KEY');
      const questions = await generate(source, key, request.instructions, request.questionCount, { signal: AbortSignal.any([session.abort.signal, AbortSignal.timeout(90000)]) });
      if (session.closed || sender.isDestroyed() || request.documentIds.some((id, i) => inspection.getDocument(sender, id) !== documents[i])) return fail('DOCUMENT_NOT_FOUND');
      const bytes = await buildPackage(questions, session);
      if (session.closed || sender.isDestroyed() || request.documentIds.some((id, i) => inspection.getDocument(sender, id) !== documents[i])) return fail('DOCUMENT_NOT_FOUND');
      const packageId = randomUUID();
      session.package = { id: packageId, bytes };
      return { status: 'ok', kind: 'package', packageId, questionCount: questions.length };
    } catch (error) {
      const code = ['API_KEY_INVALID', 'QUOTA', 'INVALID_RESPONSE'].includes(error?.message) ? error.message : 'GENERATION_FAILED';
      return fail(code);
    } finally { session.busy = false; }
  }
  async function saveH5PFile(request, event) {
    const session = sessions.get(event.sender);
    if (!session || session.closed || session.package?.id !== request.packageId) return fail('NOT_FOUND');
    if (session.busy) return fail('BUSY');
    const courseId = request.courseId || 'unassigned';
    if (courseId !== 'unassigned' && !storage.getCourseById(courseId)) return fail('INVALID_COURSE');
    session.busy = true;
    let temporaryPath;
    const pkg = session.package;
    try {
      const proposed = request.suggestedName.replace(/\.h5p$/i, '') + '.h5p';
      const choice = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
        title: 'Guardar actividad H5P', defaultPath: path.join(app.getPath('documents'), proposed),
        filters: [{ name: 'Actividad H5P', extensions: ['h5p'] }]
      });
      if (choice.canceled || !choice.filePath) return { status: 'cancelled' };
      if (session.closed || event.sender.isDestroyed() || session.package?.id !== request.packageId) return fail('NOT_FOUND');
      if (!/\.h5p$/i.test(choice.filePath)) return fail('SAVE_FAILED');
      const filePath = choice.filePath;
      temporaryPath = path.join(path.dirname(filePath), `.h5p-${randomUUID()}.tmp`);
      await fileSystem.writeFile(temporaryPath, pkg.bytes, { flag: 'wx', mode: 0o600 });
      if (session.closed || event.sender.isDestroyed()) return fail('NOT_FOUND');
      await fileSystem.rename(temporaryPath, filePath);
      temporaryPath = null;
      let projectSaved = true;
      try { storage.saveProject({ title: path.basename(filePath, path.extname(filePath)), courseId, h5pType: 'Cuestionario de opción múltiple', filePath, fileSizeBytes: pkg.bytes.length }); } catch { projectSaved = false; }
      return { status: 'ok', fileName: path.basename(filePath), projectSaved };
    } catch { return fail('SAVE_FAILED'); }
    finally {
      if (temporaryPath) { try { await fileSystem.unlink(temporaryPath); } catch {} }
      session.busy = false;
    }
  }
  return { generateH5P, saveH5PFile };
}
module.exports = { createH5PGeneration };
