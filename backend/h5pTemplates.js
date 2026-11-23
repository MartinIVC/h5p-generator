'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');

const TEMPLATES_DIR = path.join(__dirname, 'templates');

const TEMPLATE_TYPES = Object.freeze({
  MULTICHOICE: 'multichoice',
  QUESTIONSET: 'questionset',
  TRUEFALSE: 'truefalse',
  BLANKS: 'blanks',
  DRAGTEXT: 'dragtext',
  SINGLECHOICESET: 'singlechoiceset',
  SUMMARY: 'summary',
  SORTPARAGRAPHS: 'sortparagraphs',
  CROSSWORD: 'crossword',
  FINDTHEWORDS: 'findthewords',
  ACCORDION: 'accordion',
  FLASHCARDS: 'flashcards'
});

const EMBED_TYPES = new Set(['div', 'iframe']);
const MACHINE_NAME_RE = /^[A-Za-z][A-Za-z0-9._-]{0,126}$/;
const LANGUAGE_RE = /^(?:und|[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/;
const LIBRARY_REF_RE = /^([A-Za-z][A-Za-z0-9._-]{0,126}) (\d+)\.(\d+)$/;
const BLANK_MARKER_RE = /\*[^*\r\n]+\*/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function templateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveInside(baseDir, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.includes('\0')) {
    throw templateError('INVALID_TEMPLATE_PATH', 'Ruta de plantilla inválida.');
  }
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, relativePath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw templateError('INVALID_TEMPLATE_PATH', 'La ruta de plantilla sale del directorio permitido.');
  }
  return resolved;
}

function libraryKey(machineName, majorVersion, minorVersion) {
  return `${machineName} ${majorVersion}.${minorVersion}`;
}

function libraryDirName(machineName, majorVersion, minorVersion) {
  return `${machineName}-${majorVersion}.${minorVersion}`;
}

function parseCoreApiPair(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d+)\.(\d+)$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function exceedsCoreApi(coreApi, maxPair) {
  if (!maxPair || !isPlainObject(coreApi)) return false;
  if (!isNonNegativeInteger(coreApi.majorVersion) || !isNonNegativeInteger(coreApi.minorVersion)) return false;
  return coreApi.majorVersion > maxPair.major ||
    (coreApi.majorVersion === maxPair.major && coreApi.minorVersion > maxPair.minor);
}

function extractMediaLibrary(container) {
  if (isPlainObject(container?.media?.type) && typeof container.media.type.library === 'string') {
    return [container.media.type.library];
  }
  return [];
}

/**
 * Validadores declarativos por mainLibrary para plantillas base y paquetes .h5p poblados.
 */
