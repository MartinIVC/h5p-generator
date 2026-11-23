# Memoria del proyecto para agentes

## Arquitectura

- `frontend/index.js`: proceso principal de Electron, creación de ventana, diálogos, sistema de archivos y manejadores IPC. Importa `backend/storage.js`.
- `frontend/preload.js`: puente seguro de APIs permitidas usando `contextBridge` e `ipcRenderer.invoke`. Cada capacidad del renderer debe tener un método explícito aquí y un manejador correspondiente en el proceso principal.
- `frontend/ipc/h5pHandlers.js`: contratos, validación de argumentos y captura de errores de los nuevos canales H5P, registrados desde el proceso principal.
- `frontend/ipc/documentInspection.js` y `backend/inspectionWorker.js`: inspección en un worker y almacenamiento temporal del texto en memoria, aislado por ventana.
- `frontend/ipc/h5pGeneration.js` y `backend/h5pPackageWorker.js`: generación con Gemini, ensamblado H5P en un worker y guardado mediante diálogo nativo.
- `frontend/index.html`: estructura de la aplicación y carga de hojas de estilo y módulos de interfaz.
- `frontend/js/`: módulos del renderer. Los principales son `courses.js` (ramos, biblioteca, proyectos), `studio.js` (flujo de creación), `upload.js` (archivos), `config.js` (preferencias y clave API), `ui.js` (avisos y componentes compartidos), `search.js`, `preview.js` y `menu.js`.
- `frontend/css/`: estilos globales, del estudio y temas claro/oscuro.
- `backend/storage.js`: persistencia JSON de ramos, proyectos, borradores, papelera y configuración bajo `app.getPath('userData')` al correr en Electron; usa `../data/academic_store.json` como ruta fuera de Electron.
- `backend/chunker.js`: extracción y limpieza de texto desde documentos.
- `backend/prompts.js`: instrucciones pedagógicas versionadas y separación del material y directrices del docente para la petición Gemini. La explicación formativa se solicita y valida antes de exportarse al H5P.
- `backend/llmClient.js`: cliente de Google Generative AI para generar preguntas desde texto.
- `backend/gemini.js`: modelos ordenados, solicitudes a Gemini, clasificación de errores y verificación de clave. El empaquetado Linux incluye este módulo.
- `backend/h5pTemplates.js` y `backend/templates/`: catálogo declarativo de **12 plantillas estáticas H5P** en español (`multichoice`, `questionset`, `truefalse`, `blanks`, `dragtext`, `singlechoiceset`, `summary`, `sortparagraphs`, `crossword`, `findthewords`, `accordion`, `flashcards`), manifiesto `manifest.json` con verificación SHA-256 y compuerta `maxCoreApi <= 1.24`, y `libraries-bundle.zip` curado (36 bibliotecas activas, ~2.32 MB, sin medios de ejemplo). `scripts/sync-h5p-templates.cjs` regenera el bundle (solo desarrollo, excluido de `package-linux.cjs`). Ver `docs/adr/ADR-001-plantillas-estaticas-h5p.md`, `docs/adr/ADR-002-ampliacion-catalogo-plantillas-h5p.md` y `docs/H5P-15-estructura-plantillas.md`. La interfaz (`H5P-7`) y el worker exponen `H5P.QuestionSet` y `H5P.MultiChoice` de extremo a extremo; los otros 10 formatos muestran insignia de plantilla lista hasta completar `H5P-16`.

## Comandos

- Instalar dependencias: `cd backend && npm ci`; `cd frontend && npm ci`.
- Iniciar Electron: `cd frontend && npm start`.
- Empaquetar Linux: `npm run package:linux --prefix frontend` desde la raíz; produce `dist/h5p-generator-linux-<arquitectura>` con runtime, frontend y backend, sin ASAR. La lista explícita de archivos está en `scripts/package-linux.cjs`; mantenerla actualizada si se añaden módulos de producción.
- Integración empaquetada: `npm run test:packaged --prefix frontend`; requiere sesión gráfica Linux, usa una copia y perfil temporales, simula Gemini/diálogo y verifica IPC, workers, interfaz y sockets de escucha. Ver `docs/H5P-19-validacion.md` para alcance y límites.
- Pruebas existentes: `cd backend && npm test` (`node --test tests/`).
- `frontend/package.json` conserva un script `test` de marcador que termina con error porque todavía no hay suite del frontend.
- El README indica la instalación con los lockfiles y los comandos actuales.

