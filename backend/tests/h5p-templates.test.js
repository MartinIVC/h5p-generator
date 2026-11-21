'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const JSZip = require('jszip');

const {
  TEMPLATE_TYPES,
  loadManifest,
  listTemplates,
  loadTemplate,
  validateH5PMetadata,
  resolveLibraryClosure,
  createBasePackageZip,
  validateH5PPackage
} = require('../h5pTemplates');

const EXPECTED_CATALOG = [
  { type: 'multichoice', mainLibrary: 'H5P.MultiChoice', mainKey: 'H5P.MultiChoice 1.14', runtime: 7, full: 10 },
  { type: 'questionset', mainLibrary: 'H5P.QuestionSet', mainKey: 'H5P.QuestionSet 1.17', runtime: 10, full: 15 },
  { type: 'truefalse', mainLibrary: 'H5P.TrueFalse', mainKey: 'H5P.TrueFalse 1.8', runtime: 6, full: 8 },
  { type: 'blanks', mainLibrary: 'H5P.Blanks', mainKey: 'H5P.Blanks 1.14', runtime: 7, full: 10 },
  { type: 'dragtext', mainLibrary: 'H5P.DragText', mainKey: 'H5P.DragText 1.10', runtime: 7, full: 10 },
  { type: 'singlechoiceset', mainLibrary: 'H5P.SingleChoiceSet', mainKey: 'H5P.SingleChoiceSet 1.11', runtime: 6, full: 11 },
  { type: 'summary', mainLibrary: 'H5P.Summary', mainKey: 'H5P.Summary 1.10', runtime: 6, full: 9 },
  { type: 'sortparagraphs', mainLibrary: 'H5P.SortParagraphs', mainKey: 'H5P.SortParagraphs 0.11', runtime: 6, full: 9 },
  { type: 'crossword', mainLibrary: 'H5P.Crossword', mainKey: 'H5P.Crossword 0.5', runtime: 8, full: 13 },
  { type: 'findthewords', mainLibrary: 'H5P.FindTheWords', mainKey: 'H5P.FindTheWords 1.4', runtime: 6, full: 6 },
  { type: 'accordion', mainLibrary: 'H5P.Accordion', mainKey: 'H5P.Accordion 1.0', runtime: 3, full: 3 },
  { type: 'flashcards', mainLibrary: 'H5P.Flashcards', mainKey: 'H5P.Flashcards 1.7', runtime: 5, full: 6 }
];

