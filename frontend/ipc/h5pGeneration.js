'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { generateQuestionsFromChunk, MAX_SOURCE_CHARS, RESPONSE_REASONS } = require('../../backend/llmClient');
const { ACTIVITY_SPECS, resolveActivityType, isValidActivityCount } = require('../../backend/prompts');
const { writeH5PFile } = require('../../backend/h5pPacker');
const { createEditableActivity, toPackageItems } = require('../../backend/editor/editableActivity');
const { confirmActivityReview } = require('../../backend/editor/activityEdits');

const EDITABLE_TYPES = new Set(['questionset', 'multichoice', 'truefalse']);

const messages = {
  DOCUMENT_NOT_FOUND: 'Los documentos ya no están disponibles. Vuelve a seleccionarlos.',
  SOURCE_TOO_LARGE: 'El texto de los documentos supera el límite para una generación.',
  MISSING_KEY: 'Configura una clave de Gemini antes de generar.',
  SECURE_STORAGE_UNAVAILABLE: 'No se pudo acceder al almacenamiento seguro de claves en este equipo.',
  API_KEY_INVALID: 'La clave de Gemini no es válida.',
  API_ACCESS_DENIED: 'Gemini denegó el acceso. Revisa los permisos del proyecto en Google AI Studio.',
  MODEL_UNAVAILABLE: 'No hay un modelo de Gemini disponible para generar la actividad.',
  QUOTA: 'Gemini ha alcanzado el límite de solicitudes. Inténtalo más tarde.',
  INVALID_RESPONSE: 'Gemini no devolvió contenido válido para la actividad. Inténtalo nuevamente.',
  GENERATION_FAILED: 'No se pudo completar la generación. Inténtalo nuevamente.',
  NETWORK_ERROR: 'No se pudo conectar con Gemini. Comprueba tu conexión.',
  SERVICE_UNAVAILABLE: 'Gemini no está disponible en este momento. Inténtalo más tarde.',
  API_REQUEST_FAILED: 'Gemini rechazó la solicitud. Revisa la configuración y el acceso al modelo.',
  GENERATION_TIMEOUT: 'Gemini no respondió a tiempo. Inténtalo más tarde.',
  GENERATION_CANCELLED: 'La generación fue cancelada.',
  PACKAGE_FAILED: 'Se generó el contenido, pero no se pudo preparar el archivo H5P.',
  NOT_FOUND: 'La actividad preparada ya no está disponible. Vuelve a generarla.',
  INVALID_COURSE: 'El ramo seleccionado ya no está disponible.',
  UNSUPPORTED_TYPE: 'El tipo de actividad o la cantidad solicitada no están disponibles.',
  BUSY: 'Hay una operación en curso. Espera a que termine.',
  SAVE_FAILED: 'No se pudo guardar el archivo. Inténtalo nuevamente.',
  SESSION_NOT_FOUND: 'La sesión de edición ya no está activa. Vuelve a abrir la actividad.',
  NO_EDITABLE_CONTENT: 'Todavía no hay contenido generado para editar en esta sesión.',
  EDITOR_SESSION_REQUIRED: 'Esta actividad requiere abrir una sesión del editor antes de generar.',
  PERSISTENCE_FAILED: 'No se pudo guardar el borrador editable. Conserva esta ventana abierta e inténtalo de nuevo.',
  REVISION_CONFLICT: 'La actividad cambió desde tu última lectura. Actualiza antes de continuar.',
  INVALID_CONTENT: 'La actividad tiene campos pendientes o con errores. Corrige los errores antes de exportar.',
  DRAFT_NOT_FOUND: 'El borrador solicitado ya no está disponible.',
  EDITORIAL_TOO_LARGE: 'El contenido de la actividad supera el tamaño máximo permitido.'
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

function resolveDefaultSaveDirectory(app) {
  for (const key of ['documents', 'home']) {
    try {
      const dir = app?.getPath?.(key);
      if (typeof dir === 'string' && dir) return dir;
    } catch {}
  }
  return os.homedir();
}

const NATIVE_NOTIFICATIONS = {
  GENERATION_READY: 'Actividad H5P lista para guardar.',
  EDITABLE_READY: 'Actividad H5P lista para revisar.',
  GENERATION_ERROR: 'No se pudo completar la generación H5P.',
  SAVE_COMPLETE: 'Archivo H5P guardado.'
};

function createH5PGeneration({ inspection, storage, dialog, BrowserWindow, app, generate = generateQuestionsFromChunk, WorkerClass = Worker, fileSystem = fs, notify = () => {}, editor = null }) {
  const sessions = new WeakMap();
  editor?.onSessionInvalidated?.((editorSession, reason) => {
    const winSession = sessions.get(editorSession.sender);
    if (!winSession || !winSession.package) return;
    if (winSession.package.editorSessionId !== editorSession.id) return;
    if (reason === 'content-changed' || reason === 'regenerated') {
      winSession.stalePackageIds.add(winSession.package.id);
    }
    winSession.package = null;
  });
  function sendNativeNotification(event, body) {
    if (typeof notify !== 'function' || typeof body !== 'string' || !body) return;
    try {
      notify(event, body);
    } catch {
      // El aviso visible dentro de la aplicación sigue disponible.
    }
  }
  function sessionFor(sender) {
    let session = sessions.get(sender);
    if (session) return session;
    session = { closed: false, busy: false, package: null, stalePackageIds: new Set(), abort: new AbortController(), requestAbort: null, worker: null };
    sessions.set(sender, session);
    const close = () => {
      session.closed = true; session.package = null; session.stalePackageIds.clear();
      session.requestAbort?.abort(); session.requestAbort = null;
      session.abort.abort();
      if (session.worker) Promise.resolve(session.worker.terminate()).catch(() => {});
      if (sessions.get(sender) === session) sessions.delete(sender);
      sender.removeListener('destroyed', close); sender.removeListener('did-start-navigation', navigation);
    };
    const navigation = (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) close(); };
    sender.once('destroyed', close); sender.on('did-start-navigation', navigation);
    return session;
  }
  async function buildPackage(items, session, activityType = 'questionset', title, { reviewed = false } = {}) {
    const workerData = reviewed
      ? { activityType, items, title, reviewed: true }
      : { questions: items, items, activityType, title };
    const worker = new WorkerClass(path.join(__dirname, '../../backend/h5pPackageWorker.js'), {
      workerData
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
    const isEditableType = EDITABLE_TYPES.has(activityConfig.workerType);
    const hasSessionId = typeof request.sessionId === 'string';
    if (!isEditableType && hasSessionId) return fail('UNSUPPORTED_TYPE');
    const useEditorialRoute = isEditableType && hasSessionId;
    if (useEditorialRoute) {
      const editorSession = editor?.getSession?.(sender, request.sessionId);
      if (!editorSession) return fail('SESSION_NOT_FOUND');
      if (editorSession.busy) return fail('BUSY');
    }
    const documents = request.documentIds.map(id => inspection.getDocument(sender, id));
    if (documents.some(doc => !doc)) return fail('DOCUMENT_NOT_FOUND');
    const source = documents.map(doc => doc.text).join('\n\n');
    if (source.length > MAX_SOURCE_CHARS) return fail('SOURCE_TOO_LARGE');
    session.busy = true;
    if (useEditorialRoute) editor.setSessionBusy(sender, request.sessionId, true);
    const requestAbort = new AbortController();
    session.requestAbort = requestAbort;
    try {
      let key;
      try { key = storage.getApiKey(); } catch { return fail('SECURE_STORAGE_UNAVAILABLE'); }
      if (!key) return fail('MISSING_KEY');
      const items = await generate(source, key, request.instructions, request.questionCount, {
        signal: AbortSignal.any([session.abort.signal, requestAbort.signal]),
        activityType: activityConfig.workerType
      });
      if (requestAbort.signal.aborted && !session.closed) return fail('GENERATION_CANCELLED');
      if (session.closed || sender.isDestroyed() || request.documentIds.some((id, i) => inspection.getDocument(sender, id) !== documents[i])) return fail('DOCUMENT_NOT_FOUND');
      const safeTitle = typeof request.title === 'string' && request.title.trim() ? request.title.trim() : undefined;
      const sourceFiles = documents
        .map(doc => (typeof doc?.name === 'string' && doc.name.trim() ? { name: doc.name.trim().slice(0, 255) } : null))
        .filter(Boolean);
      if (useEditorialRoute) {
        if (!editor?.getSession?.(sender, request.sessionId)) return fail('SESSION_NOT_FOUND');
        let editableActivity;
        try {
          editableActivity = createEditableActivity({
            activityType: activityConfig.workerType,
            title: safeTitle,
            items
          });
        } catch {
          if (!session.closed && !sender.isDestroyed()) sendNativeNotification(event, NATIVE_NOTIFICATIONS.GENERATION_ERROR);
          return fail('INVALID_RESPONSE');
        }
        const saved = editor.saveGeneratedContent(sender, request.sessionId, {
          activity: editableActivity,
          source: {
            activityType: activityConfig.workerType,
            questionCount: request.questionCount,
            title: safeTitle || null,
            instructions: request.instructions
          },
          sourceFiles
        });
        if (saved.status !== 'ok') {
          if (!session.closed && !sender.isDestroyed()) sendNativeNotification(event, NATIVE_NOTIFICATIONS.GENERATION_ERROR);
          return saved;
        }
        sendNativeNotification(event, NATIVE_NOTIFICATIONS.EDITABLE_READY);
        return {
          status: 'ok',
          kind: 'editable',
          sessionId: saved.sessionId,
          draftId: saved.draftId,
          courseId: saved.courseId,
          activity: saved.activity,
          issues: saved.issues,
          source: saved.source,
          questionCount: saved.activity.items.length
        };
      }
      let bytes;
      try { bytes = await buildPackage(items, session, activityConfig.workerType, safeTitle); }
      catch {
        if (requestAbort.signal.aborted && !session.closed) return fail('GENERATION_CANCELLED');
        if (!session.closed && !sender.isDestroyed()) sendNativeNotification(event, NATIVE_NOTIFICATIONS.GENERATION_ERROR);
        return fail('PACKAGE_FAILED');
      }
      if (requestAbort.signal.aborted && !session.closed) return fail('GENERATION_CANCELLED');
      if (session.closed || sender.isDestroyed() || request.documentIds.some((id, i) => inspection.getDocument(sender, id) !== documents[i])) return fail('DOCUMENT_NOT_FOUND');
      const packageId = randomUUID();
      session.package = { id: packageId, bytes, h5pType: activityConfig.projectLabel, sourceFiles };
      sendNativeNotification(event, NATIVE_NOTIFICATIONS.GENERATION_READY);
      return { status: 'ok', kind: 'package', packageId, questionCount: items.length };
    } catch (error) {
      if (requestAbort.signal.aborted && !session.closed) return fail('GENERATION_CANCELLED');
      const code = ['API_KEY_INVALID', 'API_ACCESS_DENIED', 'MODEL_UNAVAILABLE', 'QUOTA', 'INVALID_RESPONSE', 'NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'API_REQUEST_FAILED', 'GENERATION_TIMEOUT', 'GENERATION_CANCELLED'].includes(error?.message) ? error.message : 'GENERATION_FAILED';
      if (!session.closed && !sender.isDestroyed() && code !== 'GENERATION_CANCELLED') {
        sendNativeNotification(event, NATIVE_NOTIFICATIONS.GENERATION_ERROR);
      }
      if (code === 'INVALID_RESPONSE' && Object.hasOwn(RESPONSE_REASONS, error.reason)) {
        return { ...fail(code), reason: error.reason, message: `No se pudo validar la actividad. ${RESPONSE_REASONS[error.reason]}` };
      }
      return fail(code);
    } finally {
      if (useEditorialRoute) editor?.setSessionBusy?.(sender, request.sessionId, false);
      if (session.requestAbort === requestAbort) session.requestAbort = null;
      session.busy = false;
    }
  }
  async function prepareReviewed(request, event) {
    const sender = event.sender;
    const session = sessionFor(sender);
    if (session.busy) return fail('BUSY');
    const editorSession = editor?.getSession?.(sender, request.sessionId);
    if (!editorSession) return fail('SESSION_NOT_FOUND');
    if (editorSession.busy) return fail('BUSY');
    if (!editorSession.activity || !editorSession.source) return fail('NO_EDITABLE_CONTENT');
    if (editorSession.activity.revision !== request.expectedRevision) {
      return { ...fail('REVISION_CONFLICT'), revision: editorSession.activity.revision };
    }

    let confirmedActivity;
    try {
      confirmedActivity = confirmActivityReview(editorSession.activity);
    } catch (error) {
      if (error?.code === 'INVALID_CONTENT') {
        return { ...fail('INVALID_CONTENT'), issues: error.issues || [] };
      }
      return fail('INVALID_CONTENT');
    }

    let projectedItems;
    try {
      projectedItems = toPackageItems(confirmedActivity);
    } catch {
      return fail('INVALID_CONTENT');
    }

    const activityConfig = resolveGenerationConfig(confirmedActivity.activityType);
    if (!activityConfig) return fail('UNSUPPORTED_TYPE');

    session.busy = true;
    editor.setSessionBusy(sender, request.sessionId, true);
    const requestAbort = new AbortController();
    session.requestAbort = requestAbort;
    try {
      const saved = editor.saveConfirmedActivity(sender, request.sessionId, confirmedActivity);
      if (saved.status !== 'ok') return saved;

      let bytes;
      try {
        bytes = await buildPackage(projectedItems, session, confirmedActivity.activityType, confirmedActivity.title, { reviewed: true });
      } catch {
        if (requestAbort.signal.aborted && !session.closed) return fail('GENERATION_CANCELLED');
        if (!session.closed && !sender.isDestroyed()) sendNativeNotification(event, NATIVE_NOTIFICATIONS.GENERATION_ERROR);
        return fail('PACKAGE_FAILED');
      }

      if (requestAbort.signal.aborted && !session.closed) return fail('GENERATION_CANCELLED');
      if (session.closed || sender.isDestroyed()) return fail('SESSION_NOT_FOUND');
      const currentEditor = editor.getSession(sender, request.sessionId);
      if (!currentEditor) return fail('SESSION_NOT_FOUND');
      if (currentEditor.activity?.revision !== confirmedActivity.revision ||
          currentEditor.activity?.reviewedRevision !== confirmedActivity.revision) {
        return { ...fail('REVISION_CONFLICT'), revision: currentEditor.activity?.revision };
      }

      const packageId = randomUUID();
      session.package = {
        id: packageId,
        bytes,
        h5pType: activityConfig.projectLabel,
        sourceFiles: Array.isArray(currentEditor.sourceFiles) ? [...currentEditor.sourceFiles] : [],
        editorSessionId: currentEditor.id,
        draftId: currentEditor.draftId,
        revision: confirmedActivity.revision,
        editorialSnapshot: structuredClone({
          activity: confirmedActivity,
          source: currentEditor.source
        })
      };

      return {
        status: 'ok',
        packageId,
        sessionId: currentEditor.id,
        revision: confirmedActivity.revision,
        reviewedRevision: confirmedActivity.reviewedRevision,
        questionCount: confirmedActivity.items.length,
        title: confirmedActivity.title
      };
    } finally {
      editor?.setSessionBusy?.(sender, request.sessionId, false);
      if (session.requestAbort === requestAbort) session.requestAbort = null;
      session.busy = false;
    }
  }
  async function cancelGeneration(_request, event) {
    const session = sessions.get(event.sender);
    if (!session || session.closed) return { status: 'ok', cancelled: false };
    const hadActive = Boolean(session.requestAbort || session.worker);
    if (session.requestAbort) session.requestAbort.abort();
    if (session.worker) Promise.resolve(session.worker.terminate()).catch(() => {});
    return { status: 'ok', cancelled: hadActive };
  }
  function verifyPackageCurrent(pkg, sender, session, packageId) {
    if (!session || session.closed || sender.isDestroyed() || session.package?.id !== packageId) {
      return session?.stalePackageIds?.has(packageId) ? 'REVISION_CONFLICT' : 'NOT_FOUND';
    }
    if (pkg.editorSessionId) {
      const editorSession = editor?.getSession?.(sender, pkg.editorSessionId);
      if (!editorSession) return 'NOT_FOUND';
      if (editorSession.activity?.revision !== pkg.revision ||
          editorSession.activity?.reviewedRevision !== pkg.revision) {
        return 'REVISION_CONFLICT';
      }
    }
    return null;
  }
  async function saveH5PFile(request, event) {
    const sender = event.sender;
    const session = sessions.get(sender);
    if (!session || session.closed) return fail('NOT_FOUND');
    if (session.package?.id !== request.packageId) {
      return fail(session.stalePackageIds?.has(request.packageId) ? 'REVISION_CONFLICT' : 'NOT_FOUND');
    }
    if (session.busy) return fail('BUSY');
    const pkg = session.package;
    const preDialogError = verifyPackageCurrent(pkg, sender, session, request.packageId);
    if (preDialogError) return fail(preDialogError);
    const editorCourseId = pkg.editorSessionId ? editor?.getSession?.(sender, pkg.editorSessionId)?.courseId : null;
    const courseId = request.courseId || editorCourseId || 'unassigned';
    if (courseId !== 'unassigned' && !storage.getCourseById(courseId)) return fail('INVALID_COURSE');
    session.busy = true;
    try {
      const proposed = request.suggestedName.trim().replace(/\.h5p$/i, '').trim() + '.h5p';
      const choice = await dialog.showSaveDialog(BrowserWindow.fromWebContents(sender), {
        title: 'Guardar actividad H5P', defaultPath: path.join(resolveDefaultSaveDirectory(app), proposed),
        filters: [{ name: 'Actividad H5P', extensions: ['h5p'] }]
      });
      if (choice.canceled || !choice.filePath) return { status: 'cancelled' };
      const postDialogError = verifyPackageCurrent(pkg, sender, session, request.packageId);
      if (postDialogError) return fail(postDialogError);
      if (!/\.h5p$/i.test(choice.filePath)) {
        return { status: 'error', code: 'SAVE_FAILED', message: 'El archivo debe conservar la extensión .h5p.' };
      }
      const filePath = choice.filePath;
      let abortReason = null;
      try {
        await writeH5PFile(pkg.bytes, filePath, {
          fileSystem,
          checkBeforeRename: () => {
            abortReason = verifyPackageCurrent(pkg, sender, session, request.packageId);
            return abortReason === null;
          }
        });
      } catch (error) {
        if (error?.code === 'WRITE_ABORTED') return fail(abortReason || 'NOT_FOUND');
        return fail('SAVE_FAILED');
      }
      let projectSaved = true;
      let projectId = null;
      const projectInput = {
        title: path.basename(filePath, path.extname(filePath)),
        courseId,
        h5pType: pkg.h5pType || 'Cuestionario de opción múltiple',
        filePath,
        sourceFiles: Array.isArray(pkg.sourceFiles) ? pkg.sourceFiles : [],
        fileSizeBytes: pkg.bytes.length
      };
      try {
        const savedProject = pkg.editorialSnapshot
          ? storage.saveExportedProject(projectInput, pkg.editorialSnapshot)
          : storage.saveProject(projectInput);
        if (typeof savedProject?.id === 'string' && savedProject.id) projectId = savedProject.id;
      } catch { projectSaved = false; }

      if (pkg.editorialSnapshot) {
        let draftRemoved = false;
        if (projectSaved) {
          if (pkg.draftId && typeof storage.deleteDraft === 'function') {
            try {
              draftRemoved = Boolean(storage.deleteDraft(pkg.draftId));
            } catch {
              draftRemoved = false;
            }
          }
          if (session.package?.id === request.packageId) session.package = null;
          if (pkg.editorSessionId) editor?.closeSessionById?.(pkg.editorSessionId, 'exported');
        }
        sendNativeNotification(event, NATIVE_NOTIFICATIONS.SAVE_COMPLETE);
        return {
          status: 'ok',
          fileName: path.basename(filePath),
          fileSaved: true,
          projectSaved,
          projectId,
          draftRemoved,
          draftId: pkg.draftId || null
        };
      }

      sendNativeNotification(event, NATIVE_NOTIFICATIONS.SAVE_COMPLETE);
      return { status: 'ok', fileName: path.basename(filePath), fileSaved: true, projectSaved, projectId };
    } catch { return fail('SAVE_FAILED'); }
    finally { session.busy = false; }
  }
  return { generateH5P, prepareReviewed, cancelGeneration, saveH5PFile };
}
module.exports = { createH5PGeneration };
