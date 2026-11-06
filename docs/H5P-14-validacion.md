# H5P-14 — Evidencia de verificación

Fecha: 2026-11-06. Las pruebas usaron el código de la rama `feature/h5p-14-prompts-validacion` y el material sintético de [evaluación](H5P-14-material-evaluacion.md). No se incluyen claves ni documentos privados.

## Pruebas automatizadas

- `npm test --prefix backend`: 50 pruebas aprobadas. Incluyen retroalimentación ausente, vacía, de tipo incorrecto o excesiva; opciones duplicadas; respuesta correcta inconsistente; corrección limitada; cancelación; y solicitudes de 1 y 20 preguntas.
- `npm run test:packaged --prefix frontend -- h5p-generator-linux-h5p14-evaluacion`: aprobada. Usa Gemini y el diálogo de guardado simulados; verifica el recorrido de la aplicación empaquetada y la explicación de cada pregunta para cuestionarios de 1 y 20 preguntas.
- El 2026-11-06, el usuario abrió en Lumi un H5P sintético generado por el worker y mostró capturas con la explicación visible después de una respuesta incorrecta y otra correcta. Esta comprobación es real en Lumi, pero el contenido del ejemplo no fue generado por Gemini.

## Evaluación con Gemini real

Se utilizó `gemini-2.5-flash`, la plantilla `h5p-14-v4` y el cliente del backend con el material sintético. Se solicitaron ocho preguntas de dificultad intermedia cubriendo todos los temas y, en otra solicitud, cuatro preguntas enfocadas en copias de seguridad y recuperación. El H5P de ocho preguntas se ensambló con el worker de producción. Esta prueba llamó directamente al cliente y al worker: no ejercitó la interfaz ni el guardado por diálogo con Gemini real.

- Cobertura: las ocho preguntas se distribuyeron en dos por cada tema: confidencialidad, integridad, disponibilidad y copias de seguridad. Es un resultado de una muestra, no una garantía de equilibrio para otros documentos.
- Enfoque: las cuatro preguntas de la segunda solicitud trataron sobre copias de seguridad o recuperación, como se pidió.
- Estructura y exportación: el paquete de ocho preguntas contiene cuatro alternativas, una correcta y retroalimentación no vacía para el rango 0–100 en cada una. Las explicaciones no sustituyen una revisión de su exactitud.
- Dificultad: hubo una pregunta aplicada a permisos por rol y otras sobre límites o aplicación de medidas, pero varias pidieron identificar definiciones. El cumplimiento de una dificultad intermedia es parcial y subjetivo.
- Exactitud: una pregunta de la solicitud enfocada afirmó que las pruebas de restauración pueden hacer que las copias «garanticen la recuperación». El material indica que las pruebas permiten comprobar la capacidad de restauración, sin prometer una garantía absoluta. La respuesta y la explicación deben revisarse y reformularse antes de utilizar ese cuestionario.
- Alternativas: en general eran distinguibles y relacionadas con el tema; algunos distractores fueron fáciles de descartar. La muestra no permite concluir una calidad uniforme.

Antes de la versión v4 se observó otro error: una pregunta sobre resúmenes criptográficos trató un cambio detectado como necesariamente no autorizado. También se observaron preguntas demasiado literales. Se ajustó el prompt para solicitar razonamiento y evitar inferencias y garantías no fundamentadas, pero la evaluación v4 confirma que estas instrucciones no garantizan exactitud. El esquema valida la estructura, no la fidelidad al material; el docente debe revisar el contenido antes de usarlo.

## Estado de los criterios

| Criterio | Evidencia y límite |
| --- | --- |
| CA-1: diseño pedagógico y retroalimentación | Prompt, esquema y exportación implementados. Lumi mostró la explicación del ejemplo sintético; la evaluación real detectó la afirmación imprecisa descrita arriba. |
| CA-2: distribución temática | Dos preguntas por tema en una muestra real de ocho; requiere evaluar más documentos para generalizar. |
| CA-3: directrices docentes | Una muestra real de cuatro preguntas respetó el enfoque temático; la dificultad solicitada se cumplió solo parcialmente. |
| CA-4: SDK y esquema | Se usa REST con `responseMimeType` y `responseJsonSchema`, con validación local. El ticket menciona `@google/generative-ai` y `responseSchema`; aceptar la equivalencia sigue pendiente de acuerdo. |
| CA-5: análisis JSON | Se usa `JSON.parse` sin extraer bloques Markdown mediante expresiones regulares. Hay pruebas de rechazo y corrección limitada. |

Antes de cerrar el ticket debe resolverse CA-4 y revisarse la aceptación de la calidad pedagógica observada. La validación de Moodle y la edición manual de preguntas pertenecen a tareas separadas.

## Auditoría posterior de las cuatro entregas

Se revisaron el prompt, la validación, el empaquetador y el recorrido preload/IPC/generación/guardado. Se corrigió el límite del validador compartido: ahora rechaza cantidades fuera de 1–20 incluso cuando coinciden con el array recibido. Se ampliaron los casos de retroalimentación inválida y se hizo visible en la interfaz la necesidad de comprobar respuestas y explicaciones en Lumi antes de usarlas con estudiantes.

La suite actual tiene 51 pruebas aprobadas. La distribución `h5p-generator-linux-h5p14-auditoria` incorpora estas correcciones. Los hallazgos de calidad de la evaluación real permanecen documentados: el aviso al docente no demuestra que hayan desaparecido. El cierre del ticket sigue condicionado a resolver CA-4 y la aceptación pedagógica; no se ha declarado que todos los criterios estén satisfechos.