const CONTENT_VALIDATORS = Object.freeze({
  'H5P.MultiChoice': {
    validateBase(content) {
      if (typeof content.question !== 'string' || !Array.isArray(content.answers) ||
          !isPlainObject(content.UI) || !isPlainObject(content.behaviour) ||
          !isPlainObject(content.confirmCheck) || !isPlainObject(content.confirmRetry) ||
          !Array.isArray(content.overallFeedback)) {
        throw templateError('INVALID_TEMPLATE_CONTENT', 'Plantilla base de H5P.MultiChoice incompleta.');
      }
    },
    validatePackage(content) {
      if (!isNonEmptyString(content.question) || !Array.isArray(content.answers) || content.answers.length === 0) {
        throw templateError('INVALID_CONTENT_JSON', 'H5P.MultiChoice requiere question no vacía y answers no vacío.');
      }
      for (const answer of content.answers) {
        if (!isPlainObject(answer) || typeof answer.text !== 'string' || typeof answer.correct !== 'boolean') {
          throw templateError('INVALID_CONTENT_JSON', 'Cada respuesta de H5P.MultiChoice requiere text (string) y correct (boolean).');
        }
      }
    },
    extractSubLibraries: extractMediaLibrary
  },

  'H5P.QuestionSet': {
    validateBase(content) {
      if (!Array.isArray(content.questions) || !isPlainObject(content.texts) ||
          !isPlainObject(content.endGame) || !isPlainObject(content.introPage) ||
          typeof content.progressType !== 'string' || typeof content.passPercentage !== 'number') {
        throw templateError('INVALID_TEMPLATE_CONTENT', 'Plantilla base de H5P.QuestionSet incompleta.');
      }
    },
    validatePackage(content, preloadedSet) {
      if (!Array.isArray(content.questions) || content.questions.length === 0) {
        throw templateError('INVALID_CONTENT_JSON', 'H5P.QuestionSet requiere un array questions no vacío.');
      }
      for (const q of content.questions) {
        if (!isPlainObject(q) || typeof q.library !== 'string' || !LIBRARY_REF_RE.test(q.library) ||
            !isNonEmptyString(q.subContentId) || !isPlainObject(q.params)) {
          throw templateError('INVALID_CONTENT_JSON', 'Cada pregunta de H5P.QuestionSet requiere library, subContentId y params válidos.');
        }
        if (!preloadedSet.has(q.library)) {
          throw templateError('MISSING_DEPENDENCY_DECLARATION', `Sub-biblioteca ${q.library} usada en content.json no está declarada en h5p.json.`);
        }
      }
    },
    extractSubLibraries(content) {
      const libs = [];
      for (const q of content.questions || []) {
        if (typeof q?.library === 'string') libs.push(q.library);
        libs.push(...extractMediaLibrary(q?.params));
      }
      return libs;
    }
  },

  'H5P.TrueFalse': {
    validateBase(content) {
      if (typeof content.question !== 'string' || (content.correct !== 'true' && content.correct !== 'false') ||
          !isPlainObject(content.l10n) || !isPlainObject(content.behaviour) ||
          !isPlainObject(content.confirmCheck) || !isPlainObject(content.confirmRetry)) {
        throw templateError('INVALID_TEMPLATE_CONTENT', 'Plantilla base de H5P.TrueFalse incompleta.');
      }
    },
    validatePackage(content) {
      if (!isNonEmptyString(content.question) || (content.correct !== 'true' && content.correct !== 'false')) {
        throw templateError('INVALID_CONTENT_JSON', 'H5P.TrueFalse requiere question no vacía y correct ("true" o "false").');
      }
    },
    extractSubLibraries: extractMediaLibrary
  },

  'H5P.Blanks': {
    validateBase(content) {
      if (typeof content.text !== 'string' || !Array.isArray(content.questions) ||
          !Array.isArray(content.overallFeedback) || !isPlainObject(content.behaviour) ||
          !isPlainObject(content.confirmCheck) || !isPlainObject(content.confirmRetry) ||
          typeof content.showSolutions !== 'string' || typeof content.a11yCheck !== 'string') {
        throw templateError('INVALID_TEMPLATE_CONTENT', 'Plantilla base de H5P.Blanks incompleta.');
      }
    },
    validatePackage(content) {
      if (!isNonEmptyString(content.text) || !Array.isArray(content.questions) || content.questions.length === 0) {
        throw templateError('INVALID_CONTENT_JSON', 'H5P.Blanks requiere text y un array questions no vacío.');
      }
      for (const block of content.questions) {
        if (typeof block !== 'string' || !BLANK_MARKER_RE.test(block)) {
          throw templateError('INVALID_CONTENT_JSON', 'Cada bloque de H5P.Blanks debe contener al menos un hueco *respuesta*.');
        }
      }
    },
    extractSubLibraries: extractMediaLibrary
  },

  'H5P.DragText': {
    validateBase(content) {
      if (typeof content.taskDescription !== 'string' || typeof content.textField !== 'string' ||
          !Array.isArray(content.overallFeedback) || !isPlainObject(content.behaviour) ||
          typeof content.checkAnswer !== 'string' || typeof content.a11yCheck !== 'string') {
        throw templateError('INVALID_TEMPLATE_CONTENT', 'Plantilla base de H5P.DragText incompleta.');
      }
    },
    validatePackage(content) {
      if (!isNonEmptyString(content.taskDescription) || typeof content.textField !== 'string' || !BLANK_MARKER_RE.test(content.textField)) {
        throw templateError('INVALID_CONTENT_JSON', 'H5P.DragText requiere taskDescription y textField con al menos una palabra *arrastrable*.');
      }
    },
    extractSubLibraries: extractMediaLibrary
  },

  'H5P.SingleChoiceSet': {
    validateBase(content) {
      if (!Array.isArray(content.choices) || !Array.isArray(content.overallFeedback) ||
          !isPlainObject(content.behaviour) || !isPlainObject(content.l10n)) {
        throw templateError('INVALID_TEMPLATE_CONTENT', 'Plantilla base de H5P.SingleChoiceSet incompleta.');
      }
    },
    validatePackage(content) {
      if (!Array.isArray(content.choices) || content.choices.length === 0) {
        throw templateError('INVALID_CONTENT_JSON', 'H5P.SingleChoiceSet requiere choices no vacío.');
      }
      for (const choice of content.choices) {
        if (!isPlainObject(choice) || !isNonEmptyString(choice.question) ||
            !Array.isArray(choice.answers) || choice.answers.length < 2 ||
            !choice.answers.every(isNonEmptyString)) {
          throw templateError('INVALID_CONTENT_JSON', 'Cada elemento de H5P.SingleChoiceSet requiere question y al menos 2 answers no vacías.');
        }
      }
    },
    extractSubLibraries: () => []
  },

  'H5P.Summary': {
    validateBase(content) {
      if (typeof content.intro !== 'string' || !Array.isArray(content.summaries) ||
          !Array.isArray(content.overallFeedback) || typeof content.solvedLabel !== 'string' ||
          typeof content.scoreBarLabel !== 'string') {
        throw templateError('INVALID_TEMPLATE_CONTENT', 'Plantilla base de H5P.Summary incompleta.');
      }
    },
    validatePackage(content) {
      if (!isNonEmptyString(content.intro) || !Array.isArray(content.summaries) || content.summaries.length === 0) {
        throw templateError('INVALID_CONTENT_JSON', 'H5P.Summary requiere intro y summaries no vacío.');
      }
      for (const group of content.summaries) {
        if (!isPlainObject(group) || !Array.isArray(group.summary) || group.summary.length < 2 ||
            !group.summary.every(isNonEmptyString)) {
          throw templateError('INVALID_CONTENT_JSON', 'Cada grupo de H5P.Summary requiere al menos 2 afirmaciones no vacías.');
        }
      }
    },
    extractSubLibraries: () => []
  },

  'H5P.SortParagraphs': {
    validateBase(content) {
      if (typeof content.taskDescription !== 'string' || !Array.isArray(content.paragraphs) ||
          !Array.isArray(content.overallFeedback) || !isPlainObject(content.behaviour) ||
          !isPlainObject(content.l10n) || !isPlainObject(content.a11y)) {
        throw templateError('INVALID_TEMPLATE_CONTENT', 'Plantilla base de H5P.SortParagraphs incompleta.');
      }
    },
    validatePackage(content) {
      if (!isNonEmptyString(content.taskDescription) || !Array.isArray(content.paragraphs) ||
          content.paragraphs.length < 3 || !content.paragraphs.every(isNonEmptyString)) {
        throw templateError('INVALID_CONTENT_JSON', 'H5P.SortParagraphs requiere taskDescription y al menos 3 paragraphs no vacíos.');
      }
    },
    extractSubLibraries: extractMediaLibrary
  },

  'H5P.Crossword': {
    validateBase(content) {
      if (!Array.isArray(content.words) || !Array.isArray(content.overallFeedback) ||
          !isPlainObject(content.theme) || !isPlainObject(content.behaviour) ||
          !isPlainObject(content.l10n) || !isPlainObject(content.a11y)) {
        throw templateError('INVALID_TEMPLATE_CONTENT', 'Plantilla base de H5P.Crossword incompleta.');
      }
    },
    validatePackage(content) {
      if (!Array.isArray(content.words) || content.words.length < 2) {
        throw templateError('INVALID_CONTENT_JSON', 'H5P.Crossword requiere al menos 2 palabras en words.');
      }
      for (const word of content.words) {
        if (!isPlainObject(word) || !isNonEmptyString(word.clue) || !isNonEmptyString(word.answer)) {
          throw templateError('INVALID_CONTENT_JSON', 'Cada entrada de H5P.Crossword requiere clue y answer no vacíos.');
        }
      }
    },
    extractSubLibraries(content) {
      const libs = [];
      for (const word of content.words || []) {
        if (isPlainObject(word?.extraClue) && typeof word.extraClue.library === 'string') {
          libs.push(word.extraClue.library);
        }
      }
      return libs;
    }
  },

  'H5P.FindTheWords': {
    validateBase(content) {
      if (typeof content.taskDescription !== 'string' || typeof content.wordList !== 'string' ||
          !isPlainObject(content.behaviour) || !isPlainObject(content.l10n)) {
        throw templateError('INVALID_TEMPLATE_CONTENT', 'Plantilla base de H5P.FindTheWords incompleta.');
      }
    },
    validatePackage(content) {
      if (!isNonEmptyString(content.taskDescription) || !isNonEmptyString(content.wordList)) {
        throw templateError('INVALID_CONTENT_JSON', 'H5P.FindTheWords requiere taskDescription y wordList no vacíos.');
      }
      const words = content.wordList.split(',').map(w => w.trim()).filter(Boolean);
      if (words.length === 0) {
        throw templateError('INVALID_CONTENT_JSON', 'H5P.FindTheWords requiere al menos una palabra válida en wordList.');
      }
    },
    extractSubLibraries: () => []
  },

  'H5P.Accordion': {
    validateBase(content) {
      if (!Array.isArray(content.panels) || !isNonEmptyString(content.hTag)) {
        throw templateError('INVALID_TEMPLATE_CONTENT', 'Plantilla base de H5P.Accordion incompleta.');
      }
    },
    validatePackage(content, preloadedSet) {
      if (!Array.isArray(content.panels) || content.panels.length === 0 || !isNonEmptyString(content.hTag)) {
        throw templateError('INVALID_CONTENT_JSON', 'H5P.Accordion requiere panels no vacío y hTag válido.');
      }
      for (const panel of content.panels) {
        if (!isPlainObject(panel) || !isNonEmptyString(panel.title) || !isPlainObject(panel.content) ||
            typeof panel.content.library !== 'string' || !LIBRARY_REF_RE.test(panel.content.library) ||
            !isNonEmptyString(panel.content.subContentId) || !isPlainObject(panel.content.params)) {
          throw templateError('INVALID_CONTENT_JSON', 'Cada panel de H5P.Accordion requiere title y content válido.');
        }
        if (!preloadedSet.has(panel.content.library)) {
          throw templateError('MISSING_DEPENDENCY_DECLARATION', `Sub-biblioteca ${panel.content.library} usada en H5P.Accordion no está declarada en h5p.json.`);
        }
      }
    },
    extractSubLibraries(content) {
      return (content.panels || [])
        .map(panel => panel?.content?.library)
        .filter(lib => typeof lib === 'string');
    }
  },

  'H5P.Flashcards': {
    validateBase(content) {
      if (typeof content.description !== 'string' || !Array.isArray(content.cards) ||
          typeof content.progressText !== 'string' || typeof content.checkAnswerText !== 'string' ||
          typeof content.caseSensitive !== 'boolean' || typeof content.randomCards !== 'boolean') {
        throw templateError('INVALID_TEMPLATE_CONTENT', 'Plantilla base de H5P.Flashcards incompleta.');
      }
    },
    validatePackage(content) {
      if (!Array.isArray(content.cards) || content.cards.length === 0) {
        throw templateError('INVALID_CONTENT_JSON', 'H5P.Flashcards requiere un array cards no vacío.');
      }
      for (const card of content.cards) {
        if (!isPlainObject(card) || !isNonEmptyString(card.text) || !isNonEmptyString(card.answer)) {
          throw templateError('INVALID_CONTENT_JSON', 'Cada tarjeta de H5P.Flashcards requiere text y answer no vacíos.');
        }
      }
    },
    extractSubLibraries: () => []
  }
});

