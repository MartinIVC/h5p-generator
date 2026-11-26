'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');

const { ACTIVITY_PROMPT_VERSION, ACTIVITY_SPECS } = require('../prompts');
const { generateActivityFromChunk, validateActivityItems } = require('../llmClient');
const { buildH5PContent } = require('../h5pBuilder');
const { hasZipSignature, packH5PPackage, writeH5PFile, packH5PToFile } = require('../h5pPacker');
const { validateH5PPackage } = require('../h5pTemplates');
const { createH5PGeneration } = require('../../frontend/ipc/h5pGeneration');

const SAMPLE_ITEMS_BY_TYPE = Object.freeze({
  questionset: [
    {
      pregunta: '¿Qué principio protege <H5P> en Electron?',
      opciones: ['A) Aislamiento de contexto', 'B) Compresión externa', 'C) Acceso directo a disco', 'D) Renderizado sin CSS'],
      respuestaCorrecta: 'A) Aislamiento de contexto',
      retroalimentacion: 'contextIsolation impide exponer Node.js al renderer; @score y @total son literales.'
    },
    {
      pregunta: '¿Dónde se declaran las preloadedDependencies?',
      opciones: ['h5p.json', 'content.json', 'package.json', 'README.md'],
      respuestaCorrecta: 'h5p.json',
      retroalimentacion: 'La raíz h5p.json declara mainLibrary y preloadedDependencies.'
    }
  ],
  multichoice: [
    {
      pregunta: '¿Qué archivo contiene los parámetros de una actividad H5P?',
      opciones: ['content/content.json', 'index.html', 'manifest.txt', 'styles.css'],
      respuestaCorrecta: 'content/content.json',
      retroalimentacion: 'content/content.json almacena la configuración y los reactivos.'
    }
  ],
  truefalse: [
    {
      afirmacion: 'Un paquete <H5P> válido debe declarar majorVersion como entero.',
      esVerdadera: true,
      retroalimentacionCorrecta: 'Correcto: la especificación exige enteros; @score no debe interpretarse.',
      retroalimentacionIncorrecta: 'Incorrecto: majorVersion y minorVersion nunca son cadenas; @total es literal.'
    }
  ],
  singlechoiceset: [
    {
      pregunta: '¿Qué archivo valida la integridad de libraries-bundle.zip?',
      opciones: ['A) package.json', 'B) manifest.json', 'C) preload.js', 'D) index.html'],
      respuestaCorrecta: 'B) manifest.json'
    },
    {
      pregunta: '¿Qué extensión usa un recurso interactivo exportado?',
      opciones: ['.zip', '.tar', '.h5p', '.xml'],
      respuestaCorrecta: '.h5p'
    }
  ],
  blanks: [
    {
      textoAntes: 'En Electron, la propiedad',
      respuesta: 'contextIsolation',
      textoDespues: ', separa el entorno del renderer.',
      pista: 'Configuración booleana de BrowserWindow'
    },
    {
      textoAntes: 'Las bibliotecas compartidas residen en',
      respuesta: 'libraries-bundle.zip',
      textoDespues: '.',
      pista: ''
    }
  ],
  dragtext: [
    {
      textoAntes: 'El puente seguro <preload> expone APIs con',
      palabra: 'contextBridge',
      textoDespues: '.',
      pista: 'Módulo oficial de Electron'
    },
    {
      textoAntes: 'El archivo raíz',
      palabra: 'h5p.json',
      textoDespues: 'declara mainLibrary.',
      pista: ''
    }
  ],
  summary: [
    {
      afirmacionCorrecta: 'El paquete .h5p se ensambla y valida antes de guardarlo en disco.',
      distractores: [
        'El paquete .h5p se guarda sin comprobar su estructura ZIP.',
        'El renderer escribe directamente archivos en el disco duro.'
      ],
      pista: 'Revisa el flujo del worker'
    },
    {
      afirmacionCorrecta: 'Moodle 4.1 requiere bibliotecas compatibles con coreApi <= 1.24.',
      distractores: [
        'Moodle 4.1 exige coreApi 1.27 como mínimo.',
        'Moodle ignora el campo coreApi de library.json.'
      ],
      pista: ''
    }
  ],
  sortparagraphs: [
    { parrafo: 'Inspeccionar el documento fuente en un worker aislado en memoria.' },
    { parrafo: 'Generar ítems estructurados con Gemini bajo responseJsonSchema.' },
    { parrafo: 'Inyectar content.json y comprimir el paquete .h5p validado.' }
  ],
  crossword: [
    { pista: 'Plataforma LMS institucional donde se importan actividades', palabra: 'Moodle' },
    { pista: 'Herramienta de escritorio para previsualizar H5P', palabra: 'Lumi' },
    { pista: 'Propiedad clave de arquitectura en español con eñe', palabra: 'Diseño' }
  ],
  findthewords: [
    { palabra: 'Moodle' },
    { palabra: 'Cañón' },
    { palabra: 'Paquete' },
    { palabra: 'Árbol' }
  ],
  accordion: [
    {
      titulo: '¿Qué es <h5p.json>?',
      explicacion: 'Archivo raíz que declara título, idioma, mainLibrary y dependencias.'
    },
    {
      titulo: '¿Qué valida h5pPacker?',
      explicacion: 'Comprueba la firma ZIP, la clausura de bibliotecas y la estructura de content.json.'
    }
  ],
  flashcards: [
    {
      pregunta: '¿Qué elemento de <Electron> aísla los contextos?',
      respuesta: 'contextIsolation & preload',
      pista: 'Revisa webPreferences'
    },
    {
      pregunta: '¿Qué compresión usa un archivo .h5p?',
      respuesta: 'ZIP DEFLATE',
      pista: ''
    }
  ]
});

