# ADR-003: Motor de inyección y empaquetado H5P en memoria sobre `jszip` con escritura atómica (`H5P-16`)

- **Estado:** Aceptado
- **Fecha:** 2026-11-21
- **Ticket origen:** [H5P-16 — Programar inyección de content.json y compresión a .h5p](https://h5p-rag-generator.atlassian.net/browse/H5P-16)
- **Relacionado con:** [ADR-001 — Arquitectura de plantillas estáticas H5P](ADR-001-plantillas-estaticas-h5p.md), [ADR-002 — Ampliación del catálogo a 12 formatos](ADR-002-ampliacion-catalogo-plantillas-h5p.md)
- **Tickets impactados:** `H5P-16`, `H5P-17`, `H5P-22`, `H5P-30`, `H5P-9`

---

## 1. Contexto

El ticket `H5P-16` se redactó inicialmente especificando:
- CA-1: mapear el arreglo de preguntas validadas a `content/content.json`.
- CA-2: usar la librería `archiver` en Node.js para empaquetar `h5p.json` y `content/`.
- CA-3: generar el archivo `.h5p` sin archivos residuales ni daños en el encabezado ZIP.
- CA-4: limpiar automáticamente directorios o archivos temporales de trabajo tras finalizar la compresión (`fs.promises.rm`).
- Checklist técnica: crear `backend/h5pBuilder.js` y `backend/h5pPacker.js`.

Sin embargo, durante la implementación previa de `H5P-14` y `H5P-15` ([ADR-001](ADR-001-plantillas-estaticas-h5p.md) y [ADR-002](ADR-002-ampliacion-catalogo-plantillas-h5p.md)), el proyecto consolidó **`jszip@3.10.1`** como biblioteca ZIP del backend (`backend/package.json`) para leer `backend/templates/libraries-bundle.zip`, resolver la clausura exacta de bibliotecas en memoria (`createBasePackageZip`) y validar paquetes `.h5p` completos (`validateH5PPackage`) sin extraer bibliotecas ni apuntes del docente al sistema de archivos temporal.

Adicionalmente, `H5P-15` dejó 12 plantillas listas en español (`coreApi <= 1.24`) y `H5P-7` mostró los 10 formatos adicionales como pendientes de `H5P-16`.

---

## 2. Opciones evaluadas

### Opción A — Instalar `archiver` y construir el paquete en disco temporal
- **Pros:** cumple literalmente la mención histórica de `archiver` en CA-2.
- **Contras:** duplica librerías ZIP en `backend/package.json` (`jszip` sigue siendo indispensable para leer `libraries-bundle.zip` y validar paquetes), requiere extraer hasta 15 carpetas de bibliotecas y escribir `content.json` con contenido derivado de apuntes privados en `/tmp` en cada generación, incrementa la latencia de I/O y deja riesgo de residuos en disco si el proceso termina abruptamente (`SIGKILL`).

### Opción B (Elegida) — Consolidar `jszip@3.10.1` en memoria + validación automática + escritura atómica con `fs.promises.rm`
- **Pros:**
  - Cero dependencias nuevas; mantiene `jszip@3.10.1` como motor único de lectura, compresión y validación.
  - La inyección (`backend/h5pBuilder.js`) y la compresión en buffer (`backend/h5pPacker.js`) operan 100 % en memoria dentro del worker aislado (`backend/h5pPackageWorker.js`), sin exponer material académico en `/tmp`.
  - `packH5PFromPrepared` / `packH5PPackage` ejecutan automáticamente `validateH5PPackage(bytes)` antes de devolver el buffer `.h5p`, garantizando CA-3 (encabezado ZIP válido, clausura exacta de dependencias, `content.json` válido y cero archivos residuales).
  - La persistencia en disco (`writeH5PFile` y `packH5PToFile` en `backend/h5pPacker.js`, reutilizada por `frontend/ipc/h5pGeneration.js`) crea un directorio temporal exclusivo junto al destino (`.h5p-work-<uuid>`), escribe el paquete con permisos `0o600`, renombra atómicamente al archivo `.h5p` final y garantiza limpieza en un bloque `finally` con `fs.promises.rm(tempDir, { recursive: true, force: true })` (CA-4), incluso ante cancelaciones o errores de escritura.

---

## 3. Decisiones adoptadas

1. **Separación modular en `backend/h5pBuilder.js` y `backend/h5pPacker.js`:**
   - `backend/h5pBuilder.js` implementa mapeadores puros y validados para los **12 formatos** registrados en `backend/templates/manifest.json`, aceptando título opcional (`h5p.json`) y opciones seguras de comportamiento (preparado para `H5P-30`).
   - `backend/h5pPacker.js` encapsula compresión `DEFLATE` nivel 6 sobre `jszip`, validación post-compresión vía `validateH5PPackage` y escritura atómica a disco con limpieza garantizada mediante `fs.promises.rm`.
   - `backend/h5pPackageWorker.js` delega completamente en `h5pPacker.js`.
2. **Habilitación integral de los 12 formatos:**
   - `backend/prompts.js` conserva `PROMPT_VERSION = 'h5p-14-v4'` y `buildQuestionPrompt` por retrocompatibilidad, añadiendo `ACTIVITY_PROMPT_VERSION = 'h5p-16-v1'`, `ACTIVITY_SPECS` y prompts didácticos para los 12 tipos.
   - `backend/llmClient.js` extiende la generación con `responseJsonSchema` y validación local por formato manteniendo la firma de `generateQuestionsFromChunk` y las reglas de reintento, cancelación y privacidad.
   - `frontend/ipc/h5pHandlers.js` añade soporte para el campo opcional `title` (hasta 180 caracteres, sin caracteres de control) en `h5p:generate`, reflejado en `h5p.json`.
   - `frontend/js/upload.js` activa los 12 formatos organizados con filtros por categoría (`Todos`, `Evaluación`, `Práctica`, `Estudio`) en `#panel-selector`.

---

## 4. Consecuencias

- **Positivas:** arquitectura coherente entre `H5P-14`, `H5P-15`, `H5P-7` y `H5P-16`, sin dependencias redundantes, con garantía verificable de integridad ZIP y limpieza de temporales, y API reutilizable para `H5P-17`, `H5P-22` y `H5P-30`.
- **Compromisos:** el ticket `H5P-16` en Jira deberá incluir una nota trazable indicando que CA-2 se resolvió consolidando `jszip@3.10.1` en lugar de añadir `archiver`, conforme a este ADR.
- **Empaquetado Linux:** `scripts/package-linux.cjs` debe incluir explícitamente `h5pBuilder.js` y `h5pPacker.js` en la lista de producción del backend.