/**
 * Valida un objeto h5p.json contra la especificación oficial de H5P Group.
 */
function validateH5PMetadata(metadata) {
  if (!isPlainObject(metadata)) {
    throw templateError('INVALID_H5P_METADATA', 'h5p.json debe ser un objeto JSON.');
  }
  if (!isNonEmptyString(metadata.title) || metadata.title.length > 255) {
    throw templateError('INVALID_H5P_METADATA', 'h5p.json requiere un título no vacío de hasta 255 caracteres.');
  }
  if (typeof metadata.language !== 'string' || !LANGUAGE_RE.test(metadata.language)) {
    throw templateError('INVALID_H5P_METADATA', 'h5p.json requiere un código de idioma válido (ej. "es" o "und").');
  }
  if (typeof metadata.mainLibrary !== 'string' || !MACHINE_NAME_RE.test(metadata.mainLibrary)) {
    throw templateError('INVALID_H5P_METADATA', 'h5p.json requiere un mainLibrary válido.');
  }
  if (!Array.isArray(metadata.embedTypes) || metadata.embedTypes.length === 0) {
    throw templateError('INVALID_H5P_METADATA', 'h5p.json requiere embedTypes no vacío.');
  }
  const seenEmbed = new Set();
  for (const embed of metadata.embedTypes) {
    if (typeof embed !== 'string' || !EMBED_TYPES.has(embed) || seenEmbed.has(embed)) {
      throw templateError('INVALID_H5P_METADATA', 'embedTypes solo admite valores únicos "div" o "iframe".');
    }
    seenEmbed.add(embed);
  }
  if (metadata.license !== undefined && (!isNonEmptyString(metadata.license) || metadata.license.length > 32)) {
    throw templateError('INVALID_H5P_METADATA', 'license debe ser una cadena no vacía si se declara.');
  }
  if (!Array.isArray(metadata.preloadedDependencies) || metadata.preloadedDependencies.length === 0) {
    throw templateError('INVALID_H5P_METADATA', 'h5p.json requiere preloadedDependencies no vacío.');
  }

  const seenDeps = new Set();
  let mainDep = null;
  const dependencies = [];
  for (const dep of metadata.preloadedDependencies) {
    if (!isPlainObject(dep)) {
      throw templateError('INVALID_H5P_METADATA', 'Cada entrada de preloadedDependencies debe ser un objeto.');
    }
    if (typeof dep.machineName !== 'string' || !MACHINE_NAME_RE.test(dep.machineName)) {
      throw templateError('INVALID_H5P_METADATA', 'Dependencia con machineName inválido en h5p.json.');
    }
    if (!isNonNegativeInteger(dep.majorVersion) || !isNonNegativeInteger(dep.minorVersion)) {
      throw templateError('INVALID_H5P_METADATA', `majorVersion y minorVersion deben ser enteros no negativos (${dep.machineName}).`);
    }
    if (seenDeps.has(dep.machineName)) {
      throw templateError('INVALID_H5P_METADATA', `Dependencia duplicada en preloadedDependencies: ${dep.machineName}.`);
    }
    seenDeps.add(dep.machineName);
    const entry = {
      machineName: dep.machineName,
      majorVersion: dep.majorVersion,
      minorVersion: dep.minorVersion,
      key: libraryKey(dep.machineName, dep.majorVersion, dep.minorVersion),
      dir: libraryDirName(dep.machineName, dep.majorVersion, dep.minorVersion)
    };
    dependencies.push(entry);
    if (dep.machineName === metadata.mainLibrary) {
      mainDep = entry;
    }
  }

  if (!mainDep) {
    throw templateError('INVALID_H5P_METADATA', `mainLibrary (${metadata.mainLibrary}) debe figurar en preloadedDependencies.`);
  }

  return {
    mainLibrary: metadata.mainLibrary,
    mainLibraryKey: mainDep.key,
    mainLibraryDir: mainDep.dir,
    dependencies
  };
}

