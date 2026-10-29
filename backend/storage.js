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

function backupCourse(course) {
  return {
    id: course.id,
    code: course.code || '',
    name: course.name || '',
    term: course.term || '',
    section: course.section || '1',
    colorTag: course.colorTag || 'primary',
    description: course.description || '',
    isFavorite: Boolean(course.isFavorite),
    archivedAt: course.archivedAt || null,
    lastOpenedAt: course.lastOpenedAt || null,
    createdAt: course.createdAt || '',
    updatedAt: course.updatedAt || ''
  };
}

function backupProject(project) {
  return {
    ...project,
    filePath: '',
    sourceFiles: Array.isArray(project.sourceFiles)
      ? project.sourceFiles.map(file => ({ name: typeof file === 'string' ? file : (file?.name || '') }))
      : []
  };
}

function cleanBackupCourse(course) {
  return {
    id: course.id.slice(0, 120),
    code: typeof course.code === 'string' ? course.code.slice(0, 80) : '',
    name: course.name.trim().slice(0, 240),
    term: typeof course.term === 'string' ? course.term.slice(0, 120) : '',
    section: typeof course.section === 'string' && course.section.trim() ? course.section.slice(0, 80) : '1',
    colorTag: typeof course.colorTag === 'string' ? course.colorTag.slice(0, 40) : 'primary',
    description: typeof course.description === 'string' ? course.description.slice(0, 2000) : '',
    isFavorite: Boolean(course.isFavorite),
    archivedAt: typeof course.archivedAt === 'string' ? course.archivedAt : null,
    lastOpenedAt: typeof course.lastOpenedAt === 'string' ? course.lastOpenedAt : null,
    createdAt: typeof course.createdAt === 'string' ? course.createdAt : new Date().toISOString(),
    updatedAt: typeof course.updatedAt === 'string' ? course.updatedAt : new Date().toISOString()
  };
}

function cleanBackupProject(project) {
  return {
    id: project.id.slice(0, 120),
    courseId: typeof project.courseId === 'string' ? project.courseId.slice(0, 120) : 'unassigned',
    previousCourseId: typeof project.previousCourseId === 'string' ? project.previousCourseId.slice(0, 120) : undefined,
    reallocatedAt: typeof project.reallocatedAt === 'string' ? project.reallocatedAt : undefined,
    title: project.title.trim().slice(0, 240),
    h5pType: typeof project.h5pType === 'string' ? project.h5pType.slice(0, 120) : 'H5P General',
    filePath: '',
    sourceFiles: Array.isArray(project.sourceFiles)
      ? project.sourceFiles.slice(0, 50).map(file => ({ name: typeof file === 'string' ? file.slice(0, 255) : (typeof file?.name === 'string' ? file.name.slice(0, 255) : '') })).filter(file => file.name)
      : [],
    promptSummary: typeof project.promptSummary === 'string' ? project.promptSummary.slice(0, 12000) : '',
    fileSizeBytes: Number.isFinite(project.fileSizeBytes) && project.fileSizeBytes > 0 ? project.fileSizeBytes : 0,
    exportedAt: typeof project.exportedAt === 'string' ? project.exportedAt : new Date().toISOString()
  };
}