## Detalles que conviene preservar

- La ventana de Electron debe seguir aislando el renderer (`contextIsolation: true`, `nodeIntegration: false`).
- El almacenamiento de la clave Gemini usa Electron `safeStorage` en Linux, Windows y macOS. En Linux rechaza el proveedor `basic_text`; en Windows y macOS utiliza la selección nativa de Electron. Las claves antiguas en Base64 se migran al leerlas cuando el almacenamiento seguro está disponible; si no lo está, se conservan sin modificar y se informa un error.
- Los datos locales y `.env` están excluidos por `.gitignore`. No añadas credenciales ni archivos de usuario al control de versiones.
- No hay un `package.json` en la raíz; ejecuta npm en el directorio correspondiente.
- La gestión de claves sigue el recorrido `frontend/js/config.js` → `frontend/preload.js` → `frontend/index.js` → `backend/storage.js`. La verificación remota usa el canal explícito `llm:verify-key` en el proceso principal.
- En sesiones Hyprland, el proceso principal selecciona `gnome-libsecret`; guardar claves requiere un llavero disponible.
- Los errores de lectura del almacén deben llegar a la interfaz y conservar el archivo existente, sin reemplazarlo por una biblioteca vacía.

## Límites funcionales

**Estado 2026-11-21:** el Paso 2 (`#panel-selector`, H5P-7) incluye tarjetas interactivas para elegir entre Cuestionario (`H5P.QuestionSet 1.17`, 1–20 preguntas con botones rápidos 3/5/10) y Opción Múltiple (`H5P.MultiChoice 1.14`, reactivo individual de 1 pregunta), más un bloque desplegable con los otros 10 formatos con plantilla lista en `H5P-15` (pendientes de generador IA en `H5P-16`). `activityType` y `questionCount` se conservan en sesión y en borradores locales (`backend/storage.js`). Queda pendiente validar Moodle (`H5P-17`) y la revisión/edición de preguntas antes de exportar (`H5P-30`).

### Contratos IPC H5P

**Estado 2026-11-21:** inspección, generación y guardado están conectados al panel. Los canales solo aceptan llamadas desde el marco principal local de la ventana. La validación ocurre en el proceso principal antes de invocar servicios. No se admiten propiedades adicionales ni rutas proporcionadas por el renderer.

- `inspectDocument({ name, bytes })` → `h5p:inspect-document`: nombre de archivo sin separadores de ruta, extensión admitida por `chunker.js` y `Uint8Array` no vacío de hasta 50 MiB.
- `releaseDocument(documentId)` → `h5p:release-document`: elimina un documento inspeccionado de la sesión de la ventana propietaria.
- `generateH5P({ documentIds, activityType, questionCount, instructions })` → `h5p:generate`: entre 1 y 20 UUID distintos de la ventana, `activityType` en `'questionset'` (alias `'question-set'` / `'multiple-choice'`, cantidad entera 1–20) o `'multichoice'` (cantidad entera estrictamente `1`), e instrucciones de hasta 10.000 caracteres. El texto conjunto no puede superar 200.000 caracteres. La clave se obtiene en el proceso principal y el texto y las instrucciones se envían a Gemini.
- `saveH5PFile({ packageId, suggestedName, courseId? })` → `h5p:save-file`: UUID del paquete de la ventana, nombre sugerido sin separadores de ruta de hasta 200 caracteres y ramo opcional. El destino lo determina el diálogo nativo. Tras guardar se intenta registrar el proyecto sin almacenar el texto ni las instrucciones.