function validateTemplateContentBase(mainLibrary, content) {
  if (!isPlainObject(content)) {
    throw templateError('INVALID_TEMPLATE_CONTENT', 'content/content.json debe ser un objeto JSON.');
  }
  const validator = Object.hasOwn(CONTENT_VALIDATORS, mainLibrary) ? CONTENT_VALIDATORS[mainLibrary] : null;
  if (validator) {
    validator.validateBase(content);
  }
}

async function loadManifest(templatesDir = TEMPLATES_DIR) {
  const manifestPath = resolveInside(templatesDir, 'manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  if (!isPlainObject(manifest) || manifest.schemaVersion !== 1 ||
      !isPlainObject(manifest.librariesBundle) || typeof manifest.librariesBundle.path !== 'string' ||
      !isPlainObject(manifest.templates)) {
    throw templateError('INVALID_MANIFEST', 'manifest.json de plantillas H5P no tiene un formato válido.');
  }
  return manifest;
}

/**
 * Devuelve el catálogo declarativo de plantillas H5P registradas en manifest.json.
 */
async function listTemplates({ templatesDir = TEMPLATES_DIR } = {}) {
  const manifest = await loadManifest(templatesDir);
  return Object.entries(manifest.templates).map(([type, spec]) => ({
    type,
    label: spec.label || type,
    category: spec.category || 'evaluation',
    mainLibrary: spec.mainLibrary.machineName,
    mainLibraryKey: libraryKey(spec.mainLibrary.machineName, spec.mainLibrary.majorVersion, spec.mainLibrary.minorVersion),
    version: `${spec.mainLibrary.majorVersion}.${spec.mainLibrary.minorVersion}.${spec.mainLibrary.patchVersion}`,
    coreApi: spec.coreApi ? { ...spec.coreApi } : null,
    provenance: spec.provenance || null
  }));
}

