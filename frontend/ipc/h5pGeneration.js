'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { generateQuestionsFromChunk, MAX_SOURCE_CHARS, RESPONSE_REASONS } = require('../../backend/llmClient');
const { ACTIVITY_SPECS, resolveActivityType, isValidActivityCount } = require('../../backend/prompts');
const { writeH5PFile } = require('../../backend/h5pPacker');

const messages = {
  DOCUMENT_NOT_FOUND: 'Los documentos ya no están disponibles. Vuelve a seleccionarlos.',
  SOURCE_TOO_LARGE: 'El texto de los documentos supera el límite para una generación.',
  MISSING_KEY: 'Configura una clave de Gemini antes de generar.',
  API_KEY_INVALID: 'La clave de Gemini no es válida o no tiene acceso al modelo.',
  QUOTA: 'Gemini ha alcanzado el límite de solicitudes. Inténtalo más tarde.',
  INVALID_RESPONSE: 'Gemini no devolvió contenido válido para la actividad. Inténtalo nuevamente.',
  GENERATION_FAILED: 'No se pudo completar la generación. Inténtalo nuevamente.',
  NETWORK_ERROR: 'No se pudo conectar con Gemini después de tres intentos. Comprueba tu conexión.',
  SERVICE_UNAVAILABLE: 'Gemini sigue temporalmente no disponible después de tres intentos. Inténtalo más tarde.',
  API_REQUEST_FAILED: 'Gemini rechazó la solicitud. Revisa la configuración y el acceso al modelo.',
  GENERATION_TIMEOUT: 'Gemini superó el tiempo de espera de 90 segundos. Inténtalo más tarde.',
  GENERATION_CANCELLED: 'La generación se canceló al salir de la actividad.',
  PACKAGE_FAILED: 'Se generó el contenido, pero no se pudo preparar el archivo H5P.',
  NOT_FOUND: 'La actividad preparada ya no está disponible. Vuelve a generarla.',
  INVALID_COURSE: 'El ramo seleccionado ya no está disponible.',
  UNSUPPORTED_TYPE: 'El tipo de actividad o la cantidad solicitada no están disponibles.',
  BUSY: 'Hay una operación en curso. Espera a que termine.',
  SAVE_FAILED: 'No se pudo guardar el archivo. Inténtalo nuevamente.'
};
const fail = code => ({ status: 'error', code, message: messages[code] });

function resolveGenerationConfig(rawActivityType) {
  const canonical = resolveActivityType(rawActivityType);
  if (!canonical) return null;
  const spec = ACTIVITY_SPECS[canonical];
  const projectLabel = rawActivityType === 'multiple-choice'
    ? 'Cuestionario de opción múltiple'
    : spec.projectLabel;
  return { workerType: canonical, projectLabel, spec };
}

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
  async function buildPackage(items, session, activityType = 'questionset', title) {
    const worker = new WorkerClass(path.join(__dirname, '../../backend/h5pPackageWorker.js'), {
      workerData: { questions: items, items, activityType, title }
    });
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
    const activityConfig = resolveGenerationConfig(request.activityType);
    if (!activityConfig || !isValidActivityCount(activityConfig.workerType, request.questionCount)) {
      return fail('UNSUPPORTED_TYPE');
    }
    const documents = request.documentIds.map(id => inspection.getDocument(sender, id));
    if (documents.some(doc => !doc)) return fail('DOCUMENT_NOT_FOUND');
    const source = documents.map(doc => doc.text).join('\n\n');
    if (source.length > MAX_SOURCE_CHARS) return fail('SOURCE_TOO_LARGE');
    session.busy = true;
    try {
      let key;
      try { key = storage.getApiKey(); } catch { return fail('MISSING_KEY'); }
      if (!key) return fail('MISSING_KEY');
      const items = await generate(source, key, request.instructions, request.questionCount, {
        signal: AbortSignal.any([session.abort.signal, AbortSignal.timeout(90000)]),
        activityType: activityConfig.workerType
      });
      if (session.closed || sender.isDestroyed() || request.documentIds.some((id, i) => inspection.getDocument(sender, id) !== documents[i])) return fail('DOCUMENT_NOT_FOUND');
      const safeTitle = typeof request.title === 'string' && request.title.trim() ? request.title.trim() : undefined;
      let bytes;
      try { bytes = await buildPackage(items, session, activityConfig.workerType, safeTitle); }
      catch { return fail('PACKAGE_FAILED'); }
      if (session.closed || sender.isDestroyed() || request.documentIds.some((id, i) => inspection.getDocument(sender, id) !== documents[i])) return fail('DOCUMENT_NOT_FOUND');
      const packageId = randomUUID();
      session.package = { id: packageId, bytes, h5pType: activityConfig.projectLabel };
      return { status: 'ok', kind: 'package', packageId, questionCount: items.length };
    } catch (error) {
      const code = ['API_KEY_INVALID', 'QUOTA', 'INVALID_RESPONSE', 'NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'API_REQUEST_FAILED', 'GENERATION_TIMEOUT', 'GENERATION_CANCELLED'].includes(error?.message) ? error.message : 'GENERATION_FAILED';
      if (code === 'INVALID_RESPONSE' && Object.hasOwn(RESPONSE_REASONS, error.reason)) {
        return { ...fail(code), reason: error.reason, message: `No se pudo validar la actividad. ${RESPONSE_REASONS[error.reason]}` };
      }
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
      try {
        await writeH5PFile(pkg.bytes, filePath, {
          fileSystem,
          checkBeforeRename: () => !session.closed && !event.sender.isDestroyed() && session.package?.id === request.packageId
        });
      } catch (error) {
        if (error?.code === 'WRITE_ABORTED') return fail('NOT_FOUND');
        return fail('SAVE_FAILED');
      }
      let projectSaved = true;
      try { storage.saveProject({ title: path.basename(filePath, path.extname(filePath)), courseId, h5pType: pkg.h5pType || 'Cuestionario de opción múltiple', filePath, fileSizeBytes: pkg.bytes.length }); } catch { projectSaved = false; }
      return { status: 'ok', fileName: path.basename(filePath), projectSaved };
    } catch { return fail('SAVE_FAILED'); }
    finally { session.busy = false; }
  }
  return { generateH5P, saveH5PFile };
}
module.exports = { createH5PGeneration };
