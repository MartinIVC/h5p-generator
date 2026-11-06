# Instrucciones para agentes

## Alcance y estructura

- Este repositorio es una aplicación de escritorio Electron. El proceso principal y la interfaz están en `frontend/`; lógica de almacenamiento, extracción de documentos y cliente LLM está en `backend/`.
- Consulta `MEMORY.md` para el mapa de módulos y los comandos actuales. Si estas instrucciones difieren de los scripts o del código vigente, prevalece el código.
- No edites archivos generados, `node_modules`, datos locales ni credenciales. `.gitignore` excluye datos locales y archivos `.env`.

## Seguridad y límites entre procesos

- Mantén `contextIsolation: true` y `nodeIntegration: false` en `BrowserWindow`.
- Expón funciones pequeñas y explícitas desde `frontend/preload.js` mediante `contextBridge`. No expongas `ipcRenderer`, `require`, acceso genérico a archivos ni APIs sin validar al renderer.
- Registra los canales IPC en `frontend/index.js` y valida argumentos en el proceso principal antes de invocar almacenamiento, sistema de archivos o servicios externos.
- Nunca escribas claves API, contenido privado de documentos ni otros secretos en logs, mensajes de error, copias de seguridad o datos visibles en el renderer.
- `backend/storage.js` usa `safeStorage` cuando Electron informa que el cifrado está disponible. Revisa el comportamiento de respaldo antes de cambiar el almacenamiento de credenciales; Base64 por sí solo no cifra datos.

## Cambios y verificación

- Sigue el estilo CommonJS existente y conserva las rutas relativas actuales entre `frontend/` y `backend/`.
- Para cambios de interfaz, comprueba estados vacíos, errores y navegación por teclado cuando sean pertinentes. La ventana tiene un tamaño mínimo de 840 × 600.
- Ejecuta las comprobaciones apropiadas para el cambio. La suite disponible está en `backend/tests/` y se ejecuta desde `backend/` con `npm test`.
- El script `test` de `frontend/package.json` es un marcador que falla; no lo presentes como una suite funcional.
- Instala dependencias usando los lockfiles: `npm ci` en `backend/` y `frontend/`. La aplicación se inicia desde `frontend/` con `npm start`.
- No afirmes que una función está completa solo porque exista una pantalla o un canal: verifica el recorrido entre renderer, preload, proceso principal y backend, además de los criterios de aceptación aplicables.

## Documentación

- Actualiza documentación cuando cambies comandos, arquitectura, canales IPC o comportamiento público.
- El `README.md` actual contiene pasos de instalación antiguos. Contrasta siempre sus instrucciones con los `package.json` y lockfiles antes de seguirlas o modificarlas.
- Usa `MEMORY.md` para decisiones, restricciones y contexto de implementaciones activas que ayuden a continuar el trabajo. Fecha los estados que puedan cambiar, verifica que sigan vigentes antes de actuar y elimina o actualiza los que ya se completaron.