Los errores devuelven `{ status: 'error', code, message }`: `INVALID_SENDER`, `INVALID_ARGUMENT`, `INTERNAL_ERROR` y, según el canal, `NOT_AVAILABLE`, `INSPECTION_FAILED`, `TEXT_TOO_LARGE`, `TIMEOUT`, `BUSY`, `LIMIT_REACHED`, `NOT_FOUND`, `DOCUMENT_NOT_FOUND`, `SOURCE_TOO_LARGE`, `MISSING_KEY`, `API_KEY_INVALID`, `API_ACCESS_DENIED`, `MODEL_UNAVAILABLE`, `QUOTA`, `INVALID_RESPONSE`, `GENERATION_FAILED`, `NETWORK_ERROR`, `SERVICE_UNAVAILABLE`, `API_REQUEST_FAILED`, `GENERATION_TIMEOUT`, `GENERATION_CANCELLED`, `PACKAGE_FAILED`, `UNSUPPORTED_TYPE`, `INVALID_COURSE` o `SAVE_FAILED`. Los mensajes son fijos y no incluyen excepciones, claves ni contenido del documento. No interpretar `NOT_AVAILABLE` como éxito. `verifyApiKey` valida el marco principal local y captura fallos de lectura de la clave. Devuelve `valid`, `invalid`, `denied`, `unavailable`, `quota`, `missing` o `error` y usa hasta 15 segundos compartidos entre los dos modelos.

La inspección devuelve `{ status: 'ok', documentId, name, size }` sin enviar el texto al renderer; la liberación devuelve `{ status: 'ok' }`. Se ejecuta un worker a la vez, con límite de 60 segundos, 20 documentos por ventana y 5 MiB de texto extraído por documento. El texto solo reside en memoria y se descarta al quitar el documento, navegar o cerrar la ventana. Al cambiar la selección durante la inspección, el renderer descarta y libera los resultados obsoletos. Los borradores siguen guardando solo metadatos y requieren seleccionar los archivos de nuevo.

La generación y la verificación usan `gemini-3.5-flash-lite` y prueban `gemini-3.8-flash` ante un 404, un 403 referido específicamente al modelo o un 503. La generación hace hasta tres solicitudes ante fallos transitorios, con esperas crecientes, un máximo de 45 segundos por solicitud, 90 segundos para toda la operación y la señal de cancelación de la ventana. Solicita `responseJsonSchema` con cantidad exacta de preguntas, cuatro opciones y una explicación formativa obligatoria. Una respuesta inválida puede producir una única regeneración correctiva dentro del mismo máximo global de tres solicitudes y 90 segundos. No reintenta cuota, autenticación ni bloqueos de contenido. No se registran cuerpos de error del proveedor. `INVALID_RESPONSE` puede incluir `reason` de una lista fija (`COUNT`, `OPTIONS`, `DUPLICATE_OPTIONS`, `CORRECT_ANSWER`, `FEEDBACK`, `JSON`, `STRUCTURE`, `QUESTION`, `INCOMPLETE`, `BLOCKED`, `EMPTY`, `TOO_LARGE`) y un mensaje fijo; nunca contiene preguntas ni respuestas del modelo.

La generación devuelve `{ status: 'ok', kind: 'package', packageId, questionCount }`. El guardado devuelve `{ status: 'ok', fileName, projectSaved }` o `{ status: 'cancelled' }`; `projectSaved: false` significa que el archivo se guardó pero falló el registro. El paquete y los UUID pertenecen a la ventana y se liberan al navegar o cerrarla. El cliente valida el JSON, cuatro opciones únicas, una respuesta correcta y una explicación no vacía de hasta 2000 caracteres antes de empaquetar. El worker escapa la explicación y la incorpora al `overallFeedback` de cada MultiChoice para todos los puntajes. El usuario confirmó en Lumi la visualización de un ejemplo sintético. La evaluación real detectó afirmaciones imprecisas pese a pasar la validación estructural; consultar `docs/H5P-14-validacion.md`.

## Mantenimiento de esta memoria

Conserva aquí arquitectura, comandos, restricciones y decisiones útiles para continuar el desarrollo. Contrasta estos datos con el código antes de actuar y actualízalos cuando cambie la implementación.

Consulta el tablero de trabajo para conocer estados, bloqueos y criterios pendientes de los issues. No copies aquí estados de sprint, resultados de sesiones particulares ni afirmaciones de validación que no se hayan confirmado. Fecha cualquier contexto temporal que sea necesario conservar y elimínalo cuando deje de ser vigente.

No incluyas claves, contenido privado de documentos, datos locales ni información de acceso.
