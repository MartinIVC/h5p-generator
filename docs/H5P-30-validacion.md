# H5P-30 · Validación del editor de actividades y preparación de integración

Implementación completa de los bloques A, B, C y D (fases 1 a 14 y preparación de fase 15) sobre la rama `feat/h5p-30-editor-actividades` (base `b074266` de `develop`). [H5P-30](https://h5p-rag-generator.atlassian.net/browse/H5P-30) · Coordinación de compatibilidad externa: [H5P-17](https://h5p-rag-generator.atlassian.net/browse/H5P-17).

## Entorno y versiones verificadas

- **Sistema operativo:** Linux `7.3.4-1-cachyos` (sesión gráfica Wayland/Hyprland con XWayland)
- **Node.js:** `v26.13.1`
- **npm:** `12.2.2`
- **Electron:** `44.4.5`
- **Commit de verificación de código/pruebas:** `fdec662` (en `feat/h5p-30-editor-actividades`)

## Matriz de soporte de los 12 formatos H5P

| Formato (`activityType`) | Biblioteca H5P | Ruta de generación (`h5p:generate`) | Revisión y exportación |
|---|---|---|---|
| `questionset` (alias `question-set`, `multiple-choice`) | `H5P.QuestionSet 1.17` | Editorial (`kind: "editable"`, requiere `sessionId`, 0 llamadas al worker en generación) | Paso 3 «Revisar y exportar» con índice lateral / selector compacto (`< 760 px`), alta/baja/reordenación (1–20), confirmación global, empaquetado revisado y reapertura local desde borrador o proyecto |
| `multichoice` | `H5P.MultiChoice 1.14` | Editorial (`kind: "editable"`, requiere `sessionId`, 0 llamadas al worker en generación) | Paso 3 «Revisar y exportar» con formulario directo (1 pregunta, 4 opciones por ID, correcta estable al renombrar y prefijos literales preservados) |
| `truefalse` | `H5P.TrueFalse 1.8` | Editorial (`kind: "editable"`, requiere `sessionId`, 0 llamadas al worker en generación) | Paso 3 «Revisar y exportar» con formulario directo (booleano `true`/`false` distinto de pendiente y dos retroalimentaciones) |
| `singlechoiceset` | `H5P.SingleChoiceSet 1.11` | Directa (`kind: "package"`) | Exportación directa desde Paso 2 con indicación de revisión en Lumi |
| `blanks` | `H5P.Blanks 1.14` | Directa (`kind: "package"`) | Exportación directa desde Paso 2 con indicación de revisión en Lumi |
| `dragtext` | `H5P.DragText 1.10` | Directa (`kind: "package"`) | Exportación directa desde Paso 2 con indicación de revisión en Lumi |
| `summary` | `H5P.Summary 1.10` | Directa (`kind: "package"`) | Exportación directa desde Paso 2 con indicación de revisión en Lumi |
| `sortparagraphs` | `H5P.SortParagraphs 0.11` | Directa (`kind: "package"`) | Exportación directa desde Paso 2 con indicación de revisión en Lumi |
| `crossword` | `H5P.Crossword 0.5` | Directa (`kind: "package"`) | Exportación directa desde Paso 2 con indicación de revisión en Lumi |
| `findthewords` | `H5P.FindTheWords 1.4` | Directa (`kind: "package"`) | Exportación directa desde Paso 2 con indicación de revisión en Lumi |
| `accordion` | `H5P.Accordion 1.0` | Directa (`kind: "package"`) | Exportación directa desde Paso 2 con indicación de revisión en Lumi |
| `flashcards` | `H5P.Flashcards 1.7` | Directa (`kind: "package"`) | Exportación directa desde Paso 2 con indicación de revisión en Lumi |

## Contratos IPC incorporados y actualizados

- `openEditor({ draftId } | { projectId })` → `h5p:open-editor`: abre sesión editorial con bloqueo único por registro (`EDITOR_LOCKED` ante conflicto), vinculada a ventana (`sender`), ramo y borrador/proyecto. Devuelve DTO sin instrucciones ni referencias privadas.
- `updateEditor({ sessionId, expectedRevision, operations })` → `h5p:update-editor`: aplica lotes atómicos de 1 a 64 operaciones con control optimista (`REVISION_CONFLICT`), persiste en `editorial/` (`0600`, límite 1 MiB, renombrado atómico) e invalida cualquier revisión confirmada o paquete preparado ante cambios de contenido.
- `closeEditor({ sessionId })` → `h5p:close-editor`: cierra sesión owned por la ventana y libera bloqueo y paquete asociado. La navegación principal fuera del documento o destrucción de ventana liberan automáticamente las sesiones; los saltos in-place (`#main-content`) las conservan.
- `generateH5P({ documentIds, activityType, questionCount, instructions, title?, sessionId? })` → `h5p:generate`: exige `sessionId` válido para `questionset`, `multichoice`, `truefalse` y sus alias (`question-set`, `multiple-choice`); sin sesión devuelve `EDITOR_SESSION_REQUIRED` sin invocar Gemini ni el worker. Para los otros 9 formatos rechaza `sessionId` y mantiene `kind: "package"`.
- `prepareReviewedH5P({ sessionId, expectedRevision })` → `h5p:prepare-reviewed`: revalida contenido (`INVALID_CONTENT` con `issues` por campo si incompleto), fija `reviewedRevision`, proyecta ítems sin IDs editoriales y ejecuta `h5pPackageWorker.js` con `{ activityType, items, title, reviewed: true }`. Soporta cancelación vía `h5p:cancel-generation` y reintento sin volver a consultar Gemini.
- `saveH5PFile({ packageId, suggestedName, courseId? })` → `h5p:save-file`: verifica vigencia del paquete y revisión antes del diálogo, tras el diálogo y antes del renombrado atómico (`checkBeforeRename`). En paquetes editoriales registra la copia exacta con `saveExportedProject` y retira el borrador únicamente tras confirmar archivo y registro; si falla el registro devuelve `{ status: "ok", fileSaved: true, projectSaved: false, draftRemoved: false, draftId }` conservando archivo y borrador.

## Comandos ejecutados y resultados (verificado en Electron y Node)

1. **Suite backend y pruebas unitarias del editor**
   - Comando: `cd backend && npm test`
   - Resultado: **125/125 aprobadas** (`0` fallos, `0` omitidas, ~4,4 s).
   - Cobertura: validación compartida (12 formatos y conservación de prefijos revisados), modelo editable y adaptadores, operaciones atómicas y límites 1–20, persistencia editorial `0600` y recuperación ante corrupción/fallo de escritura, proyectos/papelera/copias v1 sin filtración de datos privados, sesiones IPC con dos ventanas y dos borradores, generación editorial con 0 llamadas al worker, rechazo de MVP sin sesión, preparación revisada, guardado y fallo de registro, estado/autoguardado/formularios/recuperación de errores en el renderer, y regresiones H5P-7, H5P-14, H5P-16, H5P-22, H5P-24, H5P-27, H5P-32, H5P-33, H5P-34.
   - Nota: el script `test` de `frontend/package.json` continúa siendo un marcador sin suite ejecutable.

2. **Empaquetado Linux sin ASAR**
   - Comando: `npm run package:linux --prefix frontend`
   - Resultado: **aprobado** (`dist/h5p-generator-linux-x64` generado con módulos de `backend/editor/`, `frontend/ipc/h5pEditor.js`, `frontend/js/editor/` y `frontend/css/editor.css`).

3. **Integración empaquetada Electron**
   - Comando: `npm run test:packaged --prefix frontend` (ejecutado con descriptores de archivo heredados limpios y sesión gráfica Linux)
   - Resultado: **PASS** (código de salida `0`).
   - Verificado en el ejecutable empaquetado con preload/IPC reales, perfil temporal, Gemini y diálogo simulados, y worker de producción:
     - **QuestionSet:** generación de 2 preguntas, layout compacto (`< 760 px`), contraste WCAG AA en temas claro/oscuro, edición de enunciado/correcta/feedback, reordenación, recarga real del renderer (`reload()`), restauración desde «Abrir editor» en Borradores, exportación a `.h5p`, inspección de `h5p.json` y `content/content.json` con las 2 preguntas reordenadas, eliminación física del `.h5p` y reapertura local desde «Abrir editor» en Proyectos.
     - **MultiChoice:** formulario directo sin barra lateral, renombrado de la alternativa correcta conservando selección y prefijo literal (`A) Exactitud verificada`), restauración desde borrador, diálogo cancelado y reintento, inspección de `h5p.json` y `content/content.json`.
     - **TrueFalse:** cambio a `false`, edición de ambas retroalimentaciones, bloqueo por campo vacío y foco vía «Ir al primer error» en `#editor-feedback-incorrect`, restauración desde borrador, simulación de fallo de registro tras escribir `.h5p` (archivo presente, aviso `warning` único y borrador conservado) y reintento exitoso con inspección de `correct: "false"`, `feedbackOnCorrect` y `feedbackOnWrong`.
     - **12 formatos y regresiones:** los 5 identificadores MVP sin sesión rechazados (`EDITOR_SESSION_REQUIRED`, 0 llamadas a Gemini); los 9 formatos no-MVP generando paquetes válidos en ruta directa; regresiones H5P-22, H5P-27, H5P-32 (sandbox y PDF en `<canvas>`), H5P-33 (aislamiento de borradores y cancelación), H5P-34 (safeStorage y `.h5p`), H5P-35 (contraste >= 4,5:1, z-index, IME, 840 × 600 sin desbordamiento horizontal), H5P-36 (instrucciones en Paso 2) y ausencia de puertos TCP en escucha.

### Hallazgos corregidos durante la verificación empaquetada

- **Carrera entre respuesta IPC de autoguardado y edición local pendiente (`frontend/js/editor/editorController.js`):** cuando llegaba una respuesta IPC anterior mientras existían ediciones locales pendientes en cola, `onSynced` sobrescribía `state.issues` con los errores de la revisión previa. Corregido recalculando `issues` desde el estado local mientras `autosave.hasPending()` sea verdadero.
- **Evento Enter simulado en `scripts/packaged-smoke.cjs` (Electron 44):** `sendInputEvent` con `keyCode: 'Enter'` sin evento `char` no activaba el clic en `<button>` en Opciones; actualizado a `Return` + `char: '\r'`. Además se agregó `disable-backgrounding-occluded-windows` en el harness de pruebas para evitar bloqueos del renderizado `<canvas>` de PDF.js bajo gestores en mosaico (Hyprland). La aplicación distribuida no fue alterada.

## Distinción de alcance y validación humana pendiente (Fase 15)

| Ámbito | Estado | Detalle |
|---|---|---|
| **Electron (automatizado + empaquetado Linux)** | **Comprobado** | Generación, edición, autoguardado 350 ms, recuperación tras recarga y sin `.h5p`, confirmación global, empaquetado en worker de producción, guardado atómico, manejo de errores, contraste WCAG AA y 840 × 600 verificados en `dist/h5p-generator-linux-x64`. |
| **Prueba con docente real** | **Pendiente (manual)** | Validar con un docente la corrección de una afirmación imprecisa y la recuperación tras cerrar completamente la aplicación. |
| **Lector de pantalla real** | **Pendiente (manual)** | Verificar en Orca / NVDA el orden de foco, los anuncios únicos de regiones vivas (`role="status"` / `role="alert"`) y el recorrido íntegro por teclado. |
| **Lumi Desktop (coordinado con H5P-17)** | **Pendiente (manual)** | Abrir e interactuar con los tres paquetes `.h5p` modificados (`QuestionSet`, `MultiChoice`, `TrueFalse`) en Lumi Desktop y registrar versión y resultado. |
| **Moodle (coordinado con H5P-17)** | **Pendiente (manual)** | Importar y ejecutar los tres paquetes `.h5p` modificados en la instancia de Moodle objetivo y registrar versión del LMS y resultado. |

## Estado de preparación para integración en `develop`

- **Rama:** `feat/h5p-30-editor-actividades` (creada desde `b074266` en `develop`).
- **Archivos locales sin seguimiento preservados intactos:** `docs/branding/` y `frontend/assets/logo-generador-h5p-v1.png`.
- **Defectos automatizados abiertos:** ninguno.
- **Fuera de alcance de H5P-30:** evidencia documental por elemento (`H5P-37`), recuperación BM25 (`H5P-31`) y regeneración individual / adaptadores de los otros 9 formatos (`H5P-46`).
- **Siguiente paso antes de merge a `develop`:** completar la validación humana (docente, lector de pantalla, Lumi y Moodle junto con `H5P-17`) y anexar el resultado en la tabla anterior.