function mockGeminiSuccess(items) {
  return async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(items) }] } }]
    })
  });
}

test('H5P-16: los 12 formatos recorren Gemini -> validador -> h5pBuilder -> h5pPacker -> validateH5PPackage con título personalizado', async () => {
  assert.equal(ACTIVITY_PROMPT_VERSION, 'h5p-16-v1');
  const types = Object.keys(ACTIVITY_SPECS);
  assert.equal(types.length, 12);

  for (const type of types) {
    const sample = SAMPLE_ITEMS_BY_TYPE[type];
    assert.ok(Array.isArray(sample) && sample.length > 0, `Falta muestra para ${type}`);

    let capturedSchema = null;
    const generated = await generateActivityFromChunk(
      type,
      'Material académico completo sobre Electron, H5P y Moodle.',
      'clave-sintetica-h5p16',
      'Enfoque conceptual de nivel intermedio.',
      sample.length,
      {
        fetch: async (_url, init) => {
          const body = JSON.parse(init.body);
          capturedSchema = body.generationConfig.responseJsonSchema;
          assert.equal(body.generationConfig.responseMimeType, 'application/json');
          assert.equal(capturedSchema.minItems, sample.length);
          assert.equal(capturedSchema.maxItems, sample.length);
          return mockGeminiSuccess(sample)();
        }
      }
    );

    const customTitle = `Actividad INF-421 (${type}).h5p`;
    const packed = await packH5PPackage(type, generated, { title: customTitle });
    assert.equal(hasZipSignature(packed.bytes), true, `${type}: encabezado ZIP inválido`);
    assert.equal(packed.validation.valid, true, `${type}: falló validateH5PPackage`);
    assert.equal(packed.itemCount, sample.length, `${type}: itemCount inesperado`);
    assert.equal(packed.title, `Actividad INF-421 (${type})`, `${type}: título no normalizado`);

    const zip = await JSZip.loadAsync(packed.bytes);
    const meta = JSON.parse(await zip.file('h5p.json').async('string'));
    const content = JSON.parse(await zip.file('content/content.json').async('string'));
    assert.equal(meta.title, `Actividad INF-421 (${type})`);

    // Verificaciones específicas de mapeo por formato
    if (type === 'questionset') {
      assert.equal(content.questions.length, 2);
      assert.equal(content.questions[0].params.question, '<p>¿Qué principio protege &lt;H5P&gt; en Electron?</p>');
      assert.equal(content.questions[0].params.answers[0].text, '<div>Aislamiento de contexto</div>');
      assert.equal(content.questions[0].params.answers[0].correct, true);
      assert.match(content.questions[0].params.overallFeedback[0].feedback, /&#64;score.*&#64;total/);
    } else if (type === 'multichoice') {
      assert.equal(content.answers.length, 4);
      assert.equal(content.answers.filter(a => a.correct).length, 1);
    } else if (type === 'truefalse') {
      assert.equal(content.correct, 'true');
      assert.equal(content.question, '<p>Un paquete &lt;H5P&gt; válido debe declarar majorVersion como entero.</p>');
      assert.match(content.behaviour.feedbackOnCorrect, /&#64;score/);
      assert.match(content.behaviour.feedbackOnWrong, /&#64;total/);
    } else if (type === 'singlechoiceset') {
      assert.equal(content.choices.length, 2);
      // answers[0] siempre debe ser la respuesta correcta sin prefijos A-D
      assert.equal(content.choices[0].answers[0], '<p>manifest.json</p>');
      assert.equal(content.choices[1].answers[0], '<p>.h5p</p>');
    } else if (type === 'blanks') {
      assert.equal(content.questions[0], '<p>En Electron, la propiedad *contextIsolation:Configuración booleana de BrowserWindow*, separa el entorno del renderer.</p>');
      assert.equal(content.questions[1], '<p>Las bibliotecas compartidas residen en *libraries-bundle.zip*.</p>');
    } else if (type === 'dragtext') {
      assert.match(content.textField, /^El puente seguro &lt;preload&gt; expone APIs con \*contextBridge:Módulo oficial de Electron\*\.\nEl archivo raíz \*h5p\.json\* declara mainLibrary\.$/);
    } else if (type === 'summary') {
      assert.equal(content.summaries.length, 2);
      assert.equal(content.summaries[0].summary[0], '<p>El paquete .h5p se ensambla y valida antes de guardarlo en disco.</p>');
      assert.equal(content.summaries[0].tip, 'Revisa el flujo del worker');
    } else if (type === 'sortparagraphs') {
      assert.equal(content.paragraphs.length, 3);
      assert.equal(content.paragraphs[0], '<p>Inspeccionar el documento fuente en un worker aislado en memoria.</p>');
    } else if (type === 'crossword') {
      assert.deepEqual(content.words.map(w => w.answer), ['MOODLE', 'LUMI', 'DISEÑO']);
      assert.equal(content.words[2].clue, 'Propiedad clave de arquitectura en español con eñe');
    } else if (type === 'findthewords') {
      assert.equal(content.wordList, 'moodle,cañon,paquete,arbol');
    } else if (type === 'accordion') {
      assert.equal(content.panels.length, 2);
      assert.equal(content.panels[0].title, '¿Qué es &lt;h5p.json&gt;?');
      assert.equal(content.panels[0].content.library, 'H5P.AdvancedText 1.1');
    } else if (type === 'flashcards') {
      assert.equal(content.cards.length, 2);
      assert.equal(content.cards[0].text, '¿Qué elemento de &lt;Electron&gt; aísla los contextos?');
      assert.equal(content.cards[0].answer, 'contextIsolation &amp; preload');
      assert.equal(content.cards[0].tip, 'Revisa webPreferences');
    }
  }
});

test('H5P-16: validadores rechazan errores específicos por formato y recuperan con una corrección de Gemini', async () => {
  // Crucigrama desconectado (sin letras compartidas)
  assert.throws(
    () => validateActivityItems('crossword', [
      { pista: 'Estrella', palabra: 'SOL' },
      { pista: 'Vehículo ferroviario', palabra: 'TREN' }
    ], 2),
    { message: 'INVALID_RESPONSE', reason: 'DISCONNECTED_WORDS' }
  );

  // Palabra con espacios o dígitos en crucigrama y sopa de letras
  assert.throws(
    () => validateActivityItems('crossword', [
      { pista: 'Pista 1', palabra: 'DOS PALABRAS' },
      { pista: 'Pista 2', palabra: 'ALGORITMO' }
    ], 2),
    { message: 'INVALID_RESPONSE', reason: 'WORD_FORMAT' }
  );
  assert.throws(
    () => validateActivityItems('findthewords', [{ palabra: 'h5p2' }, { palabra: 'moodle' }, { palabra: 'lumi' }], 3),
    { message: 'INVALID_RESPONSE', reason: 'WORD_FORMAT' }
  );

  // Asterisco ilegal y contexto vacío en blanks / dragtext
  assert.throws(
    () => validateActivityItems('blanks', [{ textoAntes: 'Con *asterisco*', respuesta: 'H5P', textoDespues: '', pista: '' }], 1),
    { message: 'INVALID_RESPONSE', reason: 'BLANK_SYNTAX' }
  );
  assert.throws(
    () => validateActivityItems('dragtext', [{ textoAntes: '', palabra: 'H5P', textoDespues: '', pista: '' }], 1),
    { message: 'INVALID_RESPONSE', reason: 'BLANK_SYNTAX' }
  );

  // SortParagraphs exige mínimo 3 y sin duplicados
  assert.throws(
    () => validateActivityItems('sortparagraphs', [{ parrafo: 'Uno' }, { parrafo: 'Dos' }], 2),
    { message: 'INVALID_RESPONSE', reason: 'COUNT' }
  );
  assert.throws(
    () => validateActivityItems('sortparagraphs', [{ parrafo: 'Igual' }, { parrafo: 'igual' }, { parrafo: 'Otro' }], 3),
    { message: 'INVALID_RESPONSE', reason: 'DUPLICATE_ITEMS' }
  );

  // TrueFalse exige exactamente 1 y booleano
  assert.throws(
    () => validateActivityItems('truefalse', SAMPLE_ITEMS_BY_TYPE.truefalse, 2),
    { message: 'INVALID_RESPONSE', reason: 'COUNT' }
  );
  assert.throws(
    () => validateActivityItems('truefalse', [{ ...SAMPLE_ITEMS_BY_TYPE.truefalse[0], esVerdadera: 'true' }], 1),
    { message: 'INVALID_RESPONSE', reason: 'CORRECT_ANSWER' }
  );

  // Recuperación correctiva de Gemini ante crucigrama inicialmente desconectado
  let calls = 0;
  const recovered = await generateActivityFromChunk('crossword', 'Apunte de redes y Moodle.', 'clave-sintetica', '', 3, {
    fetch: async (_url, init) => {
      calls++;
      const parts = JSON.parse(init.body).contents[0].parts;
      if (calls === 2) assert.match(parts[3].text, /Corrección de formato:/);
      const payload = calls === 1
        ? [{ pista: 'A', palabra: 'SOL' }, { pista: 'B', palabra: 'TREN' }, { pista: 'C', palabra: 'PUMA' }]
        : SAMPLE_ITEMS_BY_TYPE.crossword;
      return mockGeminiSuccess(payload)();
    }
  });
  assert.equal(calls, 2);
  assert.deepEqual(recovered.map(w => w.palabra), ['MOODLE', 'LUMI', 'DISEÑO']);
});

test('H5P-16: buildH5PContent aplica overrides seguros de behaviour y fallback de título', async () => {
  const prepared = await buildH5PContent('multichoice', SAMPLE_ITEMS_BY_TYPE.multichoice, {
    behaviour: { enableRetry: false, randomAnswers: true, campoInexistente: true, passPercentage: 'invalido' }
  });
  assert.equal(prepared.content.behaviour.enableRetry, false);
  assert.equal(prepared.content.behaviour.randomAnswers, true);
  assert.equal(prepared.content.behaviour.passPercentage, 100);
  assert.equal(Object.hasOwn(prepared.content.behaviour, 'campoInexistente'), false);
  assert.match(prepared.metadata.title, /parámetros de una actividad H5P/);
});

test('H5P-16 CA-3/CA-4: packH5PToFile y writeH5PFile limpian directorios temporales con fs.promises.rm en éxito, cancelación y error', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p16-packer-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  // 1. Éxito: genera archivo .h5p válido sin residuos temporales
  const destination = path.join(dir, 'tarjetas.h5p');
  const saved = await packH5PToFile('flashcards', SAMPLE_ITEMS_BY_TYPE.flashcards, destination, {
    title: 'Repaso INF 421'
  });
  assert.equal(saved.filePath, destination);
  assert.equal(saved.validation.valid, true);
  assert.equal(saved.validation.mainLibrary, 'H5P.Flashcards');
  assert.deepEqual(await fs.readdir(dir), ['tarjetas.h5p']);

  const diskBytes = await fs.readFile(destination);
  assert.equal(hasZipSignature(diskBytes), true);
  const diskValidation = await validateH5PPackage(diskBytes);
  assert.equal(diskValidation.valid, true);

  // 2. Aborto antes de rename: no crea destino y elimina directorio temporal
  const abortedPath = path.join(dir, 'abortado.h5p');
  await assert.rejects(
    writeH5PFile(diskBytes, abortedPath, { checkBeforeRename: () => false }),
    { code: 'WRITE_ABORTED' }
  );
  assert.deepEqual(await fs.readdir(dir), ['tarjetas.h5p']);

  // 3. Fallo en rename: no crea destino y ejecuta fs.promises.rm en finally
  const failedPath = path.join(dir, 'fallo.h5p');
  let rmCalledWith = null;
  const failingFs = {
    mkdir: fs.mkdir,
    writeFile: fs.writeFile,
    rename: async () => { throw new Error('EACCES'); },
    rm: async (target, opts) => {
      rmCalledWith = { target, opts };
      return fs.rm(target, opts);
    }
  };
  await assert.rejects(
    writeH5PFile(diskBytes, failedPath, { fileSystem: failingFs }),
    /EACCES/
  );
  assert.ok(rmCalledWith && rmCalledWith.target.includes('.h5p-work-'));
  assert.deepEqual(rmCalledWith.opts, { recursive: true, force: true });
  assert.deepEqual(await fs.readdir(dir), ['tarjetas.h5p']);

  // 4. Rechaza destinos sin extensión .h5p y buffers corruptos
  await assert.rejects(writeH5PFile(diskBytes, path.join(dir, 'invalido.zip')), { code: 'INVALID_DESTINATION' });
  await assert.rejects(writeH5PFile(Buffer.from('no-zip'), path.join(dir, 'corrupto.h5p')), { code: 'INVALID_PACKAGE_BUFFER' });
});

test('H5P-16: flujo IPC h5pGeneration soporta nuevos formatos, propaga title a h5p.json y rechaza rangos inválidos', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p16-ipc-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const destination = path.join(dir, 'crucigrama-inf421.h5p');
  const documentId = '22222222-3333-4444-8555-666666666666';
  const owner = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  const doc = { text: 'Apunte sobre Moodle, Lumi y diseño H5P.' };
  const projects = [];

  let receivedActivityType = null;
  const generation = createH5PGeneration({
    inspection: { getDocument: (s, id) => (s === owner && id === documentId ? doc : undefined) },
    storage: {
      getApiKey: () => 'clave-sintetica',
      getCourseById: () => ({ id: 'inf421' }),
      saveProject: project => { projects.push(project); }
    },
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: destination }) },
    BrowserWindow: { fromWebContents: () => ({}) },
    app: { getPath: () => dir },
    generate: async (_source, _key, _instructions, _count, options) => {
      receivedActivityType = options.activityType;
      return SAMPLE_ITEMS_BY_TYPE[options.activityType];
    }
  });

  // Rango inválido por formato: sortparagraphs requiere mínimo 3 y truefalse es fijo 1
  assert.equal((await generation.generateH5P({
    documentIds: [documentId], activityType: 'sortparagraphs', questionCount: 2, instructions: ''
  }, { sender: owner })).code, 'UNSUPPORTED_TYPE');
  assert.equal((await generation.generateH5P({
    documentIds: [documentId], activityType: 'truefalse', questionCount: 2, instructions: ''
  }, { sender: owner })).code, 'UNSUPPORTED_TYPE');

  // Generación exitosa de crucigrama con título personalizado
  const generated = await generation.generateH5P({
    documentIds: [documentId],
    activityType: 'crossword',
    questionCount: 3,
    instructions: 'Vocabulario técnico',
    title: 'Crucigrama Unidad 2'
  }, { sender: owner });
  assert.equal(generated.status, 'ok');
  assert.equal(generated.questionCount, 3);
  assert.equal(receivedActivityType, 'crossword');

  const saved = await generation.saveH5PFile({
    packageId: generated.packageId,
    suggestedName: 'crucigrama-inf421',
    courseId: 'inf421'
  }, { sender: owner });
  assert.equal(saved.status, 'ok');
  assert.equal(saved.projectSaved, true);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].h5pType, 'Crucigrama (H5P.Crossword)');
  assert.deepEqual(await fs.readdir(dir), ['crucigrama-inf421.h5p']);

  const zip = await JSZip.loadAsync(await fs.readFile(destination));
  const meta = JSON.parse(await zip.file('h5p.json').async('string'));
  assert.equal(meta.mainLibrary, 'H5P.Crossword');
  assert.equal(meta.title, 'Crucigrama Unidad 2');
});