function populateSyntheticContent(type, content) {
  switch (type) {
    case TEMPLATE_TYPES.MULTICHOICE:
      content.question = '<p>¿Qué garantiza el principio de aislamiento en Electron?</p>';
      content.answers = [
        { text: '<div>Separar el renderer del acceso directo a Node.js</div>', correct: true, tipsAndFeedback: { tip: '', chosenFeedback: '', notChosenFeedback: '' } },
        { text: '<div>Comprimir archivos ZIP automáticamente</div>', correct: false, tipsAndFeedback: { tip: '', chosenFeedback: '', notChosenFeedback: '' } },
        { text: '<div>Evitar el uso de CSS en la interfaz</div>', correct: false, tipsAndFeedback: { tip: '', chosenFeedback: '', notChosenFeedback: '' } },
        { text: '<div>Desactivar el almacenamiento seguro</div>', correct: false, tipsAndFeedback: { tip: '', chosenFeedback: '', notChosenFeedback: '' } }
      ];
      content.overallFeedback = [{ from: 0, to: 100, feedback: 'contextIsolation evita exponer primitivas de Node.js al renderer.' }];
      return content;

    case TEMPLATE_TYPES.TRUEFALSE:
      content.question = '<p>En H5P, los campos majorVersion y minorVersion de h5p.json deben ser enteros.</p>';
      content.correct = 'true';
      content.behaviour.feedbackOnCorrect = 'Correcto: la especificación oficial de H5P exige enteros no negativos.';
      content.behaviour.feedbackOnWrong = 'Incorrecto: el esquema oficial define ambos campos como enteros.';
      return content;

    case TEMPLATE_TYPES.BLANKS:
      content.questions = [
        '<p>El archivo *h5p.json* declara las dependencias del paquete y los datos residen en *content.json*.</p>'
      ];
      return content;

    case TEMPLATE_TYPES.DRAGTEXT:
      content.textField = 'En Electron, *contextIsolation* separa el contexto del renderer y *preload* expone una API explícita.';
      return content;

    case TEMPLATE_TYPES.SINGLECHOICESET:
      content.choices = [
        { subContentId: crypto.randomUUID(), question: '<p>¿Qué formato de compresión usa un archivo .h5p?</p>', answers: ['ZIP', 'TAR', 'RAR', '7Z'] },
        { subContentId: crypto.randomUUID(), question: '<p>¿Dónde se declara mainLibrary?</p>', answers: ['h5p.json', 'package.json', 'index.html', 'content.json'] }
      ];
      return content;

    case TEMPLATE_TYPES.SUMMARY:
      content.summaries = [
        { subContentId: crypto.randomUUID(), summary: ['Un paquete H5P autocontenido incluye sus bibliotecas requeridas.', 'Un paquete H5P nunca puede incluir archivos JavaScript.'], tip: '' },
        { subContentId: crypto.randomUUID(), summary: ['El archivo content/content.json almacena los parámetros de la actividad.', 'Los parámetros de la actividad se guardan en README.md.'], tip: '' }
      ];
      return content;

    case TEMPLATE_TYPES.SORTPARAGRAPHS:
      content.paragraphs = [
        '<p>1. Inspeccionar los documentos en el worker aislado.</p>',
        '<p>2. Enviar el texto a Gemini con esquema JSON estricto.</p>',
        '<p>3. Validar las respuestas localmente y ensamblar el archivo .h5p.</p>'
      ];
      return content;

    case TEMPLATE_TYPES.CROSSWORD:
      content.words = [
        { clue: 'Estándar abierto de paquetes interactivos HTML5', answer: 'H5P', fixWord: false },
        { clue: 'Entorno de escritorio basado en Chromium y Node', answer: 'ELECTRON', fixWord: false },
        { clue: 'Plataforma LMS objetivo del proyecto', answer: 'MOODLE', fixWord: false }
      ];
      return content;

    case TEMPLATE_TYPES.FINDTHEWORDS:
      content.wordList = 'electron,moodle,lumi,paquete,plantilla';
      return content;

    case TEMPLATE_TYPES.ACCORDION:
      content.panels = [
        {
          title: '¿Qué es h5p.json?',
          content: {
            library: 'H5P.AdvancedText 1.1',
            subContentId: crypto.randomUUID(),
            metadata: { contentType: 'Text', license: 'U', title: '¿Qué es h5p.json?' },
            params: { text: '<p>Archivo de metadatos en la raíz del paquete que declara mainLibrary y preloadedDependencies.</p>' }
          }
        },
        {
          title: '¿Qué es content/content.json?',
          content: {
            library: 'H5P.AdvancedText 1.1',
            subContentId: crypto.randomUUID(),
            metadata: { contentType: 'Text', license: 'U', title: '¿Qué es content/content.json?' },
            params: { text: '<p>Archivo JSON que contiene los parámetros y preguntas de la actividad H5P.</p>' }
          }
        }
      ];
      return content;

    case TEMPLATE_TYPES.FLASHCARDS:
      content.cards = [
        { text: 'Archivo raíz que declara dependencias en H5P', answer: 'h5p.json', tip: 'Está fuera de content/' },
        { text: 'Propiedad de BrowserWindow que aísla el contexto del renderer', answer: 'contextIsolation', tip: 'Es un booleano de seguridad' }
      ];
      return content;

    default:
      throw new Error(`Tipo sintético no configurado: ${type}`);
  }
}

test('H5P-15: catálogo completo registra 12 formatos y todas las bibliotecas cumplen coreApi <= 1.24', async () => {
  const manifest = await loadManifest();
  const list = await listTemplates();
  assert.equal(manifest.maxCoreApi, '1.24');
  assert.equal(list.length, 12);
  assert.deepEqual(list.map(t => t.type), EXPECTED_CATALOG.map(e => e.type));
  assert.deepEqual(Object.values(TEMPLATE_TYPES), EXPECTED_CATALOG.map(e => e.type));

  // Verificar que ninguna biblioteca del manifiesto supera coreApi 1.24
  assert.equal(manifest.libraries.length, 36);
  for (const lib of manifest.libraries) {
    if (!lib.coreApi) continue;
    const [major, minor] = lib.coreApi.split('.').map(Number);
    assert.ok(major < 1 || (major === 1 && minor <= 24), `${lib.dir} excede coreApi 1.24 (${lib.coreApi})`);
  }
});

