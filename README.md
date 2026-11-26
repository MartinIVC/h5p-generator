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

La aplicación muestra el progreso y el resultado en cada operación. En segundo plano puede emitir un aviso del sistema cuando una actividad queda lista, falla la generación o preparación, se guarda un archivo H5P, o se crea o restaura una copia de seguridad. La preferencia está en **Opciones y Configuración** y requiere soporte del escritorio. Los avisos usan textos sin nombres de archivo, rutas, contenido ni claves. Consulta la [validación de H5P-27](docs/H5P-27-validacion.md).

## Generación y edición de actividades H5P

Selecciona documentos, inspecciónalos y pasa al Paso 2 (`#panel-selector`) para elegir uno de los **12 formatos interactivos H5P** organizados por categoría (`Evaluación`, `Práctica` y `Estudio`), ajustar su extensión (con botones rápidos `3`, `5` y `10` o límites propios del formato), definir el nombre/título y agregar instrucciones opcionales. El texto extraído y las instrucciones se envían a Gemini; se requiere una clave configurada. El material conjunto admite hasta 200.000 caracteres.

- **Revisión y edición integrada (`H5P-30`) para `QuestionSet`, `MultiChoice` y `TrueFalse`:** al generar estos tres formatos, la aplicación abre el Paso 3 (**Revisar y exportar**), guarda el contenido editable en borradores locales con autoguardado y permite corregir títulos, enunciados, alternativas, respuesta correcta, retroalimentaciones, añadir/eliminar/reordenar preguntas (1 a 20 en `QuestionSet`) y marcar ítems revisados de forma opcional. El docente confirma la actividad completa antes de empaquetarla en el worker; cualquier cambio posterior invalida la confirmación y el paquete previo. Los proyectos exportados desde el editor conservan una copia editable local que puede reabrirse con **Abrir editor** aunque el `.h5p` se haya movido o eliminado.
- **Exportación directa con revisión en Lumi para los otros 9 formatos** (`SingleChoiceSet`, `Blanks`, `DragText`, `Summary`, `SortParagraphs`, `Crossword`, `FindTheWords`, `Accordion` y `Flashcards`): el archivo `.h5p` se ensambla y valida en memoria (`backend/h5pBuilder.js` y `backend/h5pPacker.js`), se guarda de forma atómica mediante el diálogo del sistema limpiando temporales con `fs.promises.rm` y se registra en el ramo seleccionado con la indicación de revisarlo en Lumi. Si falla el registro tras escribir el archivo, la aplicación distingue ambos hechos y, en el flujo editorial, conserva el borrador editable para su recuperación.

La generación y el botón **Probar clave** usan Gemini 3.5 Flash-Lite como modelo principal y Gemini 3.8 Flash como respaldo. Prueban el respaldo si Gemini indica que el modelo no está disponible, deniega el acceso específicamente al modelo o responde HTTP 503. La verificación tiene 15 segundos en total y hace como máximo una solicitud por modelo.

La generación hace hasta tres solicitudes en 90 segundos, con un máximo de 45 segundos por solicitud. El cambio de modelo y la espera ante fallos transitorios comparten este límite. Solicita a Gemini un esquema JSON específico del formato elegido. Después de validar la respuesta, puede pedir una única corrección dentro del mismo límite. Los errores de credenciales, permisos del proyecto, cuota y bloqueos de contenido terminan la operación.

Las plantillas pedagógicas versionadas de `backend/prompts.js` (`PROMPT_VERSION = 'h5p-14-v4'` y `ACTIVITY_PROMPT_VERSION = 'h5p-16-v1'`) solicitan contenido conceptual y cobertura equilibrada de los temas, respetando las directrices del docente. El docente debe revisar el contenido generado antes de usarlo con estudiantes: una evaluación real detectó una afirmación imprecisa aunque la estructura era válida (`docs/H5P-14-validacion.md`).

En preguntas de opción múltiple, las alternativas se exportan sin mezclar su orden; si Gemini agrega una enumeración completa de A a D, se eliminan esos prefijos al validar la respuesta del modelo, mientras que los prefijos escritos por el docente durante la revisión se conservan al exportar.

El backend cuenta con un catálogo estático y operativo de **12 formatos H5P** compatibles con `coreApi <= 1.24` (`QuestionSet`, `MultiChoice`, `TrueFalse`, `SingleChoiceSet`, `Blanks`, `DragText`, `Summary`, `SortParagraphs`, `Crossword`, `FindTheWords`, `Accordion` y `Flashcards`), descrito en [backend/templates/README.md](backend/templates/README.md) y [docs/H5P-15-estructura-plantillas.md](docs/H5P-15-estructura-plantillas.md) (decisiones arquitectónicas en [ADR-001](docs/adr/ADR-001-plantillas-estaticas-h5p.md), [ADR-002](docs/adr/ADR-002-ampliacion-catalogo-plantillas-h5p.md) y [ADR-003](docs/adr/ADR-003-motor-empaquetado-h5p.md)). La selección de formato y extensión se conserva en los borradores locales. Consulta la matriz de soporte y evidencia en [docs/H5P-30-validacion.md](docs/H5P-30-validacion.md). La validación en Lumi Desktop y Moodle de los paquetes modificados queda coordinada con `H5P-17`.


## Copias de seguridad

Las copias transportables v1 contienen los metadatos de la biblioteca, los borradores y la papelera. Excluyen los archivos `.h5p`, el contenido editable local y las instrucciones de generación. La biblioteca sigue leyendo las copias v1 anteriores. Al reemplazar la biblioteca, los registros importados reciben únicamente los datos de la copia, aunque sus identificadores coincidan con los de los registros locales.

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
