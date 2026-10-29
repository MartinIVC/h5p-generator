/**
 * backend/storage.js
 * Servicio de persistencia local para Ramos y Proyectos H5P exportados.
 * Almacena la información estructurada en academic_store.json en el directorio de usuario (userData) de Electron.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BACKUP_FORMAT = 'h5p-generator-backup';
const BACKUP_VERSION = 1;

class AcademicStorage {
  /**
   * @param {string} [customPath] Ruta personalizada opcional (útil para tests o entornos sin Electron)
   */
  constructor(customPath) {
    this.filePath = customPath || this._resolveDefaultPath();
    this._ensureFileExists();
  }

  /**
   * Determina la ruta por defecto del archivo de almacenamiento
   * @private
   */
  _resolveDefaultPath() {
    try {
      const { app } = require('electron');
      if (app && typeof app.getPath === 'function') {
        return path.join(app.getPath('userData'), 'academic_store.json');
      }
    } catch {
      // Electron no disponible (modo script o pruebas)
    }
    return path.join(__dirname, '..', 'data', 'academic_store.json');
  }

  /**
   * Asegura que el directorio y el archivo de almacenamiento existan
   * @private
   */
  _ensureFileExists() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.filePath)) {
      const initialData = {
        courses: [],
        projects: [],
        settings: {},
        drafts: []
      };
      this._writeData(initialData);
    }
  }

  /**
   * Lee los datos desde el archivo JSON de manera segura
   * @private
   * @returns {{ courses: Array<any>, projects: Array<any>, settings: object }}
   */
  _readData() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this._ensureFileExists();
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        courses: Array.isArray(parsed.courses) ? parsed.courses : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
        drafts: Array.isArray(parsed.drafts) ? parsed.drafts : []
      };
    } catch (err) {
      console.error('[AcademicStorage] Error leyendo academic_store.json:', err);
      return { courses: [], projects: [], settings: {} };
    }
  }

  /**
   * Escribe los datos al archivo JSON de forma atómica
   * @private
   * @param {{ courses: Array<any>, projects: Array<any> }} data
   */
  _writeData(data) {
    const tempPath = `${this.filePath}.tmp.${Date.now()}`;
    const payload = JSON.stringify(data, null, 2);
    fs.writeFileSync(tempPath, payload, 'utf-8');
    fs.renameSync(tempPath, this.filePath);
  }

  // ==========================================
  // GESTIÓN DE RAMOS (COURSES)
  // ==========================================

  /**
   * Obtiene todos los ramos, incluyendo el contador de proyectos asociados
   * @returns {Array<object>}
   */
  getAllCourses() {
    const data = this._readData();
    return data.courses.map(course => {
      const projectsCount = data.projects.filter(p => p.courseId === course.id).length;
      return {
        ...course,
        projectsCount
      };
    });
  }

  /**
   * Obtiene un ramo por su ID
   * @param {string} courseId
   * @returns {object|null}
   */
  getCourseById(courseId) {
    const data = this._readData();
    const course = data.courses.find(c => c.id === courseId);
    if (!course) return null;
    const projectsCount = data.projects.filter(p => p.courseId === course.id).length;
    return { ...course, projectsCount };
  }

  /**
   * Crea o actualiza un ramo
   * @param {object} courseInput
   * @returns {object} Ramo guardado
   */
  saveCourse(courseInput) {
    if (!courseInput.name || !courseInput.name.trim()) {
      throw new Error('El nombre de la asignatura es obligatorio');
    }

    const data = this._readData();
    const now = new Date().toISOString();

    if (courseInput.id) {
      // Actualización de ramo existente
      const index = data.courses.findIndex(c => c.id === courseInput.id);
      if (index === -1) {
        throw new Error(`Ramo con id ${courseInput.id} no encontrado`);
      }
      const existing = data.courses[index];
      const updated = {
        ...existing,
        code: (courseInput.code || '').trim().toUpperCase(),
        name: courseInput.name.trim(),
        term: (courseInput.term || '').trim(),
        colorTag: courseInput.colorTag || existing.colorTag || 'primary',
        description: (courseInput.description || '').trim(),
        updatedAt: now
      };
      data.courses[index] = updated;
      this._writeData(data);
      return this.getCourseById(updated.id);
    }

    // Creación de nuevo ramo
    const newCourse = {
      id: crypto.randomUUID(),
      code: (courseInput.code || '').trim().toUpperCase(),
      name: courseInput.name.trim(),
      term: (courseInput.term || '').trim(),
      colorTag: courseInput.colorTag || 'primary',
      description: (courseInput.description || '').trim(),
      createdAt: now,
      updatedAt: now
    };

    data.courses.unshift(newCourse);
    this._writeData(data);
    return { ...newCourse, projectsCount: 0 };
  }

  // ==========================================
  // BORRADORES LOCALES DEL ASISTENTE
  // ==========================================

  getDrafts() {
    const data = this._readData();
    return data.drafts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  saveDraft(draftInput) {
    if (!draftInput || typeof draftInput !== 'object') {
      throw new Error('El borrador no es válido.');
    }
    if (!draftInput.courseId || typeof draftInput.courseId !== 'string') {
      throw new Error('El borrador debe pertenecer a un ramo.');
    }

    const data = this._readData();
    const now = new Date().toISOString();
    const draft = {
      id: typeof draftInput.id === 'string' && draftInput.id ? draftInput.id : crypto.randomUUID(),
      courseId: draftInput.courseId,
      courseName: typeof draftInput.courseName === 'string' ? draftInput.courseName.slice(0, 240) : '',
      prompt: typeof draftInput.prompt === 'string' ? draftInput.prompt.slice(0, 12000) : '',
      files: Array.isArray(draftInput.files)
        ? draftInput.files.slice(0, 50).map(file => ({
          name: typeof file?.name === 'string' ? file.name.slice(0, 255) : '',
          size: Number.isFinite(file?.size) && file.size > 0 ? file.size : 0,
          lastModified: Number.isFinite(file?.lastModified) ? file.lastModified : 0
        })).filter(file => file.name)
        : [],
      updatedAt: now
    };

    const index = data.drafts.findIndex(existing => existing.id === draft.id);
    if (index >= 0) data.drafts[index] = draft;
    else data.drafts.unshift(draft);
    this._writeData(data);
    return draft;
  }

  deleteDraft(draftId) {
    const data = this._readData();
    const initialCount = data.drafts.length;
    data.drafts = data.drafts.filter(draft => draft.id !== draftId);
    if (data.drafts.length === initialCount) return false;
    this._writeData(data);
    return true;
  }

  createBackupPayload() {
    const data = this._readData();
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        courses: data.courses,
        projects: data.projects.map(project => ({
          ...project,
          filePath: '',
          sourceFiles: Array.isArray(project.sourceFiles)
            ? project.sourceFiles.map(file => ({ name: typeof file === 'string' ? file : (file?.name || '') }))
            : []
        })),
        drafts: data.drafts
      }
    };
  }

  inspectBackupPayload(payload) {
    if (!payload || payload.format !== BACKUP_FORMAT) {
      throw new Error('El archivo no corresponde a una copia del Generador H5P.');
    }
    if (payload.version !== BACKUP_VERSION) {
      throw new Error(`La versión de la copia (${payload.version}) no es compatible.`);
    }
    if (!payload.data || !Array.isArray(payload.data.courses) || !Array.isArray(payload.data.projects)) {
      throw new Error('La copia no contiene listas válidas de ramos y proyectos.');
    }
    const drafts = Array.isArray(payload.data.drafts) ? payload.data.drafts : [];
    const hasInvalidCourse = payload.data.courses.some(course => !course || typeof course.id !== 'string' || !course.id.trim() || typeof course.name !== 'string' || !course.name.trim());
    const hasInvalidProject = payload.data.projects.some(project => !project || typeof project.id !== 'string' || !project.id.trim() || typeof project.title !== 'string' || !project.title.trim());
    const hasInvalidDraft = drafts.some(draft => !draft || typeof draft.id !== 'string' || !draft.id.trim() || typeof draft.courseId !== 'string' || !draft.courseId.trim());
    const hasDuplicateIds = records => new Set(records.map(record => record.id)).size !== records.length;
    const hasTooManyRecords = payload.data.courses.length > 5000 || payload.data.projects.length > 50000 || drafts.length > 5000;
    if (hasInvalidCourse || hasInvalidProject || hasInvalidDraft || hasDuplicateIds(payload.data.courses) || hasDuplicateIds(payload.data.projects) || hasDuplicateIds(drafts) || hasTooManyRecords) {
      throw new Error('La copia contiene datos no válidos o supera los límites compatibles.');
    }
    return {
      format: payload.format,
      version: payload.version,
      exportedAt: payload.exportedAt || '',
      counts: {
        courses: payload.data.courses.length,
        projects: payload.data.projects.length,
        drafts: drafts.length
      }
    };
  }

  restoreBackupPayload(payload, strategy) {
    const summary = this.inspectBackupPayload(payload);
    if (!['merge', 'replace'].includes(strategy)) {
      throw new Error('El modo de restauración no es válido.');
    }

    const existing = this._readData();
    const incoming = {
      courses: payload.data.courses.map(course => ({
        id: course.id.slice(0, 120),
        code: typeof course.code === 'string' ? course.code.slice(0, 80) : '',
        name: course.name.trim().slice(0, 240),
        term: typeof course.term === 'string' ? course.term.slice(0, 120) : '',
        colorTag: typeof course.colorTag === 'string' ? course.colorTag.slice(0, 40) : 'primary',
        description: typeof course.description === 'string' ? course.description.slice(0, 2000) : '',
        createdAt: typeof course.createdAt === 'string' ? course.createdAt : new Date().toISOString(),
        updatedAt: typeof course.updatedAt === 'string' ? course.updatedAt : new Date().toISOString()
      })),
      projects: payload.data.projects.map(project => ({
        id: project.id.slice(0, 120),
        courseId: typeof project.courseId === 'string' ? project.courseId.slice(0, 120) : 'unassigned',
        title: project.title.trim().slice(0, 240),
        h5pType: typeof project.h5pType === 'string' ? project.h5pType.slice(0, 120) : 'H5P General',
        filePath: '',
        sourceFiles: Array.isArray(project.sourceFiles)
          ? project.sourceFiles.slice(0, 50).map(file => ({ name: typeof file === 'string' ? file.slice(0, 255) : (typeof file?.name === 'string' ? file.name.slice(0, 255) : '') })).filter(file => file.name)
          : [],
        promptSummary: typeof project.promptSummary === 'string' ? project.promptSummary.slice(0, 12000) : '',
        fileSizeBytes: Number.isFinite(project.fileSizeBytes) && project.fileSizeBytes > 0 ? project.fileSizeBytes : 0,
        exportedAt: typeof project.exportedAt === 'string' ? project.exportedAt : new Date().toISOString()
      })),
      drafts: (Array.isArray(payload.data.drafts) ? payload.data.drafts : []).map(draft => ({
        id: draft.id.slice(0, 120),
        courseId: draft.courseId.slice(0, 120),
        courseName: typeof draft.courseName === 'string' ? draft.courseName.slice(0, 240) : '',
        prompt: typeof draft.prompt === 'string' ? draft.prompt.slice(0, 12000) : '',
        files: Array.isArray(draft.files)
          ? draft.files.slice(0, 50).map(file => ({
            name: typeof file?.name === 'string' ? file.name.slice(0, 255) : '',
            size: Number.isFinite(file?.size) && file.size > 0 ? file.size : 0,
            lastModified: Number.isFinite(file?.lastModified) ? file.lastModified : 0
          })).filter(file => file.name)
          : [],
        updatedAt: typeof draft.updatedAt === 'string' ? draft.updatedAt : new Date().toISOString()
      }))
    };

    if (strategy === 'replace') {
      this._createPreRestoreSnapshot(existing);
      existing.courses = incoming.courses;
      existing.projects = incoming.projects;
      existing.drafts = incoming.drafts;
    } else {
      const mergeById = (current, added) => {
        const ids = new Set(current.map(item => item.id));
        return [...current, ...added.filter(item => !ids.has(item.id))];
      };
      existing.courses = mergeById(existing.courses, incoming.courses);
      existing.projects = mergeById(existing.projects, incoming.projects);
      existing.drafts = mergeById(existing.drafts, incoming.drafts);
    }

    const courseIds = new Set(existing.courses.map(course => course.id));
    existing.projects = existing.projects.map(project => (
      project.courseId && project.courseId !== 'unassigned' && !courseIds.has(project.courseId)
        ? { ...project, courseId: 'unassigned' }
        : project
    ));
    existing.drafts = existing.drafts.map(draft => (
      draft.courseId !== 'unassigned' && !courseIds.has(draft.courseId)
        ? { ...draft, courseId: 'unassigned', courseName: draft.courseName || 'Proyecto sin ramo' }
        : draft
    ));

    this._writeData(existing);
    return { strategy, counts: summary.counts };
  }

  _createPreRestoreSnapshot(data) {
    const directory = path.join(path.dirname(this.filePath), 'backups');
    fs.mkdirSync(directory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(directory, `academic_store-before-restore-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    return backupPath;
  }

  /**
   * Elimina un ramo.
   * Regla de negocio: los proyectos asociados no se pierden; se reasignan a 'unassigned'.
   * @param {string} courseId
   * @returns {boolean}
   */
  deleteCourse(courseId) {
    const data = this._readData();
    const initialCourseCount = data.courses.length;
    data.courses = data.courses.filter(c => c.id !== courseId);

    if (data.courses.length === initialCourseCount) {
      return false; // No se encontró el curso
    }

    // Reasignación automática de proyectos huérfanos a categoría 'unassigned'
    let reallocatedCount = 0;
    data.projects = data.projects.map(proj => {
      if (proj.courseId === courseId) {
        reallocatedCount++;
        return {
          ...proj,
          courseId: 'unassigned',
          previousCourseId: courseId,
          reallocatedAt: new Date().toISOString()
        };
      }
      return proj;
    });

    this._writeData(data);
    return true;
  }

  // ==========================================
  // GESTIÓN DE PROYECTOS EXPORTADOS (PROJECTS)
  // ==========================================

  /**
   * Obtiene la lista de proyectos, opcionalmente filtrados por ramo
   * @param {string} [courseId] Si se provee, filtra los proyectos
   * @returns {Array<object>}
   */
  getProjects(courseId) {
    const data = this._readData();
    let list = data.projects;
    if (courseId) {
      list = list.filter(p => p.courseId === courseId);
    }
    // Ordenar de más reciente a más antiguo
    return list.sort((a, b) => new Date(b.exportedAt).getTime() - new Date(a.exportedAt).getTime());
  }

  /**
   * Registra un nuevo proyecto exportado
   * @param {object} projectInput
   * @returns {object} Proyecto registrado
   */
  saveProject(projectInput) {
    if (!projectInput.title || !projectInput.title.trim()) {
      throw new Error('El título del proyecto es obligatorio');
    }

    const data = this._readData();
    const now = new Date().toISOString();

    const newProject = {
      id: projectInput.id || crypto.randomUUID(),
      courseId: projectInput.courseId || 'unassigned',
      title: projectInput.title.trim(),
      h5pType: projectInput.h5pType || 'H5P General',
      filePath: projectInput.filePath || '',
      sourceFiles: Array.isArray(projectInput.sourceFiles) ? projectInput.sourceFiles : [],
      promptSummary: (projectInput.promptSummary || '').trim(),
      fileSizeBytes: projectInput.fileSizeBytes || 0,
      exportedAt: projectInput.exportedAt || now
    };

    data.projects.unshift(newProject);
    this._writeData(data);
    return newProject;
  }

  /**
   * Elimina un proyecto por ID
   * @param {string} projectId
   * @returns {boolean}
   */
  deleteProject(projectId) {
    const data = this._readData();
    const initialCount = data.projects.length;
    data.projects = data.projects.filter(p => p.id !== projectId);

    if (data.projects.length === initialCount) {
      return false;
    }

    this._writeData(data);
    return true;
  }

  /**
   * Comprueba si el archivo físico de un proyecto existe en disco
   * @param {string} filePath
   * @returns {boolean}
   */
  verifyFileExists(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    return fs.existsSync(filePath);
  }

  // ==========================================
  // GESTIÓN DE CONFIGURACIÓN Y CREDENCIALES
  // ==========================================

  /**
   * Encripta una cadena usando safeStorage si está disponible en Electron
   * @private
   */
  _encryptString(plainText) {
    try {
      const { safeStorage } = require('electron');
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(plainText);
        return { isEncrypted: true, payload: encrypted.toString('base64') };
      }
    } catch {
      // safeStorage no disponible (ej. headless sin keyring o entorno de test)
    }
    return { isEncrypted: false, payload: Buffer.from(plainText).toString('base64') };
  }

  /**
   * Desencripta una cadena previamente guardada
   * @private
   */
  _decryptString(envelope) {
    if (!envelope || !envelope.payload) return '';
    try {
      if (envelope.isEncrypted) {
        const { safeStorage } = require('electron');
        if (safeStorage) {
          const buffer = Buffer.from(envelope.payload, 'base64');
          return safeStorage.decryptString(buffer);
        }
      }
    } catch (err) {
      console.warn('[AcademicStorage] Error desencriptando con safeStorage:', err);
    }
    try {
      return Buffer.from(envelope.payload, 'base64').toString('utf-8');
    } catch {
      return '';
    }
  }

  /**
   * Enmascara una API key para mostrarla segura en la UI (ej. AIza••••••••7890)
   * @private
   */
  _maskApiKey(key) {
    if (!key || typeof key !== 'string') return '';
    if (key.length <= 8) return '••••••••';
    const start = key.slice(0, 4);
    const end = key.slice(-4);
    return `${start}••••••••••••${end}`;
  }

  /**
   * Obtiene el estado de configuración de la clave API de Gemini
   * @returns {{ hasKey: boolean, maskedKey: string }}
   */
  getApiKeyStatus() {
    const data = this._readData();
    const envelope = data.settings && data.settings.geminiApiKey;
    if (!envelope) {
      return { hasKey: false, maskedKey: '' };
    }
    const decrypted = this._decryptString(envelope);
    if (!decrypted) {
      return { hasKey: false, maskedKey: '' };
    }
    return { hasKey: true, maskedKey: this._maskApiKey(decrypted) };
  }

  /**
   * Obtiene la clave en texto claro para llamadas a la API de Gemini
   * @returns {string}
   */
  getApiKey() {
    const data = this._readData();
    const envelope = data.settings && data.settings.geminiApiKey;
    if (!envelope) return '';
    return this._decryptString(envelope);
  }

  /**
   * Guarda de forma segura la clave API de Gemini
   * @param {string} apiKey
   * @returns {{ hasKey: boolean, maskedKey: string }}
   */
  saveApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('La clave API no puede estar vacía.');
    }
    const trimmed = apiKey.trim();
    const data = this._readData();
    if (!data.settings) data.settings = {};
    data.settings.geminiApiKey = this._encryptString(trimmed);
    this._writeData(data);
    return { hasKey: true, maskedKey: this._maskApiKey(trimmed) };
  }

  /**
   * Elimina la clave API guardada
   * @returns {{ hasKey: boolean, maskedKey: string }}
   */
  removeApiKey() {
    const data = this._readData();
    if (data.settings && data.settings.geminiApiKey) {
      delete data.settings.geminiApiKey;
      this._writeData(data);
    }
    return { hasKey: false, maskedKey: '' };
  }
}

// Instancia singleton por defecto
const academicStorage = new AcademicStorage();

module.exports = {
  AcademicStorage,
  academicStorage
};