test('H5P-15: los 12 formatos cumplen especificación h5p.json, clausuras exactas y aislamiento en createBasePackageZip', async () => {
  for (const spec of EXPECTED_CATALOG) {
    const tpl = await loadTemplate(spec.type);
    assert.equal(tpl.mainLibrary, spec.mainLibrary, spec.type);
    assert.equal(tpl.mainLibraryKey, spec.mainKey, spec.type);
    assert.equal(tpl.metadata.language, 'es', spec.type);
    assert.deepEqual(tpl.metadata.embedTypes, ['iframe'], spec.type);

    for (const dep of tpl.metadata.preloadedDependencies) {
      assert.equal(typeof dep.majorVersion, 'number', `${spec.type}: ${dep.machineName}`);
      assert.equal(typeof dep.minorVersion, 'number', `${spec.type}: ${dep.machineName}`);
      assert.ok(Number.isInteger(dep.majorVersion) && dep.majorVersion >= 0);
      assert.ok(Number.isInteger(dep.minorVersion) && dep.minorVersion >= 0);
    }

    const runtimeClosure = await resolveLibraryClosure(spec.type, { includeEditor: false });
    const fullClosure = await resolveLibraryClosure(spec.type, { includeEditor: true });
    assert.equal(runtimeClosure.length, spec.runtime, `${spec.type} runtime closure`);
    assert.equal(fullClosure.length, spec.full, `${spec.type} full closure`);

    // Exact match entre preloadedDependencies de h5p.json y clausura runtime real
    const declaredKeys = tpl.metadata.preloadedDependencies.map(d => `${d.machineName} ${d.majorVersion}.${d.minorVersion}`).sort();
    assert.deepEqual(declaredKeys, runtimeClosure.map(c => c.key), `${spec.type} preloadedDependencies`);

    // Aislamiento exacto de carpetas en createBasePackageZip
    const zip = await createBasePackageZip(spec.type);
    const topDirs = new Set(Object.keys(zip.files).map(p => p.split('/')[0]));
    assert.equal(topDirs.size, spec.full, `${spec.type} topDirs`);
    assert.equal(topDirs.has('content'), false, `${spec.type} no debe incluir content/`);
  }

  // Coexistencia y aislamiento de versiones/bibliotecas específicas
  const mcDirs = new Set(Object.keys((await createBasePackageZip(TEMPLATE_TYPES.MULTICHOICE)).files).map(p => p.split('/')[0]));
  const tfDirs = new Set(Object.keys((await createBasePackageZip(TEMPLATE_TYPES.TRUEFALSE)).files).map(p => p.split('/')[0]));
  const cwDirs = new Set(Object.keys((await createBasePackageZip(TEMPLATE_TYPES.CROSSWORD)).files).map(p => p.split('/')[0]));
  const accDirs = new Set(Object.keys((await createBasePackageZip(TEMPLATE_TYPES.ACCORDION)).files).map(p => p.split('/')[0]));
  const dtDirs = new Set(Object.keys((await createBasePackageZip(TEMPLATE_TYPES.DRAGTEXT)).files).map(p => p.split('/')[0]));

  assert.equal(mcDirs.has('H5P.Question-1.4'), true);
  assert.equal(mcDirs.has('H5P.Question-1.5'), false);
  assert.equal(tfDirs.has('H5P.Question-1.5'), true);
  assert.equal(tfDirs.has('H5P.Question-1.4'), false);
  assert.equal(cwDirs.has('H5P.MaterialDesignIcons-1.0'), true);
  assert.equal(mcDirs.has('H5P.MaterialDesignIcons-1.0'), false);
  assert.equal(accDirs.has('H5P.AdvancedText-1.1'), true);
  assert.equal(dtDirs.has('jQuery.ui-1.10'), true);
  assert.equal(mcDirs.has('jQuery.ui-1.10'), false);
});

