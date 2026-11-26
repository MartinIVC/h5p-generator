'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isValidActivityCount } = require('../prompts');
const { EDITABLE_ACTIVITY_SCHEMA_VERSION, MAX_EDITABLE_TITLE_LENGTH } = require('./editableActivity');
const { assertEditableDraft } = require('./activityEdits');

const RECORD_VERSION = 1;
const MAX_EDITORIAL_BYTES = 1024 * 1024;
const REFERENCE = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function editorialError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function writePrivateFile(filePath, payload) {
  const temporary = `${filePath}.tmp.${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, payload, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
}

function assertSource(source, activityType) {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      Object.keys(source).length !== 4 ||
      !['activityType', 'questionCount', 'title', 'instructions'].every(key => Object.hasOwn(source, key)) ||
      source.activityType !== activityType ||
      !isValidActivityCount(activityType, source.questionCount) ||
      (source.title !== null && (typeof source.title !== 'string' || source.title.length > MAX_EDITABLE_TITLE_LENGTH ||
        /[\x00-\x1f\x7f]/.test(source.title))) ||
      typeof source.instructions !== 'string' || source.instructions.length > 10000) {
    throw editorialError('INVALID_EDITORIAL_SOURCE');
  }
}

function assertBody(activity, source) {
  assertEditableDraft(activity);
  assertSource(source, activity.activityType);
}

class EditorialStore {
  constructor(directory) {
    this.directory = directory;
  }

  write(kind, ownerId, { activity, source }) {
    assertBody(activity, source);
    const reference = randomUUID();
    const payload = Buffer.from(JSON.stringify({
      schemaVersion: RECORD_VERSION,
      kind,
      ownerId,
      savedAt: new Date().toISOString(),
      activity,
      source
    }));
    if (payload.length > MAX_EDITORIAL_BYTES) throw editorialError('EDITORIAL_TOO_LARGE');
    try {
      fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      writePrivateFile(this.#file(reference), payload);
    } catch {
      throw editorialError('EDITORIAL_WRITE_FAILED');
    }
    return reference;
  }

  read(reference, kind, ownerId) {
    let record;
    try {
      const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
      const fd = fs.openSync(this.#file(reference), flags);
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile()) throw editorialError('EDITORIAL_UNREADABLE');
        if (stat.size > MAX_EDITORIAL_BYTES) throw editorialError('EDITORIAL_TOO_LARGE');
        const buffer = Buffer.allocUnsafe(MAX_EDITORIAL_BYTES + 1);
        let bytes = 0;
        while (bytes < buffer.length) {
          const count = fs.readSync(fd, buffer, bytes, buffer.length - bytes);
          if (count === 0) break;
          bytes += count;
        }
        if (bytes > MAX_EDITORIAL_BYTES) throw editorialError('EDITORIAL_TOO_LARGE');
        record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes)));
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      if (error?.code === 'EDITORIAL_TOO_LARGE') throw error;
      throw editorialError('EDITORIAL_UNREADABLE');
    }

    if (!record || typeof record !== 'object') throw editorialError('EDITORIAL_UNREADABLE');
    if (Number.isInteger(record.schemaVersion) && record.schemaVersion !== RECORD_VERSION) {
      throw editorialError('EDITORIAL_VERSION_UNSUPPORTED');
    }
    if (Number.isInteger(record.activity?.schemaVersion) &&
        record.activity.schemaVersion !== EDITABLE_ACTIVITY_SCHEMA_VERSION) {
      throw editorialError('EDITORIAL_VERSION_UNSUPPORTED');
    }
    try {
      if (record.schemaVersion !== RECORD_VERSION || record.kind !== kind || record.ownerId !== ownerId ||
          typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt))) {
        throw editorialError('EDITORIAL_UNREADABLE');
      }
      assertBody(record.activity, record.source);
    } catch {
      throw editorialError('EDITORIAL_UNREADABLE');
    }
    return { activity: record.activity, source: record.source, savedAt: record.savedAt };
  }

  remove(reference) {
    try { fs.rmSync(this.#file(reference), { force: true }); } catch {}
  }

  #file(reference) {
    if (typeof reference !== 'string' || !REFERENCE.test(reference)) throw editorialError('EDITORIAL_UNREADABLE');
    return path.join(this.directory, `${reference}.json`);
  }
}

module.exports = { EditorialStore, writePrivateFile };