/**
 * Carga y clona los JSON estáticos de una plantilla registrada en manifest.json.
 */
async function loadTemplate(templateType, { templatesDir = TEMPLATES_DIR } = {}) {
  const manifest = await loadManifest(templatesDir);
  if (typeof templateType !== 'string' || !Object.hasOwn(manifest.templates, templateType)) {
    throw templateError('UNKNOWN_TEMPLATE', `Tipo de plantilla H5P no soportado: ${String(templateType)}.`);
  }
  const spec = manifest.templates[templateType];
  const metadataPath = resolveInside(templatesDir, spec.h5pJson);
  const contentPath = resolveInside(templatesDir, spec.contentJson);

  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  const content = JSON.parse(await fs.readFile(contentPath, 'utf8'));
  const validated = validateH5PMetadata(metadata);

  if (spec.mainLibrary) {
    const expectedKey = libraryKey(spec.mainLibrary.machineName, spec.mainLibrary.majorVersion, spec.mainLibrary.minorVersion);
    if (validated.mainLibraryKey !== expectedKey) {
      throw templateError('MANIFEST_MISMATCH', `La plantilla ${templateType} declara ${validated.mainLibraryKey} pero manifest.json espera ${expectedKey}.`);
    }
  }
  validateTemplateContentBase(validated.mainLibrary, content);

  const subQuestionLibraryKey = spec.subQuestionLibrary
    ? libraryKey(spec.subQuestionLibrary.machineName, spec.subQuestionLibrary.majorVersion, spec.subQuestionLibrary.minorVersion)
    : null;
  const subContentLibraryKey = spec.subContentLibrary
    ? libraryKey(spec.subContentLibrary.machineName, spec.subContentLibrary.majorVersion, spec.subContentLibrary.minorVersion)
    : null;

  return {
    type: templateType,
    label: spec.label || templateType,
    category: spec.category || 'evaluation',
    metadata: structuredClone(metadata),
    content: structuredClone(content),
    mainLibrary: validated.mainLibrary,
    mainLibraryKey: validated.mainLibraryKey,
    subQuestionLibraryKey,
    subContentLibraryKey,
    rootLibraries: Array.isArray(spec.rootLibraries) ? [...spec.rootLibraries] : [validated.mainLibraryKey]
  };
}

