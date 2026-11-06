'use strict';

const { parentPort, workerData } = require('node:worker_threads');
// Las bibliotecas de extracción pueden emitir mensajes que contienen datos del archivo.
console.log = console.warn = console.error = () => {};
const { extractTextFromBuffer } = require('./chunker');

(async () => {
  try {
    const text = await extractTextFromBuffer(workerData.bytes, workerData.name);
    // Limita la memoria retenida por la sesión y las respuestas del worker.
    if (Buffer.byteLength(text, 'utf8') > 5 * 1024 * 1024) {
      parentPort.postMessage({ error: 'TEXT_TOO_LARGE' });
    } else {
      parentPort.postMessage({ text });
    }
  } catch {
    parentPort.postMessage({ error: 'INSPECTION_FAILED' });
  }
})();