test('H5P-15: paquetes sintéticos de los 12 formatos pasan validateH5PPackage', async () => {
  // 11 formatos ensamblados directamente desde las plantillas estáticas
  for (const spec of EXPECTED_CATALOG.filter(s => s.type !== TEMPLATE_TYPES.QUESTIONSET)) {
    const tpl = await loadTemplate(spec.type);
    const zip = await createBasePackageZip(spec.type);
    const populated = populateSyntheticContent(spec.type, tpl.content);
    zip.file('h5p.json', JSON.stringify(tpl.metadata));
    zip.file('content/content.json', JSON.stringify(populated));
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const validation = await validateH5PPackage(buf);
    assert.equal(validation.valid, true, spec.type);
    assert.equal(validation.mainLibraryKey, spec.mainKey, spec.type);
    assert.equal(validation.preloadedCount, spec.runtime, spec.type);
    assert.equal(validation.libraryCount, spec.full, spec.type);
  }

  // Formato 12: H5P.QuestionSet ensamblado por h5pPackageWorker.js
  const workerPath = path.join(__dirname, '..', 'h5pPackageWorker.js');
  const questions = [
    { pregunta: '¿Qué archivo define los metadatos de un paquete H5P?', opciones: ['h5p.json', 'package.json', 'manifest.xml', 'index.html'], respuestaCorrecta: 'h5p.json', retroalimentacion: 'h5p.json declara mainLibrary y preloadedDependencies.' },
    { pregunta: '¿Dónde reside el contenido de la actividad H5P?', opciones: ['content/content.json', 'src/data.json', 'meta/quiz.json', 'assets/body.json'], respuestaCorrecta: 'content/content.json', retroalimentacion: 'La especificación de H5P ubica los parámetros en content/content.json.' }
  ];
  const qsBuffer = await new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { questions } });
    worker.once('message', msg => msg?.bytes ? resolve(Buffer.from(msg.bytes)) : reject(new Error('worker failed')));
    worker.once('error', reject);
  });
  const qsValidation = await validateH5PPackage(qsBuffer);
  assert.equal(qsValidation.valid, true);
  assert.equal(qsValidation.mainLibraryKey, 'H5P.QuestionSet 1.17');
  assert.equal(qsValidation.preloadedCount, 10);
  assert.equal(qsValidation.libraryCount, 15);
});

test('H5P-15: validateH5PMetadata rechaza versiones como string, duplicados y campos inválidos', () => {
  const valid = {
    title: 'Prueba',
    language: 'es',
    mainLibrary: 'H5P.MultiChoice',
    embedTypes: ['iframe'],
    preloadedDependencies: [{ machineName: 'H5P.MultiChoice', majorVersion: 1, minorVersion: 14 }]
  };
  assert.equal(validateH5PMetadata(valid).mainLibraryKey, 'H5P.MultiChoice 1.14');

  assert.throws(
    () => validateH5PMetadata({ ...valid, preloadedDependencies: [{ machineName: 'H5P.MultiChoice', majorVersion: '1', minorVersion: 14 }] }),
    { code: 'INVALID_H5P_METADATA' }
  );
  assert.throws(
    () => validateH5PMetadata({ ...valid, preloadedDependencies: [{ machineName: 'H5P.JoubelUI', majorVersion: 1, minorVersion: 3 }] }),
    { code: 'INVALID_H5P_METADATA' }
  );
  assert.throws(
    () => validateH5PMetadata({
      ...valid,
      preloadedDependencies: [
        { machineName: 'H5P.MultiChoice', majorVersion: 1, minorVersion: 14 },
        { machineName: 'H5P.MultiChoice', majorVersion: 1, minorVersion: 14 }
      ]
    }),
    { code: 'INVALID_H5P_METADATA' }
  );
  assert.throws(() => validateH5PMetadata({ ...valid, embedTypes: ['canvas'] }), { code: 'INVALID_H5P_METADATA' });
  assert.throws(() => validateH5PMetadata({ ...valid, language: 'español' }), { code: 'INVALID_H5P_METADATA' });
});

