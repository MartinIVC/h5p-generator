/**
 * backend/storage.js
 * Servicio de persistencia local para Ramos y Proyectos H5P exportados.
 * Almacena la información estructurada en academic_store.json en el directorio de usuario (userData) de Electron.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
        settings: {}
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
        settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}
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
