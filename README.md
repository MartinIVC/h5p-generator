# h5p-rag-generator

Aplicación de escritorio Electron para organizar ramos y preparar material para actividades H5P.

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

La selección del tipo de actividad, la generación y la exportación H5P todavía no están conectadas a la interfaz. Sus avisos de progreso y resultado se incorporarán junto con esas operaciones.