test('H5P-15: validateH5PPackage detecta ZIP corrupto, traversal, faltantes, huérfanas, sobrantes y contenido inválido por formato', async () => {
  await assert.rejects(() => validateH5PPackage(null), { code: 'INVALID_PACKAGE' });
  await assert.rejects(() => validateH5PPackage(Buffer.from('no-es-un-zip')), { code: 'INVALID_PACKAGE' });

  // Falta content/content.json
  const mcTpl = await loadTemplate(TEMPLATE_TYPES.MULTICHOICE);
  const missingContentZip = await createBasePackageZip(TEMPLATE_TYPES.MULTICHOICE);
  missingContentZip.file('h5p.json', JSON.stringify(mcTpl.metadata));
  const missingContentBuf = await missingContentZip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => validateH5PPackage(missingContentBuf), { code: 'MISSING_CONTENT_JSON' });

  // Dependencia no utilizada declarada en h5p.json
  const unusedDepZip = await createBasePackageZip(TEMPLATE_TYPES.QUESTIONSET);
  const metaWithUnused = structuredClone(mcTpl.metadata);
  metaWithUnused.preloadedDependencies.push(
    { machineName: 'H5P.Video', majorVersion: 1, minorVersion: 5 },
    { machineName: 'flowplayer', majorVersion: 1, minorVersion: 0 }
  );
  unusedDepZip.remove('H5P.QuestionSet-1.17');
  unusedDepZip.remove('H5PEditor.VerticalTabs-1.3');
  unusedDepZip.remove('H5PEditor.QuestionSetTextualEditor-1.3');
  unusedDepZip.file('h5p.json', JSON.stringify(metaWithUnused));
  unusedDepZip.file('content/content.json', JSON.stringify({ ...mcTpl.content, question: '<p>Q</p>', answers: [{ text: '<div>A</div>', correct: true }] }));
  const unusedDepBuf = await unusedDepZip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => validateH5PPackage(unusedDepBuf), { code: 'UNUSED_DEPENDENCY_DECLARATION' });

  // Dependencia faltante en el ZIP
  const missingLibZip = await createBasePackageZip(TEMPLATE_TYPES.MULTICHOICE);
  missingLibZip.remove('H5P.JoubelUI-1.3');
  missingLibZip.file('h5p.json', JSON.stringify(mcTpl.metadata));
  missingLibZip.file('content/content.json', JSON.stringify({ ...mcTpl.content, question: '<p>Q</p>', answers: [{ text: '<div>A</div>', correct: true }] }));
  const missingLibBuf = await missingLibZip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => validateH5PPackage(missingLibBuf), { code: 'MISSING_LIBRARY' });

  // Biblioteca huérfana no referenciada
  const orphanZip = await createBasePackageZip(TEMPLATE_TYPES.QUESTIONSET);
  orphanZip.file('h5p.json', JSON.stringify(mcTpl.metadata));
  orphanZip.file('content/content.json', JSON.stringify({ ...mcTpl.content, question: '<p>Q</p>', answers: [{ text: '<div>A</div>', correct: true }] }));
  const orphanBuf = await orphanZip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => validateH5PPackage(orphanBuf), { code: 'ORPHAN_LIBRARY' });

  // Validación semántica de nuevos formatos (ej. Blanks sin marcador *hueco*, Crossword con < 2 palabras)
  const blanksTpl = await loadTemplate(TEMPLATE_TYPES.BLANKS);
  const blanksZip = await createBasePackageZip(TEMPLATE_TYPES.BLANKS);
  blanksTpl.content.questions = ['<p>Sin ningún espacio marcado.</p>'];
  blanksZip.file('h5p.json', JSON.stringify(blanksTpl.metadata));
  blanksZip.file('content/content.json', JSON.stringify(blanksTpl.content));
  const badBlanksBuf = await blanksZip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => validateH5PPackage(badBlanksBuf), { code: 'INVALID_CONTENT_JSON' });

  const cwTpl = await loadTemplate(TEMPLATE_TYPES.CROSSWORD);
  const cwZip = await createBasePackageZip(TEMPLATE_TYPES.CROSSWORD);
  cwTpl.content.words = [{ clue: 'Una sola palabra', answer: 'SOLO' }];
  cwZip.file('h5p.json', JSON.stringify(cwTpl.metadata));
  cwZip.file('content/content.json', JSON.stringify(cwTpl.content));
  const badCwBuf = await cwZip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => validateH5PPackage(badCwBuf), { code: 'INVALID_CONTENT_JSON' });

  // Path traversal en ZIP
  const traversalZip = new JSZip();
  traversalZip.file('../escape.txt', 'x');
  const traversalBuf = await traversalZip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => validateH5PPackage(traversalBuf), { code: 'INVALID_PACKAGE_PATH' });
});

test('H5P-15: verifica integridad SHA-256, compuerta maxCoreApi y rechaza plantillas desconocidas', async t => {
  await assert.rejects(() => loadTemplate('interactive-video'), { code: 'UNKNOWN_TEMPLATE' });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-tpl-integrity-'));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));
  await fs.cp(path.join(__dirname, '..', 'templates'), tmpDir, { recursive: true });
  const manifestPath = path.join(tmpDir, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

  // 1. Compuerta maxCoreApi más estricta detecta bibliotecas que la superan
  manifest.maxCoreApi = '1.18';
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(() => resolveLibraryClosure(TEMPLATE_TYPES.MULTICHOICE, { templatesDir: tmpDir }), { code: 'UNSUPPORTED_CORE_API' });

  // 2. SHA-256 alterado rechaza el bundle
  manifest.maxCoreApi = '1.24';
  manifest.librariesBundle.sha256 = crypto.createHash('sha256').update('tampered').digest('hex');
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(() => resolveLibraryClosure(TEMPLATE_TYPES.MULTICHOICE, { templatesDir: tmpDir }), { code: 'BUNDLE_INTEGRITY_ERROR' });
});
