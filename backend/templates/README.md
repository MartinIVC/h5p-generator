# Plantillas estáticas de H5P (`backend/templates/`)

Este directorio contiene las plantillas base declarativas en español y el conjunto curado de bibliotecas H5P para **12 formatos textuales académicos** compatibles con `coreApi <= 1.24` (ver [ADR-001](../../docs/adr/ADR-001-plantillas-estaticas-h5p.md), [ADR-002](../../docs/adr/ADR-002-ampliacion-catalogo-plantillas-h5p.md) y [H5P-15-estructura-plantillas.md](../../docs/H5P-15-estructura-plantillas.md)).

## Estructura

```text
backend/templates/
├── manifest.json            # Catálogo de los 12 formatos, maxCoreApi, SHA-256 e inventario de 36 bibliotecas
├── libraries-bundle.zip     # Clausura curada de las 36 bibliotecas activas (~2.32 MB; sin content/ ni medios)
├── multichoice/             # H5P.MultiChoice 1.14
├── questionset/             # H5P.QuestionSet 1.17 (+ H5P.MultiChoice 1.14)
├── truefalse/               # H5P.TrueFalse 1.8
├── blanks/                  # H5P.Blanks 1.14
├── dragtext/                # H5P.DragText 1.10
├── singlechoiceset/         # H5P.SingleChoiceSet 1.11
├── summary/                 # H5P.Summary 1.10
├── sortparagraphs/          # H5P.SortParagraphs 0.11
├── crossword/               # H5P.Crossword 0.5
├── findthewords/            # H5P.FindTheWords 1.4
├── accordion/               # H5P.Accordion 1.0 (+ H5P.AdvancedText 1.1)
└── flashcards/              # H5P.Flashcards 1.7
```

## Procedencia y licencias

`libraries-bundle.zip` se genera de forma determinista con `node scripts/sync-h5p-templates.cjs` combinando:
- Base local (`H5P.MultiChoice 1.14.7` y `H5P.QuestionSet 1.17.6`) proveniente de <https://h5p.org/sites/default/files/question-set-616_2.h5p>.
- Paquetes oficiales del H5P Hub (<https://api.h5p.org/v1/content-types/>) para los 10 formatos adicionales (`H5P.TrueFalse`, `H5P.Blanks`, `H5P.DragText`, `H5P.SingleChoiceSet`, `H5P.Summary`, `H5P.SortParagraphs`, `H5P.Crossword`, `H5P.FindTheWords`, `H5P.Accordion`, `H5P.Flashcards`), filtrados con `coreApi <= 1.24`.

Cada biblioteca conserva su archivo `library.json` original con autoría y licencia:
- Los 12 tipos principales declaran licencia **MIT**.
- `H5P.TextUtilities-1.3` (usada por `Blanks`) y `H5P.Timer-0.4` (usada por `FindTheWords`) declaran dominio público (`pd`).
- `H5P.MaterialDesignIcons-1.0` (usada exclusivamente por `H5P.Crossword`) declara licencia **GPL3** en su `library.json` y solo se empaqueta dentro de paquetes `crossword`.

## Uso y mantenimiento

- El acceso en tiempo de ejecución ocurre exclusivamente mediante `backend/h5pTemplates.js` (`listTemplates`, `loadTemplate`, `createBasePackageZip`, `validateH5PPackage`), que verifica la huella SHA-256, aplica la compuerta `maxCoreApi: "1.24"` y aísla la clausura exacta de cada formato.
- Para actualizar bibliotecas en el futuro, ejecutar `node scripts/sync-h5p-templates.cjs`, revisar licencias, actualizar `manifest.json` y comprobar `npm test --prefix backend` y `npm run test:packaged --prefix frontend`.