test('H5P-34 (BUG-12, BUG-15): Blanks/DragText preservan espaciado con comillas y Crossword rechaza cruces imposibles en 2D', async () => {
  const blanksBuilt = await buildH5PContent('blanks', [
    { textoAntes: 'El término "', respuesta: 'HTTP', textoDespues: '" regula peticiones.', pista: '' },
    { textoAntes: 'La sigla «', respuesta: 'TCP', textoDespues: '» garantiza entrega.', pista: '' },
    { textoAntes: "El prefijo '", respuesta: 'TLS', textoDespues: "' cifra el canal.", pista: '' }
  ]);
  assert.equal(blanksBuilt.content.questions[0], '<p>El término &quot;*HTTP*&quot; regula peticiones.</p>');
  assert.equal(blanksBuilt.content.questions[1], '<p>La sigla «*TCP*» garantiza entrega.</p>');
  assert.equal(blanksBuilt.content.questions[2], '<p>El prefijo &#39;*TLS*&#39; cifra el canal.</p>');

  const dragBuilt = await buildH5PContent('dragtext', [
    { textoAntes: 'La capa “', palabra: 'RED', textoDespues: '” enruta paquetes.', pista: '' }
  ]);
  assert.equal(dragBuilt.content.textField, 'La capa “*RED*” enruta paquetes.');

  // AXX, AYY y AZZ comparten 'A' solo en el índice 0: pasan BFS pero son imposibles en una cuadrícula 2D
  assert.throws(
    () => validateActivityItems('crossword', [
      { pista: 'Primera palabra', palabra: 'AXX' },
      { pista: 'Segunda palabra', palabra: 'AYY' },
      { pista: 'Tercera palabra', palabra: 'AZZ' }
    ], 3),
    { message: 'INVALID_RESPONSE', reason: 'DISCONNECTED_WORDS' }
  );
});

