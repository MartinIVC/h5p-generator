# H5P-19: evidencia de implementación y cierre

Estado local comprobado el 2026-11-06 en Linux x64. Alcance: puente IPC nativo para inspección, generación, guardado y verificación de clave. No se implementan otros tickets.

## Implementado y comprobado

- `contextIsolation: true`, `nodeIntegration: false` y preload con métodos explícitos mediante `invoke`.
- Validación del marco principal local en inspección, liberación, generación, guardado y verificación de clave. Rechazo de argumentos y propiedades no admitidas antes de ejecutar servicios.
- Inspección y ensamblado en workers incluidos en la distribución. Documentos y paquetes identificados mediante UUID asociados a una ventana, sin texto fuente ni credenciales en las respuestas.
- Errores controlados con mensajes fijos; guardado mediante diálogo nativo, escritura temporal y registro posterior del proyecto. Cancelar permite reintentar.
- Distribución Linux con runtime Electron, backend, dependencias del lockfile y plantilla. No requiere instalar Node.js en el equipo de destino. Se conserva la estructura de directorios, sin ASAR, para los workers y módulos nativos.
- 46 pruebas backend aprobadas: contratos, extracción, límites, limpieza de sesiones, cliente Gemini, contenido del ZIP, guardado y errores, además de las regresiones existentes.
- Integración en Electron empaquetado aprobada: renderer → preload → main → workers → archivo → registro. Incluye prompt vacío, red caída, cuota, documento vacío, cancelación, escritura fallida, reintento y rechazo entre ventanas/orígenes.
- Interfaz real ejercitada a 840 × 600: estado vacío, inspección, foco al entrar al paso 2, Tab entre campos, error al generar, reintento, foco en guardar, cancelación y éxito.
- Sin sockets TCP LISTEN de los procesos de la aplicación al inicio y al final del recorrido (inspección de `/proc`). No significa ausencia de conexiones HTTPS salientes a Gemini.

## Reproducir

Desde la raíz:

```sh
npm ci --prefix backend
npm ci --prefix frontend
npm test --prefix backend
npm run package:linux --prefix frontend
npm run test:packaged --prefix frontend
./dist/h5p-generator-linux-x64/h5p-generator
```

La prueba empaquetada requiere una sesión gráfica Linux y acceso a `/proc`. Copia la distribución a un directorio temporal, sustituye solo en esa copia el punto de entrada por un arnés que carga el main de producción y usa un perfil aislado. El artefacto distribuible queda intacto. Gemini y la elección del diálogo se simulan; no usa la clave, documentos ni biblioteca del usuario. El arnés no se incluye en la distribución. La instalación de dependencias requiere acceso al registro npm o una caché completa.

## Evidencia manual aportada por el usuario

El 2026-11-06 el usuario confirmó generación sin instrucciones y generación siguiendo un prompt. También comprobó la cancelación del diálogo. Posteriormente confirmó que `cuestionario3`, de 20 preguntas, se guardó, apareció en sus proyectos y funcionó en Lumi. Esta evidencia corresponde al ejecutable anterior a la incorporación del esquema y la regeneración correctiva descritos abajo.

La validación en Moodle corresponde a H5P-17; selector de formatos, nuevas versiones de plantillas y edición de preguntas corresponden a H5P-7, H5P-15 y H5P-30. No se han verificado otras instalaciones Linux ni otros sistemas operativos.

La integración a `develop`, publicación remota y actualización del estado en Jira no forman parte de esta validación local. El trabajo permanece en la rama de la tarea.

## Corrección de fallos intermitentes

El usuario confirmó generación sin instrucciones en el ejecutable, y posteriormente informó dos errores genéricos antes de una generación exitosa. Las capturas no permiten recuperar la causa exacta de esos errores anteriores.

Se añadieron reintentos limitados para fallos de transporte y HTTP transitorios y mensajes específicos para distinguir conexión, disponibilidad, solicitud rechazada, timeout y ensamblado. Las pruebas simulan dos errores seguidos de éxito en una sola invocación; también cubren agotamiento, cancelación y errores que no deben reintentarse. El usuario confirmó posteriormente una generación exitosa de 20 preguntas y su ejecución en Lumi; no se atribuye una causa específica a los errores anteriores.

La distribución corregida se genera en `dist/h5p-generator-linux-x64-h5p19-fix` para conservar intacta la distribución que el usuario tenía abierta.

## Respuestas estructuradas y corrección limitada

La solicitud incluye `responseJsonSchema` con la cantidad exacta de preguntas, propiedades obligatorias y cuatro opciones. La validación local identifica motivos mediante códigos y mensajes fijos: cantidad, estructura, JSON, pregunta vacía/extensa, opciones inválidas/duplicadas, respuesta correcta inconsistente, salida truncada, bloqueo, respuesta vacía o demasiado grande. No expone contenido, credenciales ni mensajes arbitrarios del proveedor.

Se permite una única regeneración correctiva desde la fuente y las instrucciones originales, añadiendo solo el diagnóstico fijo. Comparte el límite global de tres solicitudes y 90 segundos con los reintentos de red. Un segundo rechazo termina con error; no se inventan opciones ni se modifica la respuesta correcta para forzar la aceptación. Los bloqueos de contenido no se reintentan.

Las pruebas cubren recuperación de 19 a 20 preguntas, alternativas duplicadas, respuesta correcta inconsistente, JSON truncado, bloqueo, cancelación, rechazo repetido y límites combinados de red/corrección. El arnés empaquetado verifica la recuperación de 19 a 20 preguntas por renderer/preload/IPC y el guardado del ZIP con 20 preguntas, cuatro opciones y una correcta por pregunta. Gemini y el diálogo se simulan en esa prueba; la nueva solicitud estructurada no se ha ejecutado aquí con la clave real del usuario.

Distribución con estos cambios: `dist/h5p-generator-linux-x64-validated`.
