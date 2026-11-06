# H5P-19: evidencia de implementación y cierre

Estado local comprobado el 2026-11-06 en Linux x64. Alcance: puente IPC nativo para inspección, generación, guardado y verificación de clave. No se implementan otros tickets.

## Implementado y comprobado

- `contextIsolation: true`, `nodeIntegration: false` y preload con métodos explícitos mediante `invoke`.
- Validación del marco principal local en inspección, liberación, generación, guardado y verificación de clave. Rechazo de argumentos y propiedades no admitidas antes de ejecutar servicios.
- Inspección y ensamblado en workers incluidos en la distribución. Documentos y paquetes identificados mediante UUID asociados a una ventana, sin texto fuente ni credenciales en las respuestas.
- Errores controlados con mensajes fijos; guardado mediante diálogo nativo, escritura temporal y registro posterior del proyecto. Cancelar permite reintentar.
- Distribución Linux con runtime Electron, backend, dependencias del lockfile y plantilla. No requiere instalar Node.js en el equipo de destino. Se conserva la estructura de directorios, sin ASAR, para los workers y módulos nativos.
- 39 pruebas backend aprobadas: contratos, extracción, límites, limpieza de sesiones, cliente Gemini, contenido del ZIP, guardado y errores, además de las regresiones existentes.
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

## Verificación manual restante

Antes del cierre definitivo, ejecutar el binario distribuible en el escritorio destino, configurar la clave mediante la interfaz y generar con un documento de prueba, primero sin instrucciones y después con ellas. Guardar mediante el diálogo nativo, comprobar el registro en la biblioteca y cancelar/reintentar una vez. Esto valida el servicio real, el llavero del sistema y la interacción nativa que la prueba automatizada simula.

Dependencias: una clave Gemini válida con cuota, conexión y un llavero disponible (en Linux no se permite `basic_text`). No se deben compartir claves en el chat. No se ha verificado esta distribución en otros sistemas operativos ni en otra instalación Linux.

El usuario ya mostró un paquete anterior ejecutándose en Lumi con navegación y puntuación. La corrección posterior del orden/prefijos está verificada en el ZIP generado; su nueva comprobación visual en Lumi queda pendiente. La validación en Moodle corresponde a H5P-17, no bloquea por sí sola el puente de H5P-19. Selector de formatos, nuevas versiones de plantillas y edición de preguntas corresponden a H5P-7, H5P-15 y H5P-30.

La integración a `develop`, publicación remota y actualización del estado en Jira no forman parte de esta validación local. El trabajo permanece en la rama de la tarea.

## Corrección de fallos intermitentes

El usuario confirmó generación sin instrucciones en el ejecutable, y posteriormente informó dos errores genéricos antes de una generación exitosa. Las capturas no permiten recuperar la causa exacta de esos errores anteriores.

Se añadieron reintentos limitados para fallos de transporte y HTTP transitorios y mensajes específicos para distinguir conexión, disponibilidad, solicitud rechazada, timeout y ensamblado. Las pruebas simulan dos errores seguidos de éxito en una sola invocación; también cubren agotamiento, cancelación y errores que no deben reintentarse. Se mantiene pendiente confirmar el comportamiento con Gemini real usando el nuevo ejecutable.

La distribución corregida se genera en `dist/h5p-generator-linux-x64-h5p19-fix` para conservar intacta la distribución que el usuario tenía abierta.
