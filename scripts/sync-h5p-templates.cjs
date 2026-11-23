'use strict';

/**
 * Script de mantenimiento (solo desarrollo; no se incluye en package-linux.cjs).
 * Construye de forma determinista backend/templates/libraries-bundle.zip combinando
 * las bibliotecas base locales (H5P.MultiChoice 1.14 + H5P.QuestionSet 1.17) con
 * los paquetes oficiales de H5P Hub compatibles con coreApi <= 1.24.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require(path.resolve(__dirname, '../backend/node_modules/jszip'));

const MAX_CORE_API = { major: 1, minor: 24 };
const FIXED_DATE = new Date('2026-11-19T00:00:00.000Z');
const HUB_BASE_URL = 'https://api.h5p.org/v1/content-types/';

const HUB_FORMATS = [
  { key: 'truefalse', machineName: 'H5P.TrueFalse' },
  { key: 'blanks', machineName: 'H5P.Blanks' },
  { key: 'dragtext', machineName: 'H5P.DragText' },
  { key: 'singlechoiceset', machineName: 'H5P.SingleChoiceSet' },
  { key: 'summary', machineName: 'H5P.Summary' },
  { key: 'sortparagraphs', machineName: 'H5P.SortParagraphs' },
  { key: 'crossword', machineName: 'H5P.Crossword' },
  { key: 'findthewords', machineName: 'H5P.FindTheWords' },
  { key: 'accordion', machineName: 'H5P.Accordion', extraRoots: ['H5P.AdvancedText 1.1'] },
  { key: 'flashcards', machineName: 'H5P.Flashcards' }
];

const LOCAL_FORMATS = [
  { key: 'multichoice', machineName: 'H5P.MultiChoice', roots: ['H5P.MultiChoice 1.14'] },
  { key: 'questionset', machineName: 'H5P.QuestionSet', roots: ['H5P.QuestionSet 1.17', 'H5P.MultiChoice 1.14'] }
];

function isCoreApiCompatible(coreApi) {
  if (!coreApi || typeof coreApi !== 'object') return true;
  if (coreApi.majorVersion < MAX_CORE_API.major) return true;
  if (coreApi.majorVersion === MAX_CORE_API.major && coreApi.minorVersion <= MAX_CORE_API.minor) return true;
  return false;
}

function comparePatch(a, b) {
  const pa = Number.isInteger(a.patchVersion) ? a.patchVersion : 0;
  const pb = Number.isInteger(b.patchVersion) ? b.patchVersion : 0;
  return pa - pb;
}

async function indexZipLibraries(zip, sourceLabel) {
  const result = new Map();
  for (const entryPath of Object.keys(zip.files)) {
    if (!/^[^/]+\/library\.json$/.test(entryPath)) continue;
    const dir = entryPath.split('/')[0];
    const json = JSON.parse(await zip.file(entryPath).async('string'));
    const key = `${json.machineName} ${json.majorVersion}.${json.minorVersion}`;
    const expectedDir = `${json.machineName}-${json.majorVersion}.${json.minorVersion}`;
    if (dir !== expectedDir) {
      throw new Error(`Carpeta ${dir} no coincide con ${expectedDir} (${sourceLabel})`);
    }
    if (!isCoreApiCompatible(json.coreApi)) {
      throw new Error(
        `Biblioteca ${key} (${json.majorVersion}.${json.minorVersion}.${json.patchVersion}) exige coreApi ` +
        `${json.coreApi.majorVersion}.${json.coreApi.minorVersion} > ${MAX_CORE_API.major}.${MAX_CORE_API.minor} (${sourceLabel})`
      );
    }
    const files = [];
    for (const p of Object.keys(zip.files).sort()) {
      if (p.split('/')[0] !== dir) continue;
      const item = zip.files[p];
      if (!item.dir) {
        files.push({ path: p, data: await item.async('nodebuffer') });
      }
    }
    result.set(key, { key, dir, json, files, source: sourceLabel });
  }
  return result;
}

function mergeLibraryPool(pool, incoming) {
  for (const [key, candidate] of incoming) {
    const existing = pool.get(key);
    if (!existing || comparePatch(candidate.json, existing.json) > 0) {
      pool.set(key, candidate);
    }
  }
}

function computeClosure(roots, pool, includeEditor) {
  const kinds = includeEditor
    ? ['preloadedDependencies', 'editorDependencies', 'dynamicDependencies']
    : ['preloadedDependencies'];
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    const entry = pool.get(key);
    if (!entry) throw new Error(`Falta biblioteca en el pool: ${key}`);
    seen.add(key);
    for (const kind of kinds) {
      for (const dep of entry.json[kind] || []) {
        queue.push(`${dep.machineName} ${dep.majorVersion}.${dep.minorVersion}`);
      }
    }
  }
  return [...seen].sort();
}

(async () => {
  const templatesDir = path.resolve(__dirname, '../backend/templates');
  const bundlePath = path.join(templatesDir, 'libraries-bundle.zip');
  const pool = new Map();

  // 1. Cargar bibliotecas base locales desde el bundle actual
  const localZip = await JSZip.loadAsync(await fs.readFile(bundlePath));
  mergeLibraryPool(pool, await indexZipLibraries(localZip, 'local-baseline'));

  // 2. Descargar paquetes oficiales de H5P Hub
  const formatSpecs = [];
  for (const localFmt of LOCAL_FORMATS) {
    formatSpecs.push({ ...localFmt, provenance: 'https://h5p.org/sites/default/files/question-set-616_2.h5p' });
  }

  for (const hubFmt of HUB_FORMATS) {
    const url = `${HUB_BASE_URL}${hubFmt.machineName}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Error descargando ${url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const hubZip = await JSZip.loadAsync(buf);
    const indexed = await indexZipLibraries(hubZip, url);
    const mainEntry = [...indexed.values()].find(item => item.json.machineName === hubFmt.machineName);
    if (!mainEntry) throw new Error(`No se encontró ${hubFmt.machineName} en ${url}`);
    mergeLibraryPool(pool, indexed);
    const roots = [mainEntry.key, ...(hubFmt.extraRoots || [])];
    formatSpecs.push({
      key: hubFmt.key,
      machineName: hubFmt.machineName,
      roots,
      provenance: url
    });
  }

  // 3. Calcular clausura exacta de los 12 formatos (sin bibliotecas huérfanas)
  const requiredKeys = new Set();
  const formatSummaries = {};
  for (const spec of formatSpecs) {
    const runtimeClosure = computeClosure(spec.roots, pool, false);
    const fullClosure = computeClosure(spec.roots, pool, true);
    for (const k of fullClosure) requiredKeys.add(k);

    const mainLib = pool.get(spec.roots[0]).json;
    let maxRun = [0, 0];
    let maxEd = [0, 0];
    for (const k of fullClosure) {
      const lib = pool.get(k).json;
      if (!lib.coreApi) continue;
      const pair = [lib.coreApi.majorVersion, lib.coreApi.minorVersion];
      const isEd = lib.machineName.startsWith('H5PEditor.');
      const cur = isEd ? maxEd : maxRun;
      if (pair[0] > cur[0] || (pair[0] === cur[0] && pair[1] > cur[1])) {
        if (isEd) maxEd = pair;
        else maxRun = pair;
      }
    }

    formatSummaries[spec.key] = {
      mainLibrary: {
        machineName: mainLib.machineName,
        majorVersion: mainLib.majorVersion,
        minorVersion: mainLib.minorVersion,
        patchVersion: mainLib.patchVersion
      },
      embedTypes: mainLib.embedTypes || ['iframe'],
      coreApi: {
        runtime: maxRun[0] ? `${maxRun[0]}.${maxRun[1]}` : null,
        editor: maxEd[0] ? `${maxEd[0]}.${maxEd[1]}` : null
      },
      rootLibraries: spec.roots,
      provenance: spec.provenance,
      preloadedDependencies: runtimeClosure.map(k => {
        const lib = pool.get(k).json;
        return { machineName: lib.machineName, majorVersion: lib.majorVersion, minorVersion: lib.minorVersion };
      }),
      fullLibraryCount: fullClosure.length
    };
  }

  // 4. Empaquetar libraries-bundle.zip de forma determinista
  const outZip = new JSZip();
  const activeKeys = [...requiredKeys].sort();
  let totalFiles = 0;
  for (const key of activeKeys) {
    const entry = pool.get(key);
    for (const file of entry.files) {
      outZip.file(file.path, file.data, { date: FIXED_DATE, unixPermissions: 0o644 });
      totalFiles++;
    }
  }

  const outBuf = await outZip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
  await fs.writeFile(bundlePath, outBuf);
  const sha256 = crypto.createHash('sha256').update(outBuf).digest('hex');

  const libraries = activeKeys.map(key => {
    const { dir, json } = pool.get(key);
    return {
      dir,
      machineName: json.machineName,
      version: `${json.majorVersion}.${json.minorVersion}.${json.patchVersion}`,
      coreApi: json.coreApi ? `${json.coreApi.majorVersion}.${json.coreApi.minorVersion}` : null,
      license: json.license || 'Ver library.json',
      author: json.author || 'Ver library.json'
    };
  });

  console.log(JSON.stringify({
    bundlePath,
    bytes: outBuf.length,
    totalFiles,
    libraryCount: libraries.length,
    sha256,
    formats: formatSummaries,
    libraries
  }, null, 2));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