test('H5P-32 (BUG-01): Flashcards escapa HTML y barras "/" en card.answer para evitar XSS y división de alternativas', async () => {
  const prepared = await buildH5PContent('flashcards', [{
    pregunta: '¿Qué relación cumple <O(n)> & "TCP/IP"?',
    respuesta: 'TCP/IP < OSI & "RFC"',
    pista: 'Compara <b>capas</b> y barra /'
  }], { title: 'Tarjetas seguras' });

  assert.equal(prepared.content.cards.length, 1);
  assert.equal(prepared.content.cards[0].text, '¿Qué relación cumple &lt;O(n)&gt; &amp; &quot;TCP/IP&quot;?');
  assert.equal(prepared.content.cards[0].answer, 'TCP\\/IP &lt; OSI &amp; &quot;RFC&quot;');
  assert.equal(prepared.content.cards[0].tip, 'Compara &lt;b&gt;capas&lt;/b&gt; y barra /');

  const packed = await packH5PPackage('flashcards', [{
    pregunta: 'Protocolo web',
    respuesta: 'HTTP/2 <script>alert(1)</script>',
    pista: ''
  }]);
  assert.equal(packed.validation.valid, true);
  const zip = await JSZip.loadAsync(packed.bytes);
  const content = JSON.parse(await zip.file('content/content.json').async('string'));
  assert.equal(content.cards[0].answer, 'HTTP\\/2 &lt;script&gt;alert(1)&lt;\\/script&gt;');
});

test('el paquete revisado conserva los prefijos escritos por el docente y la opción correcta', async () => {
  const [question] = SAMPLE_ITEMS_BY_TYPE.questionset;
  const answers = async (type, options) => {
    const packed = await packH5PPackage(type, [question], options);
    const zip = await JSZip.loadAsync(packed.bytes);
    const content = JSON.parse(await zip.file('content/content.json').async('string'));
    return type === 'questionset' ? content.questions[0].params.answers : content.answers;
  };

  for (const type of ['questionset', 'multichoice']) {
    const reviewed = await answers(type, { reviewed: true });
    assert.deepEqual(reviewed.map(answer => answer.text), question.opciones.map(text => `<div>${text}</div>`));
    assert.deepEqual(reviewed.map(answer => answer.correct), [true, false, false, false]);
    const generated = await answers(type);
    assert.equal(generated[0].text, '<div>Aislamiento de contexto</div>');
    assert.equal(generated[0].correct, true);
  }

  await assert.rejects(packH5PPackage('questionset', [{ ...question, respuestaCorrecta: 'Aislamiento de contexto' }], {
    reviewed: true
  }), { message: 'INVALID_RESPONSE', reason: 'CORRECT_ANSWER' });
});
