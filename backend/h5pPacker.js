'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBasePackageZip, validateH5PPackage } = require('./h5pTemplates');
const { buildH5PContent } = require('./h5pBuilder');

function packerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hasZipSignature(buffer) {
  return buffer instanceof Uint8Array &&
    buffer.byteLength >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;
}

/**
 * Empaqueta en memoria un conjunto ya preparado (`type`, `metadata`, `content`)
 * en un archivo ZIP `.h5p` válido y verifica su integridad estructural con `validateH5PPackage`.
 */
async function packH5PFromPrepared(prepared, options = {}) {
  if (!prepared || typeof prepared !== 'object' || typeof prepared.type !== 'string' ||
      !prepared.metadata || typeof prepared.metadata !== 'object' ||
      !prepared.content || typeof prepared.content !== 'object') {
    throw packerError('INVALID_PREPARED_PACKAGE', 'Los datos preparados para el paquete H5P no son válidos.');
  }

  const loadOpts = options.templatesDir ? { templatesDir: options.templatesDir } : {};
  const zip = await createBasePackageZip(prepared.type, loadOpts);
  zip.file('h5p.json', JSON.stringify(prepared.metadata));
  zip.file('content/content.json', JSON.stringify(prepared.content));

  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  if (!hasZipSignature(bytes)) {
    throw packerError('INVALID_ZIP_HEADER', 'El paquete comprimido no posee un encabezado ZIP válido.');
  }

  const validation = await validateH5PPackage(bytes);
  return { bytes, validation };
}

/**
 * Construye e inyecta `h5p.json` y `content/content.json` y los comprime en un buffer `.h5p` validado.
 */
async function packH5PPackage(activityType, items, options = {}) {
  const prepared = await buildH5PContent(activityType, items, options);
  const { bytes, validation } = await packH5PFromPrepared(prepared, options);
  return {
    bytes,
    validation,
    type: prepared.type,
    itemCount: prepared.itemCount,
    title: prepared.metadata.title
  };
}

/**
 * Persiste un buffer `.h5p` de forma atómica usando un directorio temporal exclusivo junto al destino
 * y garantiza la limpieza automática de temporales mediante `fs.promises.rm` en bloque `finally` (CA-4).
 */
async function writeH5PFile(bytes, destinationPath, options = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || !hasZipSignature(bytes)) {
    throw packerError('INVALID_PACKAGE_BUFFER', 'El buffer del paquete H5P no es válido.');
  }
  if (typeof destinationPath !== 'string' || !/\.h5p$/i.test(destinationPath)) {
    throw packerError('INVALID_DESTINATION', 'El archivo destino debe tener extensión .h5p.');
  }

  const fileSystem = options.fileSystem || fs;
  const checkBeforeRename = typeof options.checkBeforeRename === 'function' ? options.checkBeforeRename : null;
  const dir = path.dirname(destinationPath);
  const id = crypto.randomUUID();
  const supportsWorkDir = typeof fileSystem.mkdir === 'function' && typeof fileSystem.rm === 'function';

  if (supportsWorkDir) {
    const workDir = path.join(dir, `.h5p-work-${id}`);
    const stagingFile = path.join(workDir, 'package.h5p');
    let createdWorkDir = false;
    try {
      await fileSystem.mkdir(workDir, { mode: 0o700 });
      createdWorkDir = true;
      await fileSystem.writeFile(stagingFile, bytes, { flag: 'wx', mode: 0o600 });
      if (checkBeforeRename && !checkBeforeRename()) {
        throw packerError('WRITE_ABORTED', 'La operación de guardado fue cancelada antes de confirmar el archivo.');
      }
      await fileSystem.rename(stagingFile, destinationPath);
      return { filePath: destinationPath, sizeBytes: bytes.byteLength };
    } finally {
      if (createdWorkDir) {
        try {
          await fileSystem.rm(workDir, { recursive: true, force: true });
        } catch {
          // No propagar errores de limpieza sobre el resultado principal.
        }
      }
    }
  }

  // Respaldo compatible con dobles de prueba mínimos que solo implementan writeFile/rename/unlink.
  const temporaryPath = path.join(dir, `.h5p-${id}.tmp`);
  let moved = false;
  try {
    await fileSystem.writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    if (checkBeforeRename && !checkBeforeRename()) {
      throw packerError('WRITE_ABORTED', 'La operación de guardado fue cancelada antes de confirmar el archivo.');
    }
    await fileSystem.rename(temporaryPath, destinationPath);
    moved = true;
    return { filePath: destinationPath, sizeBytes: bytes.byteLength };
  } finally {
    if (!moved && typeof fileSystem.unlink === 'function') {
      try {
        await fileSystem.unlink(temporaryPath);
      } catch {}
    }
  }
}

/**
 * Compone generación de `content.json`, empaquetado `.h5p` validado y escritura atómica a disco.
 */
async function packH5PToFile(activityType, items, destinationPath, options = {}) {
  const packed = await packH5PPackage(activityType, items, options);
  const written = await writeH5PFile(packed.bytes, destinationPath, options);
  return {
    filePath: written.filePath,
    sizeBytes: written.sizeBytes,
    validation: packed.validation,
    type: packed.type,
    itemCount: packed.itemCount,
    title: packed.title
  };
}

module.exports = {
  hasZipSignature,
  packH5PFromPrepared,
  packH5PPackage,
  writeH5PFile,
  packH5PToFile
};
