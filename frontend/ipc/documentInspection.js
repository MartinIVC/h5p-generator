'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');

const MAX_DOCUMENTS = 20;
const TIMEOUT_MS = 60000;

function createDocumentInspection({ WorkerClass = Worker, timeoutMs = TIMEOUT_MS } = {}) {
  const sessions = new WeakMap();
  let activeWorker = null;

  function getSession(sender) {
    let session = sessions.get(sender);
    if (session) return session;
    session = { documents: new Map(), closed: false, worker: null };
    sessions.set(sender, session);
    const cleanup = () => {
      session.closed = true;
      session.documents.clear();
      if (session.worker) session.worker.terminate();
      if (sessions.get(sender) === session) sessions.delete(sender);
      sender.removeListener('destroyed', cleanup);
      sender.removeListener('did-start-navigation', onNavigation);
    };
    const onNavigation = (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) cleanup();
    };
    sender.once('destroyed', cleanup);
    sender.on('did-start-navigation', onNavigation);
    return session;
  }

  async function inspect(request, event) {
    const sender = event.sender;
    const session = getSession(sender);
    if (session.documents.size >= MAX_DOCUMENTS) return { status: 'error', code: 'LIMIT_REACHED', message: 'Puedes inspeccionar hasta 20 documentos.' };
    if (activeWorker) return { status: 'error', code: 'BUSY', message: 'Hay otra inspección en curso. Inténtalo nuevamente.' };
    const worker = new WorkerClass(path.join(__dirname, '../../backend/inspectionWorker.js'), {
      workerData: { name: request.name, bytes: request.bytes }
    });
    activeWorker = worker;
    session.worker = worker;
    try {
      const result = await new Promise((resolve) => {
        let settled = false;
        const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
        const timer = setTimeout(() => finish({ error: 'TIMEOUT' }), timeoutMs);
        worker.once('message', finish);
        worker.once('error', () => finish({ error: 'INSPECTION_FAILED' }));
        worker.once('exit', () => finish({ error: 'INSPECTION_FAILED' }));
      });
      if (session.closed || sender.isDestroyed()) return { status: 'error', code: 'INSPECTION_FAILED', message: 'No se pudo inspeccionar el documento.' };
      if (typeof result?.text !== 'string') {
        const code = ['TIMEOUT', 'TEXT_TOO_LARGE'].includes(result?.error) ? result.error : 'INSPECTION_FAILED';
        const message = code === 'TIMEOUT' ? 'La inspección tardó demasiado. Inténtalo nuevamente.' :
          code === 'TEXT_TOO_LARGE' ? 'El texto extraído supera el límite permitido.' :
            'No se pudo extraer texto legible. Revisa que el documento no esté dañado, protegido o escaneado como imagen.';
        return { status: 'error', code, message };
      }
      const documentId = randomUUID();
      session.documents.set(documentId, { name: request.name, size: request.bytes.byteLength, text: result.text });
      return { status: 'ok', documentId, name: request.name, size: request.bytes.byteLength };
    } finally {
      await worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      if (session.worker === worker) session.worker = null;
    }
  }

  function release({ documentId }, event) {
    const session = sessions.get(event.sender);
    if (!session || !session.documents.delete(documentId)) {
      return { status: 'error', code: 'NOT_FOUND', message: 'El documento ya no está disponible.' };
    }
    return { status: 'ok' };
  }

  function getDocument(sender, documentId) {
    return sessions.get(sender)?.documents.get(documentId);
  }

  return { inspect, release, getDocument };
}

module.exports = { createDocumentInspection };