async function loadLibrariesBundle(templatesDir = TEMPLATES_DIR) {
  const manifest = await loadManifest(templatesDir);
  const bundlePath = resolveInside(templatesDir, manifest.librariesBundle.path);
  const buffer = await fs.readFile(bundlePath);

  if (typeof manifest.librariesBundle.sha256 === 'string' && manifest.librariesBundle.sha256.length > 0) {
    const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (actualHash !== manifest.librariesBundle.sha256) {
      throw templateError('BUNDLE_INTEGRITY_ERROR', 'La huella SHA-256 de libraries-bundle.zip no coincide con manifest.json.');
    }
  }

  const maxCoreApi = parseCoreApiPair(manifest.maxCoreApi);
  const zip = await JSZip.loadAsync(buffer);
  const libraries = new Map();
  for (const filePath of Object.keys(zip.files)) {
    if (!/^[^/]+\/library\.json$/.test(filePath)) continue;
    const dir = filePath.split('/')[0];
    const json = JSON.parse(await zip.file(filePath).async('string'));
    if (!isPlainObject(json) || typeof json.machineName !== 'string' ||
        !isNonNegativeInteger(json.majorVersion) || !isNonNegativeInteger(json.minorVersion)) {
      throw templateError('INVALID_LIBRARY_JSON', `library.json inválido en ${filePath}.`);
    }
    const expectedDir = libraryDirName(json.machineName, json.majorVersion, json.minorVersion);
    if (dir !== expectedDir) {
      throw templateError('INVALID_LIBRARY_JSON', `Carpeta ${dir} no coincide con ${expectedDir}.`);
    }
    if (exceedsCoreApi(json.coreApi, maxCoreApi)) {
      throw templateError(
        'UNSUPPORTED_CORE_API',
        `${dir} requiere coreApi ${json.coreApi.majorVersion}.${json.coreApi.minorVersion} (> ${manifest.maxCoreApi}).`
      );
    }
    libraries.set(libraryKey(json.machineName, json.majorVersion, json.minorVersion), { dir, json });
  }

  return { manifest, zip, libraries };
}

