# h5p-rag-generator

Aplicación de escritorio Electron para organizar ramos y generar cuestionarios H5P a partir de documentos.

## Instalación y ejecución

Requiere Node.js y npm. Desde la raíz del repositorio:

```sh
cd backend && npm ci
cd ../frontend && npm ci
npm start
```

La suite disponible se ejecuta con `cd backend && npm test`. El script `test` de `frontend/package.json` aún es un marcador.

Si los datos locales no se pueden leer, la biblioteca muestra un error con la opción de reintentar. La aplicación conserva el archivo existente y no lo reemplaza por una biblioteca vacía.

## Avisos

La selección de documentos, la vista previa, el guardado y las copias de seguridad muestran su resultado dentro de la aplicación. Las copias de seguridad completadas también pueden producir una notificación del sistema cuando la ventana está en segundo plano y el sistema lo permite. Los avisos nativos nunca incluyen nombres de archivo, contenido de documentos ni claves.

## Generación de cuestionarios

Selecciona documentos, agrega instrucciones opcionales e inspecciónalos. Después indica entre 1 y 20 preguntas y genera un cuestionario de opción múltiple. El texto extraído y las instrucciones se envían a Gemini; se requiere una clave configurada. El material conjunto admite hasta 200.000 caracteres. El archivo `.h5p` se guarda mediante el diálogo del sistema y se registra en el ramo seleccionado. Si falla el registro, la aplicación indica que el archivo ya fue guardado.

La generación y el botón **Probar clave** usan Gemini 3.5 Flash-Lite como modelo principal y Gemini 3.8 Flash como respaldo. Prueban el respaldo si Gemini indica que el modelo no está disponible, deniega el acceso específicamente al modelo o responde HTTP 503. La verificación tiene 15 segundos en total y hace como máximo una solicitud por modelo.

La generación hace hasta tres solicitudes en 90 segundos, con un máximo de 45 segundos por solicitud. El cambio de modelo y la espera ante fallos transitorios comparten este límite. Solicita a Gemini un esquema JSON con la cantidad exacta de preguntas y cuatro opciones. Después de validar la respuesta, puede pedir una única corrección dentro del mismo límite. Los errores de credenciales, permisos del proyecto, cuota y bloqueos de contenido terminan la operación.

La plantilla pedagógica versionada de `backend/prompts.js` solicita preguntas conceptuales y cobertura equilibrada de los temas, respetando las directrices del docente. Cada pregunta debe incluir una explicación formativa no vacía de hasta 2000 caracteres. La explicación se valida durante la generación y se incluye como retroalimentación de la pregunta en el archivo H5P, para mostrarse al comprobar la respuesta. El docente debe revisar el contenido generado: una evaluación real detectó una afirmación imprecisa aunque la estructura era válida. Los resultados y límites están en `docs/H5P-14-validacion.md`.

Las alternativas se exportan sin mezclar su orden. Si Gemini agrega una enumeración completa de A a D, se eliminan esos prefijos y se conserva la respuesta correcta.

El backend cuenta con un catálogo estático de 12 plantillas H5P compatibles con `coreApi <= 1.24` (`MultiChoice`, `QuestionSet`, `TrueFalse`, `Blanks`, `DragText`, `SingleChoiceSet`, `Summary`, `SortParagraphs`, `Crossword`, `FindTheWords`, `Accordion` y `Flashcards`) descrito en [backend/templates/README.md](backend/templates/README.md) y [docs/H5P-15-estructura-plantillas.md](docs/H5P-15-estructura-plantillas.md) (decisiones arquitectónicas en [ADR-001](docs/adr/ADR-001-plantillas-estaticas-h5p.md) y [ADR-002](docs/adr/ADR-002-ampliacion-catalogo-plantillas-h5p.md)). En el Paso 2 (`#panel-selector`, H5P-7) el docente puede elegir mediante tarjetas entre **Cuestionario (`H5P.QuestionSet 1.17`, 1 a 20 preguntas con botones rápidos 3, 5 y 10)** y **Opción Múltiple (`H5P.MultiChoice 1.14`, reactivo individual de 1 pregunta)**, además de explorar los otros 10 formatos preparados para `H5P-16`. La selección se conserva en los borradores locales. La compatibilidad con Moodle requiere validación en esa instalación (`H5P-17`). La revisión y edición de preguntas antes de exportar aún no está implementada (`H5P-30`).


## Distribución Linux y validación de H5P-19

Desde la raíz, después de instalar las dependencias:

```sh
npm run package:linux --prefix frontend
npm run test:packaged --prefix frontend
./dist/h5p-generator-linux-x64/h5p-generator
```

Se genera un directorio ejecutable en `dist/h5p-generator-linux-<arquitectura>`; debe distribuirse completo. El script reconstruye ese directorio y usa el runtime Electron instalado mediante el lockfile y `npm ci --omit=dev` para el backend. Copia únicamente los archivos de aplicación enumerados: excluye datos locales y credenciales. No produce un instalador ni incorpora firma de distribución.

La integración requiere una sesión gráfica Linux. Usa una copia temporal con perfil aislado, Gemini y diálogo simulados, y verifica el recorrido IPC, workers, errores, guardado y ausencia de puertos TCP de escucha. Consulta la [evidencia y comprobación manual pendiente](docs/H5P-19-validacion.md).

Para construir otra distribución sin reemplazar una que esté abierta, ambos scripts aceptan un nombre opcional con el prefijo `h5p-generator-linux-`:

```sh
npm run package:linux --prefix frontend -- h5p-generator-linux-x64-h5p19-fix
npm run test:packaged --prefix frontend -- h5p-generator-linux-x64-h5p19-fix
```
