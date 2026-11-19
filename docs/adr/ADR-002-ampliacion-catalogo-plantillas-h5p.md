# ADR-002: Ampliación del catálogo de plantillas estáticas H5P a 12 formatos (`H5P-15`)

- **Estado:** Aceptado
- **Fecha:** 2026-11-19
- **Ticket origen:** [H5P-15 — Preparar plantillas base estáticas de H5P](https://h5p-rag-generator.atlassian.net/browse/H5P-15)
- **Relacionado con:** [ADR-001 — Arquitectura de plantillas estáticas H5P y estrategia de versionado](ADR-001-plantillas-estaticas-h5p.md)
- **Tickets impactados:** `H5P-15`, `H5P-16`, `H5P-7`, `H5P-17`, `H5P-29`

---

## 1. Contexto

Tras establecer la arquitectura declarativa de [ADR-001](ADR-001-plantillas-estaticas-h5p.md) con los dos formatos iniciales (`H5P.MultiChoice 1.14` y `H5P.QuestionSet 1.17`), se decidió ampliar el catálogo de plantillas estáticas de `H5P-15` para incorporar la mayor cantidad viable de formatos H5P orientados a apuntes académicos de texto, preservando:

1. **Compatibilidad con Moodle 4.1–4.5+ y Lumi Desktop (`coreApi <= 1.24`)** tanto en bibliotecas de ejecución como de editor.
2. **Generabilidad 100 % textual** desde documentos académicos (sin exigir imágenes, audio, video ni coordenadas gráficas).
3. **Separación de responsabilidades con `H5P-7` y `H5P-16`:** esta ampliación entrega únicamente la capa de plantillas, bibliotecas curadas, validadores y documentación.

---

## 2. Auditoría del catálogo oficial de H5P Hub (53 tipos)

Se consultó el catálogo oficial en `https://api.h5p.org/v1/content-types/` (53 tipos publicados) y se inspeccionó en memoria la clausura completa de `library.json` y `semantics.json` de todos los candidatos textuales.

### Formatos incorporados (12 en total: 2 existentes + 10 nuevos)

| Clave | Biblioteca | Versión | `coreApi` (runtime / editor) | Categoría | Licencia principal |
| --- | --- | --- | --- | --- | --- |
| `multichoice` | `H5P.MultiChoice` | `1.14.7` | `1.19` / `1.14` | Evaluación | MIT |
| `questionset` | `H5P.QuestionSet` | `1.17.6` | `1.19` / `1.24` | Evaluación | MIT |
| `truefalse` | `H5P.TrueFalse` | `1.8.11` | `1.19` / `1.12` | Evaluación | MIT |
| `blanks` | `H5P.Blanks` | `1.14.13` | `1.19` / `1.14` | Práctica | MIT (+ `pd`) |
| `dragtext` | `H5P.DragText` | `1.10.17` | `1.19` / `1.14` | Práctica | MIT |
| `singlechoiceset` | `H5P.SingleChoiceSet` | `1.11.44` | `1.19` / `1.24` | Evaluación | MIT |
| `summary` | `H5P.Summary` | `1.10.22` | `1.19` / `1.24` | Práctica | MIT |
| `sortparagraphs` | `H5P.SortParagraphs` | `0.11.9` | `1.7` / `1.14` | Práctica | MIT |
| `crossword` | `H5P.Crossword` | `0.5.13` | `1.19` / `1.24` | Práctica | MIT (+ `GPL3` en `H5P.MaterialDesignIcons-1.0`) |
| `findthewords` | `H5P.FindTheWords` | `1.4.4` | `1.3` / — | Práctica | MIT (+ `pd`) |
| `accordion` | `H5P.Accordion` | `1.0.33` | `1.5` / — | Estudio | MIT (+ `H5P.AdvancedText 1.1`) |
| `flashcards` | `H5P.Flashcards` | `1.7.10` | `1.4` / `1.24` | Estudio | MIT (imagen `optional: true`) |

### Formatos excluidos justificadamente

- **Incompatibles con `coreApi <= 1.24` en el Hub actual:** `H5P.Dialogcards 1.9.18` (`1.26`), `H5P.QuestionSet 1.20.31` (`1.26`), `H5P.BranchingScenario 1.8.14` (`1.26`), `H5P.MultiChoice 1.16.14` (`1.27`), `H5P.MarkTheWords 1.11.9` (`1.27`), `H5P.Essay 1.5.13` (`1.27`), `H5P.Column 1.18.8` (`1.27`), `H5P.CoursePresentation 1.26.3` (`1.27`), `H5P.InteractiveBook 1.11.11` (`1.27`), `H5P.StructureStrip 1.0.6` (`1.27`).
- **Dependientes de multimedia / coordenadas / no textuales:** `H5P.DragQuestion`, `H5P.Image*`, `H5P.MemoryGame`, `H5P.GuessTheAnswer`, `H5P.Audio*`, `H5P.SpeakTheWords*`, `H5P.InteractiveVideo`, `H5P.ThreeImage`, `H5P.ARScavenger`, `H5P.Collage`.
- **Fuera de foco pedagógico o licencia `MPL2`:** `H5P.ArithmeticQuiz`, `H5P.IFrameEmbed`, `H5P.KewArCode`, `H5P.Chart`, `H5P.Timeline` (`MPL2`), `H5P.Questionnaire`, `H5P.PersonalityQuiz`, `H5P.AdventCalendar`, `H5P.Cornell`, `H5P.DocumentationTool`, `H5P.InfoWall`, `H5P.Dictation`.

---

## 3. Decisiones adoptadas

1. **Bundle deduplicado único de 36 bibliotecas activas (`2.32 MB`, SHA-256 verificado):**
   - `backend/templates/libraries-bundle.zip` consolida las 36 bibliotecas necesarias para los 12 formatos (**2,432,446 bytes**, aún 22.4 % menor que el único paquete legado `question-set-616.h5p` de 3.13 MB).
   - La generación es determinista y reproducible mediante `scripts/sync-h5p-templates.cjs` (script solo de desarrollo, excluido del ejecutable Linux en `scripts/package-linux.cjs`).
   - Tanto el script de sincronización como `backend/h5pTemplates.js` aplican una compuerta automática `maxCoreApi: "1.24"`.

2. **Unificación de parches compartidos y coexistencia multi-versión:**
   - Las bibliotecas compartidas con mismo `major.minor` se consolidan en su parche oficial más reciente compatible con `coreApi <= 1.24`: `H5P.JoubelUI 1.3.19` (elimina `Drop 1.0` y `Tether 1.0`), `H5PEditor.RangeList 1.0.13`, `H5PEditor.ShowWhen 1.0.9` y `H5PEditor.VerticalTabs 1.3.14`.
   - `H5P.Question-1.4` (`1.4.8`, usada por `MultiChoice 1.14` y `QuestionSet 1.17`) y `H5P.Question-1.5` (`1.5.15`, usada por `TrueFalse`, `Blanks`, `DragText`, `SingleChoiceSet`, `Summary`, `SortParagraphs` y `Crossword`) coexisten sin colisión en `libraries-bundle.zip`; `createBasePackageZip(type)` extrae únicamente la clausura exacta de cada tipo.

3. **Inclusión aprobada de `H5P.Crossword 0.5` con transparencia de licencia `GPL3`:**
   - El responsable del proyecto aprobó explícitamente incluir `H5P.Crossword 0.5.13` (`MIT`), documentando que su dependencia de iconos `H5P.MaterialDesignIcons-1.0` declara licencia `GPL3` en su `library.json` (y que `H5P.TextUtilities-1.3` / `H5P.Timer-0.4` declaran dominio público `pd`). Las bibliotecas de terceros se empaquetan intactas con sus `library.json` originales únicamente dentro de los archivos `.h5p` que las requieren.

4. **Registro extensible de validadores en `backend/h5pTemplates.js`:**
   - `listTemplates()` expone el catálogo declarativo (`type`, `label`, `category`, `mainLibraryKey`, `coreApi`) para que `H5P-7` y `H5P-16` descubran formatos sin hardcodear versiones.
   - `CONTENT_VALIDATORS` valida esquemas base y paquetes poblados para los 12 `mainLibrary`, incluyendo sub-bibliotecas embebidas (`H5P.QuestionSet`, `H5P.Accordion`, `media.type`, `extraClue`).

---

## 4. Consecuencias

- **Positivas:** el repositorio cuenta con 12 plantillas H5P en español listas para `H5P-16` y `H5P-7`, validadas contra la especificación oficial de H5P Group, sin aumentar el tamaño histórico del repositorio respecto a `question-set-616.h5p` y garantizando `coreApi <= 1.24`.
- **Compromisos:** cada nuevo formato que se conecte al generador con Gemini en el futuro requerirá su propio prompt/esquema JSON en `backend/prompts.js` y `backend/llmClient.js`, además de su constructor en `H5P-16` y su tarjeta en `H5P-7`.
- **Revisión futura:** si en `H5P-17` se confirma que el Moodle universitario soporta `coreApi >= 1.27`, podrán incorporarse en una iteración posterior `H5P.Dialogcards`, `H5P.MarkTheWords`, `H5P.Essay` y `H5P.QuestionSet 1.20`.