function computeClosure(rootKeys, libraries, { includeEditor = true } = {}) {
  const kinds = includeEditor
    ? ['preloadedDependencies', 'editorDependencies', 'dynamicDependencies']
    : ['preloadedDependencies'];
  const seen = new Set();
  const queue = [...rootKeys];

  while (queue.length > 0) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    const entry = libraries.get(key);
    if (!entry) {
      throw templateError('MISSING_LIBRARY', `Falta la biblioteca requerida en el paquete: ${key}.`);
    }
    seen.add(key);
    for (const kind of kinds) {
      for (const dep of entry.json[kind] || []) {
        if (!isPlainObject(dep) || typeof dep.machineName !== 'string' ||
            !isNonNegativeInteger(dep.majorVersion) || !isNonNegativeInteger(dep.minorVersion)) {
          throw templateError('INVALID_LIBRARY_JSON', `Dependencia inválida en ${entry.dir}/library.json (${kind}).`);
        }
        queue.push(libraryKey(dep.machineName, dep.majorVersion, dep.minorVersion));
      }
    }
  }

  return [...seen].sort().map(key => {
    const { dir, json } = libraries.get(key);
    return {
      key,
      dir,
      machineName: json.machineName,
      majorVersion: json.majorVersion,
      minorVersion: json.minorVersion,
      patchVersion: isNonNegativeInteger(json.patchVersion) ? json.patchVersion : 0,
      coreApi: isPlainObject(json.coreApi) && isNonNegativeInteger(json.coreApi.majorVersion) && isNonNegativeInteger(json.coreApi.minorVersion)
        ? `${json.coreApi.majorVersion}.${json.coreApi.minorVersion}`
        : null,
      license: typeof json.license === 'string' ? json.license : null
    };
  });
}

/**
 * Resuelve la clausura transitiva de bibliotecas requeridas por una plantilla.
 */
async function resolveLibraryClosure(templateType, { templatesDir = TEMPLATES_DIR, includeEditor = true } = {}) {
  const template = await loadTemplate(templateType, { templatesDir });
  const { libraries } = await loadLibrariesBundle(templatesDir);
  return computeClosure(template.rootLibraries, libraries, { includeEditor });
}

/**
 * Crea un objeto JSZip precargado únicamente con la clausura de bibliotecas
 * correspondiente a `templateType` (sin content/ ni bibliotecas huérfanas).
 */
async function createBasePackageZip(templateType, { templatesDir = TEMPLATES_DIR } = {}) {
  const template = await loadTemplate(templateType, { templatesDir });
  const { zip: bundleZip, libraries } = await loadLibrariesBundle(templatesDir);
  const closure = computeClosure(template.rootLibraries, libraries, { includeEditor: true });
  const allowedDirs = new Set(closure.map(item => item.dir));

  const outZip = new JSZip();
  for (const entryPath of Object.keys(bundleZip.files).sort()) {
    const top = entryPath.split('/')[0];
    if (!allowedDirs.has(top)) continue;
    const item = bundleZip.files[entryPath];
    if (item.dir) {
      outZip.folder(entryPath.replace(/\/$/, ''));
    } else {
      const data = await item.async('nodebuffer');
      outZip.file(entryPath, data);
    }
  }

  return outZip;
}

function validateZipEntryPath(entryPath) {
  if (typeof entryPath !== 'string' || entryPath.length === 0 ||
      entryPath.startsWith('/') || entryPath.includes('\\') || entryPath.includes('\0')) {
    throw templateError('INVALID_PACKAGE_PATH', `Ruta inválida dentro del paquete H5P: ${entryPath}`);
  }
  const segments = entryPath.split('/').filter(Boolean);
  if (segments.some(seg => seg === '..' || seg === '.' || seg === '__MACOSX' || seg === '.DS_Store')) {
    throw templateError('INVALID_PACKAGE_PATH', `Entrada no permitida dentro del paquete H5P: ${entryPath}`);
  }
}

/**
 * Valida estructuralmente un archivo .h5p completo contra la especificación oficial de H5P Group.
 */