function cleanBackupTrashItem(item) {
  return {
    id: item.id.slice(0, 120),
    type: item.type,
    deletedAt: typeof item.deletedAt === 'string' ? item.deletedAt : new Date().toISOString(),
    record: item.type === 'course' ? cleanBackupCourse(item.record) : cleanBackupProject(item.record)
  };
}

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
        drafts: [],
        trash: []
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
      const courses = (Array.isArray(parsed.courses) ? parsed.courses : []).map(c => {
        if (!c.section) {
          const secFromDesc = c.description && /^s\d+$/i.test(c.description.trim())
            ? c.description.trim().replace(/^s/i, '')
            : '1';
          return { ...c, section: secFromDesc };
        }
        return c;
      });
      return {
        courses,
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
        drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
        trash: Array.isArray(parsed.trash) ? parsed.trash : []
      };
    } catch (err) {
      console.error('[AcademicStorage] Error leyendo academic_store.json:', err);
      return { courses: [], projects: [], settings: {}, drafts: [], trash: [] };
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
        isFavorite: Boolean(course.isFavorite),
        archivedAt: course.archivedAt || null,
        lastOpenedAt: course.lastOpenedAt || null,
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

  setCourseOrganization(courseId, changes = {}) {
    const data = this._readData();
    const course = data.courses.find(item => item.id === courseId);
    if (!course) throw new Error('No se encontró el ramo.');
    if (typeof changes.isFavorite === 'boolean') course.isFavorite = changes.isFavorite;
    if (changes.archivedAt === null || typeof changes.archivedAt === 'string') course.archivedAt = changes.archivedAt;
    course.updatedAt = new Date().toISOString();
    this._writeData(data);
    return this.getCourseById(courseId);
  }

  markCourseOpened(courseId) {
    const data = this._readData();
    const course = data.courses.find(item => item.id === courseId);
    if (!course) return false;
    course.lastOpenedAt = new Date().toISOString();
    this._writeData(data);
    return course.lastOpenedAt;
  }

  /**
   * Normaliza una sección a su identificador canónico.
   * Por defecto, cualquier sección vacía o indefinida se considera "1".
   * Normaliza variaciones como "s1", "sec 1", "sección 1", "01" -> "1".
   * @private
   * @param {string} sec
   * @returns {string}
   */
  _normalizeSection(sec) {
    if (!sec || typeof sec !== 'string') return '1';
    const trimmed = sec.trim().toLowerCase();
    if (!trimmed) return '1';
    const match = trimmed.match(/^(?:sec(?:ci[oó]n)?\.?|s)?\s*0*([0-9]+)$/i);
    if (match) return match[1];
    const letterMatch = trimmed.match(/^(?:sec(?:ci[oó]n)?\.?|s)?\s*([a-z])$/i);
    if (letterMatch) return letterMatch[1];
    return trimmed;
  }

  /**
   * Verifica si existe otro curso con la misma combinación identificadora
   * Regla: mismo (código o nombre) + mismo semestre (term) + misma sección.
   * @private
   * @param {object} courseInput
   * @param {Array<object>} courses
   * @param {string|null} [excludeId]
   * @returns {object|null}
   */
  _findDuplicateCourse(courseInput, courses, excludeId = null) {
    const inputCode = (courseInput.code || '').trim().toLowerCase();
    const inputName = (courseInput.name || '').trim().toLowerCase();
    const inputTerm = (courseInput.term || '').trim().toLowerCase();
    const inputSection = this._normalizeSection(courseInput.section);

    return courses.find(c => {
      if (excludeId && c.id === excludeId) return false;

      const cCode = (c.code || '').trim().toLowerCase();
      const cName = (c.name || '').trim().toLowerCase();
      const cTerm = (c.term || '').trim().toLowerCase();
      const cSection = this._normalizeSection(c.section);

      const sameTerm = inputTerm === cTerm;
      const sameSection = inputSection === cSection;

      if (!sameTerm || !sameSection) return false;

      const sameSubject = (inputCode && cCode && inputCode === cCode) || (inputName === cName);
      return sameSubject;
    }) || null;
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

    // Validación de duplicados (mismo código/nombre + semestre + sección)
    const duplicate = this._findDuplicateCourse(courseInput, data.courses, courseInput.id || null);
    if (duplicate) {
      const secDetail = duplicate.section ? `, sección "${duplicate.section}"` : '';
      const termDetail = duplicate.term ? ` (${duplicate.term})` : '';
      throw new Error(`Ya existe un ramo registrado para "${duplicate.name}"${termDetail}${secDetail}. Modifica la sección o el periodo para evitar duplicados.`);
    }

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
        section: (courseInput.section || '1').trim(),
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
      section: (courseInput.section || '1').trim(),
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
        courses: data.courses.map(backupCourse),
        projects: data.projects.map(backupProject),
        drafts: data.drafts,
        trash: data.trash.map(item => ({
          id: item.id,
          type: item.type,
          deletedAt: item.deletedAt,
          record: item.type === 'course' ? backupCourse(item.record) : backupProject(item.record)
        }))
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
    const trash = Array.isArray(payload.data.trash) ? payload.data.trash : [];
    const hasInvalidCourse = payload.data.courses.some(course => !course || typeof course.id !== 'string' || !course.id.trim() || typeof course.name !== 'string' || !course.name.trim());
    const hasInvalidProject = payload.data.projects.some(project => !project || typeof project.id !== 'string' || !project.id.trim() || typeof project.title !== 'string' || !project.title.trim());
    const hasInvalidDraft = drafts.some(draft => !draft || typeof draft.id !== 'string' || !draft.id.trim() || typeof draft.courseId !== 'string' || !draft.courseId.trim());
    const hasInvalidTrashItem = trash.some(item => !item || typeof item.id !== 'string' || !item.id.trim() || !['course', 'project'].includes(item.type) || !item.record || typeof item.record.id !== 'string' || !item.record.id.trim() || (item.type === 'course' ? typeof item.record.name !== 'string' || !item.record.name.trim() : typeof item.record.title !== 'string' || !item.record.title.trim()));
    const hasDuplicateIds = records => new Set(records.map(record => record.id)).size !== records.length;
    const hasTooManyRecords = payload.data.courses.length > 5000 || payload.data.projects.length > 50000 || drafts.length > 5000 || trash.length > 55000;
    if (hasInvalidCourse || hasInvalidProject || hasInvalidDraft || hasInvalidTrashItem || hasDuplicateIds(payload.data.courses) || hasDuplicateIds(payload.data.projects) || hasDuplicateIds(drafts) || hasDuplicateIds(trash) || hasTooManyRecords) {
      throw new Error('La copia contiene datos no válidos o supera los límites compatibles.');
    }
    return {
      format: payload.format,
      version: payload.version,
      exportedAt: payload.exportedAt || '',
      counts: {
        courses: payload.data.courses.length,
        projects: payload.data.projects.length,
        drafts: drafts.length,
        trash: trash.length
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
      courses: payload.data.courses.map(cleanBackupCourse),
      projects: payload.data.projects.map(cleanBackupProject),
      drafts: (Array.isArray(payload.data.drafts) ? payload.data.drafts : []).map(draft => ({
        id: draft.id.slice(0, 120),
        courseId: draft.courseId.slice(0, 120),
        previousCourseId: typeof draft.previousCourseId === 'string' ? draft.previousCourseId.slice(0, 120) : undefined,
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
      })),
      trash: (Array.isArray(payload.data.trash) ? payload.data.trash : []).map(cleanBackupTrashItem)
    };

    if (strategy === 'replace') {
      this._createPreRestoreSnapshot(existing);
      existing.courses = incoming.courses;
      existing.projects = incoming.projects;
      existing.drafts = incoming.drafts;
      existing.trash = incoming.trash;
    } else {
      const mergeById = (current, added) => {
        const ids = new Set(current.map(item => item.id));
        return [...current, ...added.filter(item => !ids.has(item.id))];
      };
      existing.courses = mergeById(existing.courses, incoming.courses);
      existing.projects = mergeById(existing.projects, incoming.projects);
      existing.drafts = mergeById(existing.drafts, incoming.drafts);
      existing.trash = mergeById(existing.trash, incoming.trash);
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
    const courseIndex = data.courses.findIndex(course => course.id === courseId);
    if (courseIndex < 0) return false;
    const [course] = data.courses.splice(courseIndex, 1);
    const deletedAt = new Date().toISOString();
    data.trash.unshift({ id: crypto.randomUUID(), type: 'course', deletedAt, record: course });

    // Reasignación automática de proyectos huérfanos a categoría 'unassigned'
    data.projects = data.projects.map(proj => {
      if (proj.courseId === courseId) {
        return {
          ...proj,
          courseId: 'unassigned',
          previousCourseId: courseId,
          reallocatedAt: new Date().toISOString()
        };
      }
      return proj;
    });
    data.drafts = data.drafts.map(draft => draft.courseId === courseId
      ? { ...draft, courseId: 'unassigned', previousCourseId: courseId, courseName: draft.courseName || course.name }
      : draft);

    this._writeData(data);
    return true;
  }

  getTrash() {
    return this._readData().trash.sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
  }

  restoreTrashItem(trashId) {
    const data = this._readData();
    const index = data.trash.findIndex(item => item.id === trashId);
    if (index < 0) return false;
    const [item] = data.trash.splice(index, 1);
    if (item.type === 'course') {
      if (data.courses.some(course => course.id === item.record.id)) throw new Error('Ese ramo ya existe y no se puede duplicar.');
      data.courses.push(item.record);
      data.projects = data.projects.map(project => {
        if (project.courseId !== 'unassigned' || project.previousCourseId !== item.record.id) return project;
        const restored = { ...project, courseId: item.record.id };
        delete restored.previousCourseId;
        delete restored.reallocatedAt;
        return restored;
      });
      data.drafts = data.drafts.map(draft => {
        if (draft.courseId !== 'unassigned' || draft.previousCourseId !== item.record.id) return draft;
        const restored = { ...draft, courseId: item.record.id };
        delete restored.previousCourseId;
        return restored;
      });
    } else if (item.type === 'project') {
      if (data.projects.some(project => project.id === item.record.id)) throw new Error('Ese proyecto ya existe y no se puede duplicar.');
      const project = { ...item.record };
      if (project.courseId === 'unassigned' && project.previousCourseId && data.courses.some(course => course.id === project.previousCourseId)) {
        project.courseId = project.previousCourseId;
        delete project.previousCourseId;
        delete project.reallocatedAt;
      } else if (project.courseId !== 'unassigned' && !data.courses.some(course => course.id === project.courseId)) {
        project.previousCourseId = project.courseId;
        project.courseId = 'unassigned';
      }
      data.projects.unshift(project);
    } else {
      throw new Error('El tipo de elemento de la papelera no es válido.');
    }
    this._writeData(data);
    return true;
  }

  permanentlyDeleteTrashItem(trashId) {
    const data = this._readData();
    const index = data.trash.findIndex(item => item.id === trashId);
    if (index < 0) return false;
    const [item] = data.trash.splice(index, 1);
    if (item.type === 'course') {
      data.projects.forEach(project => {
        if (project.previousCourseId === item.record.id) {
          delete project.previousCourseId;
          delete project.reallocatedAt;
        }
      });
      data.drafts.forEach(draft => {
        if (draft.previousCourseId === item.record.id) delete draft.previousCourseId;
      });
    }
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

  assignProject(projectId, courseId) {
    const data = this._readData();
    if (courseId !== 'unassigned' && !data.courses.some(course => course.id === courseId)) {
      throw new Error('No se encontró el ramo seleccionado.');
    }
    const project = data.projects.find(item => item.id === projectId);
    if (!project) throw new Error('No se encontró el proyecto.');
    project.courseId = courseId;
    delete project.previousCourseId;
    delete project.reallocatedAt;
    this._writeData(data);
    return project;
  }

  /**
   * Elimina un proyecto por ID
   * @param {string} projectId
   * @returns {boolean}
   */
  deleteProject(projectId) {
    const data = this._readData();
    const index = data.projects.findIndex(project => project.id === projectId);
    if (index < 0) return false;
    const [project] = data.projects.splice(index, 1);
    data.trash.unshift({ id: crypto.randomUUID(), type: 'project', deletedAt: new Date().toISOString(), record: project });

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
