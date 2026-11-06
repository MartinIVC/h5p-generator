# H5P-14 — Plan de implementación

Fecha: 2026-11-06  
Ticket: [H5P-14 — Diseñar System Prompts y validación de esquema JSON](https://h5p-rag-generator.atlassian.net/browse/H5P-14)  
Estado: entregas 1 a 4 realizadas y evidencia registrada en [H5P-14-validacion.md](H5P-14-validacion.md). La aceptación de la calidad pedagógica observada y la decisión del CA-4 siguen pendientes para el cierre.

## Objetivo

Completar el diseño pedagógico del prompt, la cobertura temática del documento y la retroalimentación formativa, aprovechando la integración y la validación implementadas en H5P-19.

## Base actual y preparación

H5P-19 ya incluye esquema JSON, validación de cantidades y opciones, reintentos limitados, clave protegida y pruebas automatizadas. Este plan toma como base el código local hasta el commit `45aff4b`.

La rama `feature/h5p-14-prompts-validacion` parte del commit `45aff4b` de H5P-19. El 2026-11-06 se actualizó `develop` local al merge `b17e667`, que incorpora ese commit.

### Decisión sobre el CA-4

El criterio menciona `@google/generative-ai` y `responseSchema`, mientras el código actual usa REST y `responseJsonSchema`.

Se propone conservar la integración actual y ajustar el criterio para aceptar su equivalente funcional. Ese ajuste debe acordarse antes de considerar satisfecho el CA-4. Si se exige utilizar un SDK, la alternativa recomendada actualmente por Google es `@google/genai`; no se propone introducir el SDK antiguo.

Referencia: [Bibliotecas de Gemini — documentación de Google](https://ai.google.dev/gemini-api/docs/libraries).

## Entrega 1 — Prompt pedagógico y contrato de preguntas

**Criterios cubiertos:** CA-1, CA-2 y CA-3.

### Trabajo

- Crear `backend/prompts.js` con una plantilla versionada.
- Establecer el rol de especialista didáctico universitario.
- Solicitar preguntas conceptuales, distractores plausibles y explicaciones formativas.
- Separar las instrucciones del sistema, las directrices del docente y el material.
- Tratar el documento como contenido de referencia. Las instrucciones del docente podrán ajustar dificultad y enfoque sin alterar el esquema ni la cantidad configurada.
- Pedir cobertura de todo el documento, evitando concentrarse en sus primeros párrafos.
- Cuando el docente delimite un tema, distribuir las preguntas dentro de ese alcance.

### Resultado verificable

El prompt conserva las instrucciones del docente, incluye el material completo admitido y establece explícitamente las reglas pedagógicas. La explicación formativa se solicita como capacidad pedagógica de las preguntas; su campo de salida y visualización corresponden a las entregas 2 y 3, respectivamente.

## Entrega 2 — Esquema y validación de retroalimentación

**Criterios cubiertos:** CA-1, CA-4 y CA-5.

### Trabajo

- Extender el contrato actual con una explicación formativa obligatoria por pregunta.
- Validar que la explicación sea texto no vacío y tenga un límite de longitud.
- Conservar las verificaciones de opciones únicas y respuesta correcta consistente.
- Mantener el análisis directo del JSON, los errores con motivos fijos y la regeneración correctiva limitada.
- No utilizar expresiones regulares para reparar JSON o quitar bloques Markdown.
- Resolver la correspondencia entre la integración existente y el CA-4 conforme a la decisión previa.

### Resultado verificable

Se rechazan respuestas incompletas o inconsistentes sin inventar contenido ni filtrar documentos o claves. El campo `retroalimentacion` es obligatorio, se valida como texto no vacío de hasta 2000 caracteres y se conserva en el resultado interno. La decisión del CA-4 sigue pendiente de acuerdo; la implementación conserva REST con `responseJsonSchema`.

## Entrega 3 — Conservar la retroalimentación hasta el H5P

### Trabajo

- Adaptar `backend/h5pPackageWorker.js` para trasladar la explicación al cuestionario y mostrarla después de comprobar la respuesta.
- Incluir los nuevos módulos en el empaquetado Linux.
- Mantener el contrato IPC existente.

### Resultado verificable

La explicación se incluye en la retroalimentación general de cada pregunta, para respuestas correctas e incorrectas. El usuario confirmó la visualización en Lumi con un archivo sintético; la evidencia distingue ese ejemplo de las pruebas con Gemini real.

## Entrega 4 — Verificación y evidencia de cierre

### Pruebas automatizadas

- Retroalimentación ausente, vacía, demasiado extensa o de tipo inválido.
- Instrucciones contradictorias y preservación del material enviado.
- Opciones únicas y respuesta correcta consistente con las opciones.
- Reintentos limitados, cancelación y errores seguros.
- Cuestionarios de 1 y 20 preguntas.
- Recorrido empaquetado, incluyendo la conservación de la retroalimentación en el archivo exportado.

### Evaluación real

Utilizar un apunte de informática dividido en temas reconocibles y revisar:

- Cobertura temática y ausencia de concentración injustificada en el inicio del documento.
- Correspondencia de las preguntas y respuestas con el material.
- Cumplimiento de la dificultad y el enfoque solicitados por el docente.
- Calidad de las alternativas y utilidad de las explicaciones.
- Visualización de la retroalimentación en Lumi después de comprobar una respuesta.

Un JSON válido no basta para afirmar que la calidad pedagógica está verificada. La evaluación real requiere una clave Gemini válida y acceso al servicio; la evidencia debe distinguirla de las pruebas simuladas.

### Documentación

- Actualizar `README.md` y `MEMORY.md` cuando cambie el comportamiento público o la estructura de módulos.
- Registrar la evidencia de H5P-14 y su correspondencia con los criterios de aceptación.
- Dejar los cambios en commits revisables y preparar su integración a `develop`.

## Criterios de cierre

- Los cinco criterios de aceptación están cubiertos, incluida la decisión documentada sobre CA-4.
- Las pruebas automatizadas y la integración empaquetada pasan.
- Existe evidencia de cobertura temática, seguimiento de instrucciones y retroalimentación formativa.
- La explicación se conserva y se muestra en el H5P exportado.
- La documentación refleja el comportamiento final y sus límites.

## Fuera del alcance

- Formatos adicionales y selector de actividades: H5P-7 y H5P-15.
- Revisión y edición manual de preguntas antes de exportar: H5P-30.
- Validación en Moodle: H5P-17.
- Refactorización general de la ingesta: H5P-20.

