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

Ante fallos transitorios de red o HTTP 408/500/502/503/504, la generación reintenta automáticamente hasta tres veces, con esperas crecientes y un límite total de 90 segundos. No reintenta errores de clave, cuota ni respuestas inválidas. Los errores distinguen conexión, servicio, solicitud rechazada, tiempo agotado y empaquetado.

Las alternativas se exportan sin mezclar su orden. Si Gemini agrega una enumeración completa de A a D, se eliminan esos prefijos y se conserva la respuesta correcta.

El paquete incluye las bibliotecas de Question Set y Multiple Choice de la plantilla H5P indicada en [backend/templates/README.md](backend/templates/README.md). Un paquete anterior fue comprobado manualmente en Lumi por el usuario. La versión actual y su compatibilidad con Moodle requieren validación en cada instalación. La revisión y edición de preguntas antes de exportar aún no está implementada.


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
