const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AcademicStorage } = require('../storage');

test('un archivo de datos inválido informa un error y no se sobrescribe al guardar', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-storage-load-'));
  const file = path.join(directory, 'academic_store.json');
  const original = '{contenido inválido';

  try {
    fs.writeFileSync(file, original);
    const storage = new AcademicStorage(file);

    assert.throws(() => storage.getAllCourses(), /No se pudieron leer los datos locales/);
    assert.throws(() => storage.saveCourse({ name: 'Ramo de prueba' }), /No se pudieron leer los datos locales/);
    assert.equal(fs.readFileSync(file, 'utf8'), original);

    const invalidStructure = JSON.stringify({ courses: [], projects: {} });
    fs.writeFileSync(file, invalidStructure);
    assert.throws(() => storage.getAllCourses(), /No se pudieron leer los datos locales/);
    assert.throws(() => storage.saveCourse({ name: 'Ramo de prueba' }), /No se pudieron leer los datos locales/);
    assert.equal(fs.readFileSync(file, 'utf8'), invalidStructure);

    fs.writeFileSync(file, JSON.stringify({ courses: [], projects: [], settings: {}, drafts: [], trash: [] }));
    assert.deepEqual(storage.getAllCourses(), []);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
