'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDocumentInspection } = require('../../frontend/ipc/documentInspection');
const { extractTextFromBuffer } = require('../chunker');

function sender() { return Object.assign(new EventEmitter(), { isDestroyed: () => false }); }
function request(name, text) { return { name, bytes: new Uint8Array(Buffer.from(text)) }; }

function samplePdf() {
  const content = 'BT /F1 18 Tf 72 720 Td (Documento de prueba) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  return Buffer.from(`${pdf}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test('inspecciona TXT en un worker y mantiene texto privado por ventana', async () => {
  const service = createDocumentInspection();
  const a = sender(); const b = sender();
  const result = await service.inspect(request('clase.txt', 'Texto privado de la clase'), { sender: a });
  assert.equal(result.status, 'ok');
  assert.equal(result.text, undefined);
  assert.equal(service.getDocument(a, result.documentId).text, 'Texto privado de la clase');
  assert.equal(service.getDocument(b, result.documentId), undefined);
  assert.equal(service.release({ documentId: result.documentId }, { sender: b }).code, 'NOT_FOUND');
  assert.equal(service.release({ documentId: result.documentId }, { sender: a }).status, 'ok');
  assert.equal(service.getDocument(a, result.documentId), undefined);
});

test('PDF real, archivos vacíos y archivos corruptos reciben resultados seguros', async () => {
  assert.match(await extractTextFromBuffer(samplePdf(), 'ejemplo.pdf'), /Documento de prueba/);
  const service = createDocumentInspection(); const owner = sender();
  const ok = await service.inspect({ name: 'ejemplo.pdf', bytes: new Uint8Array(samplePdf()) }, { sender: owner });
  assert.equal(ok.status, 'ok');
  const bad = await service.inspect(request('roto.pdf', 'contenido privado no pdf'), { sender: owner });
  assert.equal(bad.code, 'INSPECTION_FAILED');
  assert.doesNotMatch(JSON.stringify(bad), /contenido privado/);
  const empty = await service.inspect(request('vacio.txt', '   '), { sender: owner });
  assert.equal(empty.code, 'INSPECTION_FAILED');
});

test('navegación y cierre liberan documentos; cancelar un worker no conserva resultados', async () => {
  class SlowWorker extends EventEmitter {
    terminate() { this.emit('exit', 1); return Promise.resolve(); }
  }
  const service = createDocumentInspection({ WorkerClass: SlowWorker });
  const owner = sender();
  const pending = service.inspect(request('a.txt', 'texto'), { sender: owner });
  assert.equal((await service.inspect(request('b.txt', 'texto'), { sender: owner })).code, 'BUSY');
  owner.emit('did-start-navigation', {}, 'file:', false, true);
  assert.equal((await pending).status, 'error');
  const real = createDocumentInspection();
  const result = await real.inspect(request('a.txt', 'texto legible'), { sender: owner });
  owner.emit('destroyed');
  assert.equal(real.getDocument(owner, result.documentId), undefined);
});

test('inspección supera el tiempo sin filtrar datos', async () => {
  class SlowWorker extends EventEmitter { terminate() { return Promise.resolve(); } }
  const service = createDocumentInspection({ WorkerClass: SlowWorker, timeoutMs: 5 });
  assert.equal((await service.inspect(request('a.txt', 'texto privado'), { sender: sender() })).code, 'TIMEOUT');
});
