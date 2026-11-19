# ADR-001: Arquitectura de plantillas estáticas H5P y estrategia de versionado (`H5P-15`)

- **Estado:** Aceptado
- **Fecha:** 2026-11-19
- **Ticket origen:** [H5P-15 — Preparar plantillas base estáticas de H5P](https://h5p-rag-generator.atlassian.net/browse/H5P-15) (Epic [H5P-4](https://h5p-rag-generator.atlassian.net/browse/H5P-4))
- **Tickets impactados:** `H5P-15`, `H5P-16`, `H5P-17`, `H5P-7`, `H5P-29`
- **Precedente en el proyecto:** Decisión de alineación de CA-4 en [H5P-14-plan-implementacion.md](../H5P-14-plan-implementacion.md)

---

## 1. Contexto y problema

El ticket `H5P-15` establece como objetivo contar con plantillas base estáticas en `backend/templates/` para generar paquetes `.h5p` conformes a la especificación oficial de H5P Group:

- **CA-1:** Plantilla base `h5p.json` para `H5P.MultiChoice 1.14` declarando versión mayor, menor y dependencias necesarias.
- **CA-2:** Plantilla base `h5p.json` para `H5P.QuestionSet 1.20` con dependencias requeridas (`H5P.JoubelUI`, `FontAwesome`, etc.).
- **CA-3:** Estructura de carpetas requerida (`content/`, `h5p.json`) documentada y validada contra la especificación oficial de H5P.

La auditoría del repositorio vigente (incorporado en `H5P-19` y `H5P-14`) identificó tres tensiones técnicas que requieren una decisión explícita:

1. **Dependencia de un paquete de ejemplo opaco con artefactos no utilizados:**
   - El archivo heredado `backend/templates/question-set-616.h5p` pesaba **3,135,205 bytes (3.13 MB)** e incluía **1,864 KB** descomprimidos de imágenes de ejemplo en `content/images/` y **9 carpetas de bibliotecas no utilizadas** (**1,263 KB** descomprimidos: `H5P.DragQuestion-1.13`, `jQuery.ui-1.10`, `H5P.DragNBar-1.5`, `H5PEditor.DragQuestion-1.10`, `H5P.Image-1.1`, `H5PEditor.Wizard-1.2`, `H5P.DragNResize-1.2`, `H5P.DragNDrop-1.1`, `H5P.AdvancedText-1.1`).
   - `backend/h5pPackageWorker.js` mutaba el `h5p.json` y el `content/content.json` internos en caliente, dejando las 9 bibliotecas muertas y sus entradas (`H5P.DragQuestion 1.13`, `jQuery.ui 1.10`, `H5P.Image 1.1`) dentro de cada `.h5p` exportado.
   - El `h5p.json` heredado declaraba `majorVersion` y `minorVersion` como cadenas (`"1"`, `"14"`) en lugar de enteros JSON (`1`, `14`), carecía de etiquetas `a11y*` y conservaba diálogos `confirmCheck`/`confirmRetry` en inglés.
   - No existía plantilla estática para `H5P.MultiChoice 1.14` independiente (CA-1).

2. **Conflicto de versiones entre CA-1 (`H5P.MultiChoice 1.14`), CA-2 (`H5P.QuestionSet 1.20`) y compatibilidad `coreApi` de Moodle 4.x:**
   - Las bibliotecas existentes y ya validadas en Lumi Desktop pertenecen a la familia coherente **`H5P.MultiChoice 1.14.7` + `H5P.QuestionSet 1.17.6`**:
     - `H5P.QuestionSet-1.17/semantics.json` lista exactamente `H5P.MultiChoice 1.14` como sub-biblioteca permitida.
     - Su `coreApi` máximo de ejecución es `1.19` (y en bibliotecas de editor: `1.14` para MultiChoice y `1.24` para `H5PEditor.VerticalTabs-1.3` / `H5PEditor.QuestionSetTextualEditor-1.3`), totalmente compatible con **Moodle 4.1 (`h5plib_v124`), 4.3/4.4 (`1.26`), 4.5+ (`1.27`) y Lumi Desktop**.
   - Por el contrario, `H5P.QuestionSet 1.20` (p. ej. `1.20.29`):
     - Declara `coreApi: 1.26` y `H5P.Video 1.6`, generando riesgo de rechazo `api-version-unsupported` en instalaciones Moodle 4.1–4.3 que operan con `h5plib_v124`.
     - En su `semantics.json` espera `H5P.MultiChoice 1.16` (no `1.14`), rompiendo la coherencia directa con CA-1 y obligando a duplicar bibliotecas o alterar CA-1.
   - Un `h5p.json` no puede declarar `H5P.QuestionSet 1.20` si el paquete empaqueta `H5P.QuestionSet-1.17/`: Lumi y Moodle rechazan la importación con `Missing required library`.

3. **Autocontención obligatoria para Lumi y Moodle sin permisos de administrador:**
   - Paquetes de solo metadatos (`h5p.json` + `content/content.json` sin carpetas de biblioteca) fallan en entornos offline o en Moodle cuando el docente no tiene permisos para instalar tipos de contenido desde H5P Hub. La suite existente (`backend/tests/generation.test.js`) exige la clausura transitiva completa dentro del `.h5p`.

---

## 2. Decisiones adoptadas

### Decisión 1: Plantillas JSON declarativas separadas + bundle ZIP curado único de bibliotecas (Opción 1D)

Se adopta la separación explícita dentro de `backend/templates/`:
- **Plantillas en texto plano por tipo de actividad** (`multichoice/h5p.json`, `multichoice/content/content.json`, `questionset/h5p.json`, `questionset/content/content.json`), 100 % auditables en Git y completamente localizadas al español (incluyendo etiquetas `a11y*`, `confirmCheck` y `confirmRetry`).
- **Bundle curado único `backend/templates/libraries-bundle.zip`** (964,276 bytes; reducción de **69.2 %** frente a los 3.13 MB originales) conteniendo **exclusivamente las 17 bibliotecas activas**, sin `content/images/` ni las 9 bibliotecas huérfanas de `DragQuestion`/`jQuery.ui`/`H5P.Image`.
- **Manifiesto declarativo `backend/templates/manifest.json`** con registro de tipos, versiones, `coreApi`, licencias y huella `sha256` verificada automáticamente en pruebas.
- Se descartan: (1A) solo metadatos por incompatibilidad con Moodle sin permisos Hub / Lumi offline; (1B) conservar `question-set-616.h5p` por arrastre de basura y falta de `MultiChoice` standalone; (1C) descomprimir cientos de archivos de terceros directamente en Git por ruido en historial, búsquedas y empaquetado Linux.

### Decisión 2: Arquitectura *data-driven* con familia inicial coherente `H5P.MultiChoice 1.14` + `H5P.QuestionSet 1.17` (Opción 2A)

- El cargador y validador `backend/h5pTemplates.js` opera de forma **100 % declarativa (*data-driven*)** a partir de `manifest.json` y de cada `h5p.json`, sin acoplar el código a una versión fija (`1.17` ni `1.20`).
- Como conjunto inicial se adopta **`H5P.MultiChoice 1.14.7` (CA-1 exacto) + `H5P.QuestionSet 1.17.6`** (familia de `coreApi` runtime `1.19` y editor máximo `1.24`), garantizando:
  - Compatibilidad con toda la línea Moodle 4.1–4.5+ y Lumi Desktop.
  - Coherencia exacta con `H5P.QuestionSet-1.17/semantics.json` (`H5P.MultiChoice 1.14`).
  - Reutilización sin duplicación de las 12 bibliotecas base de `MultiChoice 1.14` dentro de las 17 de `QuestionSet 1.17`.
- Esta decisión implica alinear el texto de CA-2 en Jira (`H5P.QuestionSet 1.17` en lugar de `1.20`), siguiendo el mismo criterio transparente aplicado al CA-4 de `H5P-14`. Cuando `H5P-17` verifique el `coreApi` efectivo del Moodle universitario, una eventual migración a `QuestionSet 1.20` + `MultiChoice 1.16` será un reemplazo declarativo de activos sin cambiar el código de carga ni validación.

### Decisión 3: Conformidad estricta con la especificación oficial de H5P Group y contrato estable hacia `H5P-16`

- `majorVersion` y `minorVersion` en `h5p.json` se emiten y validan estrictamente como **enteros no negativos** (`Number.isInteger`).
- `embedTypes` se normaliza a `["iframe"]`, coincidiendo con `H5P.MultiChoice-1.14/library.json` y `H5P.QuestionSet-1.17/library.json` y aislando estilos respecto de temas de Moodle.
- `preloadedDependencies` declara únicamente la clausura mínima de ejecución (9 entradas para `multichoice`, 12 para `questionset`), y cada paquete ZIP generado contiene exactamente la clausura transitiva completa (`preloaded + editor + dynamic`: 12 carpetas para `multichoice`, 17 para `questionset`), con cero bibliotecas huérfanas.
- `backend/h5pTemplates.js` expone `TEMPLATE_TYPES`, `loadTemplate`, `validateH5PMetadata`, `resolveLibraryClosure`, `createBasePackageZip` y `validateH5PPackage`, integrándose de inmediato en `backend/h5pPackageWorker.js` sin alterar el contrato IPC ni adelantar el alcance de `H5P-16` (`h5pBuilder`/`h5pPacker`) ni de `H5P-7` (selector en UI).

---

## 3. Consecuencias

### Positivas
- Paquetes `.h5p` más livianos y estrictamente conformes a la especificación oficial de H5P Group.
- Reducción de 2.17 MB en el repositorio y en la distribución Linux (`dist/h5p-generator-linux-<arch>`).
- Plantillas de `MultiChoice` y `QuestionSet` listas, validadas automáticamente y desacopladas del empaquetador de `H5P-16`.

### Compromisos y riesgos mitigados
- **Divergencia nominal con CA-2 original en Jira (`1.17` vs `1.20`):** documentada aquí y trazable para actualizar CA-2 en Jira con autorización del equipo.
- **Dependencia de `H5P.Video 1.5` y `flowplayer 1.0` en `QuestionSet`:** exigidas por `H5P.QuestionSet-1.17/library.json` en `preloadedDependencies`; conservarlas es obligatorio para superar la validación de H5P Core.
- **Lista explícita de empaquetado Linux:** `scripts/package-linux.cjs` debe incluir `h5pTemplates.js`, lo cual se verifica con `npm run package:linux --prefix frontend` y `npm run test:packaged --prefix frontend`.

---

## 4. Criterios de revisión

Esta decisión se revisará si:
1. En `H5P-17` el Moodle universitario requiere `H5P.QuestionSet 1.20` (confirmando soporte `coreApi >= 1.26`).
2. Se agregan nuevos tipos de actividad H5P (`TrueFalse`, `Blanks`, `Flashcards`, etc.) cuyas bibliotecas requieran un `coreApi` superior.
