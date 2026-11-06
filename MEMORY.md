# Memoria del proyecto para agentes

## Arquitectura

- `frontend/index.js`: proceso principal de Electron, creación de ventana, diálogos, sistema de archivos y manejadores IPC. Importa `backend/storage.js`.
- `frontend/preload.js`: puente seguro de APIs permitidas usando `contextBridge` e `ipcRenderer.invoke`. Cada capacidad del renderer debe tener un método explícito aquí y un manejador correspondiente en el proceso principal.
- `frontend/ipc/h5pHandlers.js`: contratos, validación de argumentos y captura de errores de los nuevos canales H5P, registrados desde el proceso principal.
- `frontend/index.html`: estructura de la aplicación y carga de hojas de estilo y módulos de interfaz.
- `frontend/js/`: módulos del renderer. Los principales son `courses.js` (ramos, biblioteca, proyectos), `studio.js` (flujo de creación), `upload.js` (archivos), `config.js` (preferencias y clave API), `ui.js` (avisos y componentes compartidos), `search.js`, `preview.js` y `menu.js`.
- `frontend/css/`: estilos globales, del estudio y temas claro/oscuro.
- `backend/storage.js`: persistencia JSON de ramos, proyectos, borradores, papelera y configuración bajo `app.getPath('userData')` al correr en Electron; usa `../data/academic_store.json` como ruta fuera de Electron.
- `backend/chunker.js`: extracción y limpieza de texto desde documentos.
- `backend/llmClient.js`: cliente de Google Generative AI para generar preguntas desde texto.

## Comandos

- Instalar dependencias: `cd backend && npm ci`; `cd frontend && npm ci`.
- Iniciar Electron: `cd frontend && npm start`.
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

**Verificados en el código el 2026-11-05.** La generación y exportación H5P todavía no están conectadas a la interfaz. `frontend/js/upload.js` informa esta limitación; la existencia de `backend/llmClient.js` no implica que el recorrido esté completo.

### Contratos IPC H5P

**Estado 2026-11-06:** los siguientes métodos están expuestos pero todavía no inspeccionan, generan ni guardan archivos. Solo aceptan llamadas desde el marco principal local de la ventana. La validación ocurre en el proceso principal antes de invocar servicios. No se admiten propiedades adicionales ni rutas proporcionadas por el renderer.

- `inspectDocument({ name, bytes })` → `h5p:inspect-document`: nombre de archivo sin separadores de ruta, extensión admitida por `chunker.js` y `Uint8Array` no vacío de hasta 50 MiB.
- `generateH5P({ documentIds, activityType, questionCount, instructions })` → `h5p:generate`: entre 1 y 20 UUID distintos, identificador de tipo en minúsculas con letras, dígitos y guiones (máximo 64 caracteres, comenzando por letra), cantidad entera de 1 a 100 e instrucciones de hasta 10.000 caracteres. Los identificadores y el tipo deben comprobarse además contra la sesión y los tipos realmente disponibles cuando se conecten los servicios.
- `saveH5PFile({ packageId, suggestedName })` → `h5p:save-file`: UUID del paquete y nombre sugerido sin separadores de ruta de hasta 200 caracteres. El paquete deberá pertenecer a la sesión al conectar el guardado.

Los tres devuelven actualmente `{ status: 'error', code, message }`: `INVALID_SENDER`, `INVALID_ARGUMENT`, `NOT_AVAILABLE` o `INTERNAL_ERROR`. Los mensajes son fijos y no incluyen excepciones, claves ni contenido del documento. No interpretar `NOT_AVAILABLE` como éxito. `verifyApiKey` conserva sus estados existentes y captura también fallos de lectura de la clave.

Para las integraciones posteriores, el contrato de resultado será: inspección `{ status: 'ok', documentId, name, size }`; generación `{ status: 'ok', kind: 'questions', questions }` o `{ status: 'ok', kind: 'package', packageId }`, según la etapa alcanzada; guardado `{ status: 'ok', fileName }` o `{ status: 'cancelled' }`. El esquema de `questions` debe acordarse con H5P-14. Los UUID deben ser opacos y estar asociados a la ventana que los obtuvo; el guardado debe comprobar la propiedad del paquete antes de mostrar el diálogo.

## Mantenimiento de esta memoria

Conserva aquí arquitectura, comandos, restricciones y decisiones útiles para continuar el desarrollo. Contrasta estos datos con el código antes de actuar y actualízalos cuando cambie la implementación.

Consulta el tablero de trabajo para conocer estados, bloqueos y criterios pendientes de los issues. No copies aquí estados de sprint, resultados de sesiones particulares ni afirmaciones de validación que no se hayan confirmado. Fecha cualquier contexto temporal que sea necesario conservar y elimínalo cuando deje de ser vigente.

No incluyas claves, contenido privado de documentos, datos locales ni información de acceso.