async function validateH5PPackage(buffer) {
  if (!(buffer instanceof Uint8Array) || buffer.byteLength === 0) {
    throw templateError('INVALID_PACKAGE', 'El paquete H5P debe ser un buffer no vacío.');
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw templateError('INVALID_PACKAGE', 'El archivo no es un ZIP válido.');
  }

  const allPaths = Object.keys(zip.files);
  for (const entryPath of allPaths) {
    validateZipEntryPath(entryPath);
  }

  const h5pFile = zip.file('h5p.json');
  if (!h5pFile) {
    throw templateError('MISSING_H5P_JSON', 'Falta h5p.json en la raíz del paquete.');
  }
  let metadata;
  try {
    metadata = JSON.parse(await h5pFile.async('string'));
  } catch {
    throw templateError('INVALID_H5P_METADATA', 'h5p.json no contiene JSON válido.');
  }
  const metaInfo = validateH5PMetadata(metadata);

  const contentFile = zip.file('content/content.json');
  if (!contentFile) {
    throw templateError('MISSING_CONTENT_JSON', 'Falta content/content.json en el paquete.');
  }
  let content;
  try {
    content = JSON.parse(await contentFile.async('string'));
  } catch {
    throw templateError('INVALID_CONTENT_JSON', 'content/content.json no contiene JSON válido.');
  }
  if (!isPlainObject(content)) {
    throw templateError('INVALID_CONTENT_JSON', 'content/content.json debe ser un objeto JSON.');
  }

  // Indexar todas las carpetas de bibliotecas del paquete
  const topDirs = new Set();
  for (const entryPath of allPaths) {
    const top = entryPath.split('/')[0];
    if (top !== 'h5p.json' && top !== 'content') {
      topDirs.add(top);
    }
  }

  const libraries = new Map();
  for (const dir of [...topDirs].sort()) {
    const libFile = zip.file(`${dir}/library.json`);
    if (!libFile) {
      throw templateError('INVALID_LIBRARY_JSON', `Carpeta raíz sin library.json: ${dir}.`);
    }
    let json;
    try {
      json = JSON.parse(await libFile.async('string'));
    } catch {
      throw templateError('INVALID_LIBRARY_JSON', `library.json corrupto en ${dir}.`);
    }
    if (!isPlainObject(json) || typeof json.machineName !== 'string' ||
        !isNonNegativeInteger(json.majorVersion) || !isNonNegativeInteger(json.minorVersion)) {
      throw templateError('INVALID_LIBRARY_JSON', `Metadatos de versión inválidos en ${dir}/library.json.`);
    }
    const expectedDir = libraryDirName(json.machineName, json.majorVersion, json.minorVersion);
    if (dir !== expectedDir) {
      throw templateError('INVALID_LIBRARY_JSON', `La carpeta ${dir} no coincide con ${expectedDir}.`);
    }
    libraries.set(libraryKey(json.machineName, json.majorVersion, json.minorVersion), { dir, json });
  }

  // Verificar que todas las preloadedDependencies de h5p.json existen en el ZIP
  const rootKeys = [];
  const preloadedSet = new Set();
  for (const dep of metaInfo.dependencies) {
    if (!libraries.has(dep.key)) {
      throw templateError('MISSING_LIBRARY', `Dependencia declarada en h5p.json ausente del ZIP: ${dep.key}.`);
    }
    rootKeys.push(dep.key);
    preloadedSet.add(dep.key);
  }

  // Validar content/content.json según el validador registrado para mainLibrary
  const validator = Object.hasOwn(CONTENT_VALIDATORS, metaInfo.mainLibrary)
    ? CONTENT_VALIDATORS[metaInfo.mainLibrary]
    : null;
  const subLibraries = [];
  if (validator) {
    validator.validatePackage(content, preloadedSet);
    for (const subLib of validator.extractSubLibraries(content)) {
      subLibraries.push(subLib);
      rootKeys.push(subLib);
    }
  }

  // Clausura transitiva completa: toda dependencia de cada library.json debe existir
  const closure = computeClosure(rootKeys, libraries, { includeEditor: true });
  const closureDirs = new Set(closure.map(item => item.dir));

  // Verificar ausencia de bibliotecas huérfanas no referenciadas
  for (const dir of topDirs) {
    if (!closureDirs.has(dir)) {
      throw templateError('ORPHAN_LIBRARY', `Biblioteca no referenciada dentro del paquete: ${dir}.`);
    }
  }

  // Verificar que las preloadedDependencies de h5p.json coincidan exactamente con la clausura de ejecución
  const runtimeRoots = [...new Set([metaInfo.mainLibraryKey, ...subLibraries])];
  const runtimeClosure = computeClosure(runtimeRoots, libraries, { includeEditor: false });
  const runtimeSet = new Set(runtimeClosure.map(item => item.key));
  for (const runtimeLib of runtimeClosure) {
    if (!preloadedSet.has(runtimeLib.key)) {
      throw templateError('MISSING_DEPENDENCY_DECLARATION', `Falta declarar dependencia de ejecución en h5p.json: ${runtimeLib.key}.`);
    }
  }
  for (const declared of preloadedSet) {
    if (!runtimeSet.has(declared)) {
      throw templateError('UNUSED_DEPENDENCY_DECLARATION', `Dependencia no utilizada declarada en h5p.json: ${declared}.`);
    }
  }

  return {
    valid: true,
    mainLibrary: metaInfo.mainLibrary,
    mainLibraryKey: metaInfo.mainLibraryKey,
    preloadedCount: metaInfo.dependencies.length,
    libraryCount: closure.length,
    libraries: closure.map(item => item.key)
  };
}

module.exports = {
  TEMPLATES_DIR,
  TEMPLATE_TYPES,
  loadManifest,
  listTemplates,
  loadTemplate,
  validateH5PMetadata,
  resolveLibraryClosure,
  createBasePackageZip,
  validateH5PPackage
};
