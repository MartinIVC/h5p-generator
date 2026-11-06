# Memoria del proyecto para agentes

## Arquitectura

- `frontend/index.js`: proceso principal de Electron, creación de ventana, diálogos, sistema de archivos y manejadores IPC. Importa `backend/storage.js`.
- `frontend/preload.js`: puente seguro de APIs permitidas usando `contextBridge` e `ipcRenderer.invoke`. Cada capacidad del renderer debe tener un método explícito aquí y un manejador correspondiente en el proceso principal.
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

## Mantenimiento de esta memoria

Conserva aquí arquitectura, comandos, restricciones y decisiones útiles para continuar el desarrollo. Contrasta estos datos con el código antes de actuar y actualízalos cuando cambie la implementación.

Consulta el tablero de trabajo para conocer estados, bloqueos y criterios pendientes de los issues. No copies aquí estados de sprint, resultados de sesiones particulares ni afirmaciones de validación que no se hayan confirmado. Fecha cualquier contexto temporal que sea necesario conservar y elimínalo cuando deje de ser vigente.

No incluyas claves, contenido privado de documentos, datos locales ni información de acceso.
