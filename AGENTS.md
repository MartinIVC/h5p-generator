# h5p-rag-generator

Aplicación de escritorio Electron para organizar ramos y proyectos y preparar material para actividades H5P.

## Comandos

- Instalar la aplicación: `cd frontend && npm ci`
- Iniciarla: `cd frontend && npm start`
- Instalar dependencias del backend: `cd backend && npm ci`
- Ejecutar las pruebas disponibles: `cd backend && npm test`

Los paquetes tienen manifiestos y archivos de bloqueo separados; ejecuta cada comando desde su directorio. `frontend/package.json` incluye una orden `test` provisional que termina con error; las pruebas automatizadas disponibles están en `backend/`.

## Estructura y convenciones

- `frontend/index.js` contiene el proceso principal de Electron; `frontend/preload.js` define el puente hacia la interfaz.
- La interfaz usa JavaScript sin framework, cargado desde `frontend/index.html`. Sigue el estilo de módulos y APIs globales que ya usan los archivos de `frontend/js/`.
- Mantén `contextIsolation: true` y `nodeIntegration: false`. Para exponer operaciones del sistema a la interfaz, añade una API específica en `preload.js` y un manejador IPC en `frontend/index.js`.
- `backend/storage.js` guarda datos locales y gestiona las copias de seguridad. Si cambias el formato almacenado, revisa la compatibilidad con los datos existentes y la importación y exportación de copias.

## Límites funcionales

- La generación y exportación de paquetes H5P todavía no están conectadas. `frontend/js/upload.js` muestra pasos pendientes; no presentes esas funciones como disponibles hasta implementar la integración.
- `backend/tests/chunker.test.js` es la referencia para las pruebas existentes, que usan `node:test`.

## Datos locales

- No incluyas credenciales ni datos locales en cambios versionados. `.gitignore` excluye archivos `.env`, `data/`, dependencias y directorios de distribución.
