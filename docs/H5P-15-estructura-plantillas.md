# H5P-15 — Estructura de paquetes y plantillas estáticas H5P

- **Fecha:** 2026-11-19
- **Ticket Jira:** [H5P-15 — Preparar plantillas base estáticas de H5P](https://h5p-rag-generator.atlassian.net/browse/H5P-15)
- **ADRs asociados:** [ADR-001](adr/ADR-001-plantillas-estaticas-h5p.md) y [ADR-002](adr/ADR-002-ampliacion-catalogo-plantillas-h5p.md)
- **Módulos involucrados:** `backend/templates/`, `backend/h5pTemplates.js`, `backend/h5pPackageWorker.js`, `scripts/package-linux.cjs`, `scripts/sync-h5p-templates.cjs` (solo desarrollo)

---

## 1. Especificación oficial de estructura de un paquete `.h5p` (CA-3)

Según la especificación oficial de H5P Group (`h5p-php-library` en Moodle y `h5p-nodejs-library` en Lumi Desktop), un archivo `.h5p` es un contenedor ZIP estándar con la siguiente jerarquía obligatoria en su raíz:

```text
actividad.h5p (ZIP DEFLATE)
├── h5p.json                                 # Metadatos del paquete y dependencias de ejecución
├── content/
│   └── content.json                         # Parámetros de la actividad conforme al semantics.json de mainLibrary
└── <machineName>-<major>.<minor>/           # Una carpeta por cada biblioteca de la clausura transitiva
    ├── library.json                         # Metadatos, versión, coreApi, licencia y dependencias de la biblioteca
    ├── semantics.json                       # (si aplica) Esquema de parámetros del tipo de contenido
    └── ...                                  # JS, CSS, fuentes y traducciones declarados en library.json
```

### Reglas de conformidad verificadas por `backend/h5pTemplates.js`

- Sin rutas absolutas, segmentos `..`, `__MACOSX/`, `.DS_Store` ni archivos residuales.
- `h5p.json` con `title`, `language`, `mainLibrary`, `embedTypes` (`["iframe"]`), `license` y `preloadedDependencies` sin duplicados usando **enteros JSON no negativos** para `majorVersion` y `minorVersion`.
- Coincidencia exacta entre `preloadedDependencies` de `h5p.json` y la clausura transitiva de ejecución (ni dependencias faltantes ni dependencias sobrantes).
- Existencia de todas las dependencias (`preloadedDependencies`, `editorDependencies`, `dynamicDependencies`) de cada `library.json` dentro del ZIP y ausencia total de bibliotecas huérfanas.
- Compuerta `maxCoreApi: "1.24"` aplicada a todas las bibliotecas del bundle para asegurar compatibilidad con Moodle 4.1–4.5+ y Lumi Desktop.

---

## 2. Catálogo de plantillas declarativas en `backend/templates/` (12 formatos)

```text
backend/templates/
├── manifest.json                   # Registro de los 12 formatos, maxCoreApi, SHA-256 e inventario de 36 bibliotecas
├── libraries-bundle.zip            # 36 bibliotecas activas curadas (2.32 MB; 0 imágenes de ejemplo)
├── README.md                       # Guía de mantenimiento, procedencia y licencias
├── multichoice/                    # H5P.MultiChoice 1.14
├── questionset/                    # H5P.QuestionSet 1.17 (+ H5P.MultiChoice 1.14)
├── truefalse/                      # H5P.TrueFalse 1.8
├── blanks/                         # H5P.Blanks 1.14
├── dragtext/                       # H5P.DragText 1.10
├── singlechoiceset/                # H5P.SingleChoiceSet 1.11
├── summary/                        # H5P.Summary 1.10
├── sortparagraphs/                 # H5P.SortParagraphs 0.11
├── crossword/                      # H5P.Crossword 0.5
├── findthewords/                   # H5P.FindTheWords 1.4
├── accordion/                      # H5P.Accordion 1.0 (+ H5P.AdvancedText 1.1)
└── flashcards/                     # H5P.Flashcards 1.7
```

Cada carpeta de formato contiene `h5p.json` y `content/content.json` localizados íntegramente al español (incluidos textos de accesibilidad `a11y*` y diálogos de confirmación).

| Clave | `mainLibrary` | Versión | `coreApi` (runtime / editor) | `preloaded` / total ZIP | Campos clave de `content/content.json` |
| --- | --- | --- | --- | --- | --- |
| `multichoice` | `H5P.MultiChoice` | `1.14.7` | `1.19` / `1.14` | `7` / `10` | `question`, `answers[]`, `overallFeedback`, `UI`, `behaviour`, `confirmCheck`, `confirmRetry` |
| `questionset` | `H5P.QuestionSet` | `1.17.6` | `1.19` / `1.24` | `10` / `15` | `questions[]` (`H5P.MultiChoice 1.14`), `introPage`, `texts`, `endGame`, `override` |
| `truefalse` | `H5P.TrueFalse` | `1.8.11` | `1.19` / `1.12` | `6` / `8` | `question`, `correct` (`"true"`/`"false"`), `l10n`, `behaviour` (`feedbackOnCorrect`/`feedbackOnWrong`) |
| `blanks` | `H5P.Blanks` | `1.14.13` | `1.19` / `1.14` | `7` / `10` | `text`, `questions[]` (marcadores `*respuesta*`), `overallFeedback`, `behaviour`, `a11y*` |
| `dragtext` | `H5P.DragText` | `1.10.17` | `1.19` / `1.14` | `7` / `10` | `taskDescription`, `textField` (marcadores `*palabra*`), `distractors`, `overallFeedback`, `behaviour` |
| `singlechoiceset` | `H5P.SingleChoiceSet` | `1.11.44` | `1.19` / `1.24` | `6` / `11` | `choices[]` (`question`, `answers[]` con correcta primero), `overallFeedback`, `behaviour`, `l10n` |
| `summary` | `H5P.Summary` | `1.10.22` | `1.19` / `1.24` | `6` / `9` | `intro`, `summaries[]` (`summary[]` con afirmación correcta primero), `overallFeedback` |
| `sortparagraphs` | `H5P.SortParagraphs` | `0.11.9` | `1.7` / `1.14` | `6` / `9` | `taskDescription`, `paragraphs[]` (en orden correcto), `overallFeedback`, `behaviour`, `l10n`, `a11y` |
| `crossword` | `H5P.Crossword` | `0.5.13` | `1.19` / `1.24` | `8` / `13` | `taskDescription`, `words[]` (`clue`, `answer`), `theme`, `behaviour`, `l10n`, `a11y` |
| `findthewords` | `H5P.FindTheWords` | `1.4.4` | `1.3` / — | `6` / `6` | `taskDescription`, `wordList` (palabras separadas por coma), `behaviour`, `l10n` |
| `accordion` | `H5P.Accordion` | `1.0.33` | `1.5` / — | `3` / `3` | `panels[]` (`title`, `content` con `H5P.AdvancedText 1.1`), `hTag` |
| `flashcards` | `H5P.Flashcards` | `1.7.10` | `1.4` / `1.24` | `5` / `6` | `description`, `cards[]` (`text`, `answer`, `tip` opcional, imagen opcional), textos y accesibilidad |

---

## 3. Contrato de `backend/h5pTemplates.js`

- `TEMPLATE_TYPES`: objeto congelado con las 12 claves canónicas.
- `loadManifest(templatesDir?)`: lee y valida `backend/templates/manifest.json`.
- `listTemplates({ templatesDir }?)`: devuelve el catálogo de los 12 formatos con etiqueta, categoría (`evaluation`, `practice`, `study`), `mainLibraryKey`, versión y `coreApi`.
- `loadTemplate(templateType, options?)`: carga, valida y clona (`structuredClone`) `h5p.json` y `content/content.json`.
- `validateH5PMetadata(metadata)`: valida el esquema de `h5p.json` con versiones enteras.
- `resolveLibraryClosure(templateType, { includeEditor })`: verifica SHA-256 + `maxCoreApi <= 1.24` de `libraries-bundle.zip` y devuelve la clausura transitiva exacta.
- `createBasePackageZip(templateType)`: entrega un `JSZip` limpio con únicamente las bibliotecas del formato solicitado (`3` a `15` carpetas), sin `content/` ni bibliotecas ajenas.
- `validateH5PPackage(buffer)`: valida un `.h5p` completo (ZIP, rutas seguras, `h5p.json`, `content/content.json` por `mainLibrary`, sub-bibliotecas embebidas, clausura transitiva y ausencia de bibliotecas huérfanas o dependencias sobrantes).

---

## 4. Estado de verificación

### Verificación automatizada (2026-11-19)

- `npm test --prefix backend`: **59/59 pruebas aprobadas**, incluyendo validación integral de los 12 formatos, clausuras exactas, coexistencia de `H5P.Question 1.4/1.5`, compuerta `maxCoreApi <= 1.24`, verificación SHA-256 y ensamblado + validación de **12 paquetes `.h5p` sintéticos** (uno por formato).
- `npm run package:linux --prefix frontend -- h5p-generator-linux-x64-h5p15-multiformat`: empaquetado Linux con `h5pTemplates.js` y el catálogo completo de 12 plantillas.
- `npm run test:packaged --prefix frontend -- h5p-generator-linux-x64-h5p15-multiformat`: recorrido end-to-end aprobado en el ejecutable empaquetado.

### Verificación manual en Lumi Desktop y alcance siguiente

- Se generaron 12 paquetes `.h5p` sintéticos validados fuera del proyecto para comprobación visual directa en Lumi Desktop.
- La conexión de los formatos al selector del Paso 2 corresponde a `H5P-7`, el empaquetador/prompts multi-formato a `H5P-16` y la validación en Moodle 4.x a `H5P-17`.
