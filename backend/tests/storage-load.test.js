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

test('H5P-34 (BUG-13): protege integridad de cursos, proyectos, papelera, borradores y snapshots de respaldo', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-storage-integrity-'));
  const file = path.join(directory, 'academic_store.json');

  try {
    const storage = new AcademicStorage(file);

    // 1. saveCourse normaliza section solo-espacios a '1' e inicializa metadatos de organización
    const course = storage.saveCourse({ name: 'Redes', code: 'inf-301', term: '2026-1', section: '   ' });
    assert.equal(course.section, '1');
    assert.equal(course.isFavorite, false);
    assert.equal(course.archivedAt, null);
    assert.equal(course.lastOpenedAt, null);

    // 2. saveProject rechaza courseId inexistente y rechaza IDs duplicados
    assert.throws(() => storage.saveProject({ title: 'Guía', courseId: 'curso-inexistente' }), /ramo seleccionado/i);
    const project = storage.saveProject({ id: 'proj-1', title: 'Guía 1', courseId: course.id });
    assert.equal(project.id, 'proj-1');
    assert.throws(() => storage.saveProject({ id: 'proj-1', title: 'Guía duplicada', courseId: course.id }), /identificador/i);

    // 3. _readData tolera description no-string sin lanzar error
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.courses[0].section = '';
    raw.courses[0].description = 12345;
    fs.writeFileSync(file, JSON.stringify(raw));
    assert.equal(storage.getAllCourses()[0].section, '1');

    // 4. restoreTrashItem bloquea restaurar un ramo equivalente a uno activo
    assert.equal(storage.deleteCourse(course.id), true);
    const [trashedCourse] = storage.getTrash();
    storage.saveCourse({ name: 'Redes', code: 'INF-301', term: '2026-1', section: '1' });
    assert.throws(() => storage.restoreTrashItem(trashedCourse.id), /equivalente/i);

    // 5. inspectBackupPayload rechaza drafts o trash presentes con tipo distinto a arreglo
    const validBackup = storage.createBackupPayload();
    assert.throws(() => storage.inspectBackupPayload({ ...validBackup, data: { ...validBackup.data, drafts: 'malo' } }), /formato no válido/i);
    assert.throws(() => storage.inspectBackupPayload({ ...validBackup, data: { ...validBackup.data, trash: {} } }), /formato no válido/i);

    // 6. Dos restauraciones 'replace' consecutivas dentro del mismo ms no colisionan con EEXIST
    storage.restoreBackupPayload(validBackup, 'replace');
    storage.restoreBackupPayload(validBackup, 'replace');
    const backups = fs.readdirSync(path.join(directory, 'backups'));
    assert.equal(backups.length, 2);

    // 7. saveDraft limita prompt a 10.000 caracteres (alineado con upload.js y llmClient.js)
    const draft = storage.saveDraft({ courseId: 'unassigned', prompt: 'x'.repeat(11500), files: [] });
    assert.equal(draft.prompt.length, 10000);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('H5P-22: deduplica proyectos al sobrescribir la misma ruta y expone fileExists solo en lectura', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-22-storage-'));
  const storeFile = path.join(directory, 'academic_store.json');
  const exportedFile = path.join(directory, 'quiz-unidad-1.h5p');
  const fakeDirAsH5p = path.join(directory, 'carpeta.h5p');

  try {
    fs.writeFileSync(exportedFile, Buffer.from('PK\x03\x04dummy'));
    fs.mkdirSync(fakeDirAsH5p);
    const storage = new AcademicStorage(storeFile);
    const courseA = storage.saveCourse({ name: 'Biología', code: 'BIO-101', term: '2026-1', section: '1' });
    const courseB = storage.saveCourse({ name: 'Química', code: 'QUI-101', term: '2026-1', section: '1' });

    // Primer guardado en courseA
    const first = storage.saveProject({
      title: 'Quiz U1',
      courseId: courseA.id,
      h5pType: 'Cuestionario',
      filePath: exportedFile,
      sourceFiles: [{ name: 'apunte-1.pdf' }],
      fileSizeBytes: 1024
    });

    // Sobrescritura confirmada sobre la misma ruta física (sin id explícito) actualiza el registro sin duplicarlo
    const updated = storage.saveProject({
      title: 'Quiz U1 Actualizado',
      courseId: courseB.id,
      h5pType: 'Tarjetas didácticas',
      filePath: exportedFile,
      sourceFiles: [{ name: 'apunte-1.pdf' }, { name: 'guia-2.docx' }],
      fileSizeBytes: 2048
    });
    assert.equal(updated.id, first.id);
    assert.equal(storage.getProjects().length, 1);
    assert.equal(storage.getProjects(courseA.id).length, 0);

    const [listed] = storage.getProjects(courseB.id);
    assert.equal(listed.title, 'Quiz U1 Actualizado');
    assert.equal(listed.h5pType, 'Tarjetas didácticas');
    assert.deepEqual(listed.sourceFiles, [{ name: 'apunte-1.pdf' }, { name: 'guia-2.docx' }]);
    assert.equal(listed.fileExists, true);

    // fileExists nunca se persiste en academic_store.json ni en copias de seguridad
    const persisted = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    assert.equal(Object.hasOwn(persisted.projects[0], 'fileExists'), false);
    const backup = storage.createBackupPayload();
    assert.equal(Object.hasOwn(backup.data.projects[0], 'fileExists'), false);

    // Un directorio con nombre .h5p no cuenta como archivo existente
    assert.equal(storage.verifyFileExists(fakeDirAsH5p), false);

    // Al eliminar el archivo en disco, getProjects refleja fileExists: false
    fs.unlinkSync(exportedFile);
    assert.equal(storage.verifyFileExists(exportedFile), false);
    assert.equal(storage.getProjects(courseB.id)[0].fileExists, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
