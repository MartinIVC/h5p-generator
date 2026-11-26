# H5P-27 · Validación de avisos y notificaciones

La auditoría del 26 de noviembre de 2026 partió de `2272ea5` en `develop`. El PR #27 ya había integrado la preferencia persistente, los avisos nativos de segundo plano, las regiones vivas y la deduplicación. El ticket figuraba en **Done**. La rama de seguimiento parte de ese merge. [H5P-27](https://h5p-rag-generator.atlassian.net/browse/H5P-27) · [PR original](https://github.com/MartinIVC/h5p-generator/pull/27)

## Hallazgos y correcciones

- **Alta.** Cancelar mientras se comprobaba la clave podía dejar que la solicitud se enviara. La cancelación local impide su envío. Una vez enviada, la interfaz distingue que el IPC aceptó o rechazó la solicitud de cancelar y espera el resultado de la generación.
- **Alta.** Un guardado tardío podía actuar sobre otro borrador. El renderer conserva el contexto de origen y evita cambiar los datos, los controles o el foco del contexto nuevo.
- **Media.** La fase de empaquetado se anunciaba tras 1,2 segundos sin confirmación. Ahora se muestra progreso indeterminado hasta recibir el paquete validado. Si falla el registro de un archivo ya escrito, se muestra una advertencia explícita.
- **Media.** Los resultados de copia, inspección y guardado incluían rutas o nombres de archivo. Los avisos usan textos fijos y, para inspección, el ordinal del documento. El proceso principal traduce los errores de copia antes de responder por IPC.
- **Media.** La auditoría observó tres listeners adicionales de cada evento después de tres restauraciones. Se libera el par de listeners al restaurar, sustituir la selección, navegar o cerrar.
- **Media.** El cierre de un aviso quedaba fuera del ciclo de Tab del modal y la expulsión dejaba timers activos. Ahora los avisos del modal tienen su propio espacio dentro del diálogo. La caducidad se pausa con foco o puntero y la expulsión cancela los timers sin quitar el aviso enfocado.

## Evidencia de los criterios

| Criterio | Estado inicial | Evidencia del seguimiento |
|---|---|---|
| Carga, generación, cancelación, éxito, error, guardado y copias | Parcial | La integración recorre carga, PDF y vista parcial, autoguardado, ramos y proyectos, cancelación antes de Gemini y durante su respuesta, guardado tardío y copia desde Opciones. Un fallo de registro confirma la presencia del archivo y muestra advertencia. |
| Emisión nativa útil, compatible y privada | Comprobado con simulación | Los tests cuentan avisos en primer y segundo plano, con preferencia deshabilitada y sin soporte. Comprueban texto genérico, clic simulado y resultado de copia conservado si falla el notificador. |
| Accesibilidad y caducidad | Parcial | La prueba empaquetada verifica Tab, Mayús+Tab y Enter en el modal, foco al cerrar, tres avisos como máximo y contraste mínimo 4,5:1 en claro y oscuro. El test con temporizadores simulados verifica la pausa y la limpieza. |
| Pruebas actuales y coordinación con H5P-9 | Parcial | El seguimiento documenta la auditoría y corrige el aviso basado en tiempo. H5P-9 conserva las etapas detalladas y el flujo de exportación. |

## Ejecución

- Línea base `2272ea5`. Suite backend **89/89**, empaquetado Linux e integración empaquetada aprobados.
- Seguimiento `0d4342d`. Sintaxis de los JavaScript modificados verificada con `node --check`. Suite backend **91/91** con Node.js 26.13.1. El empaquetado Linux y la integración gráfica completaron el recorrido con Electron y almacenamiento real en un perfil temporal.
- Algunas corridas de desarrollo agotaron la espera del visor PDF. El smoke desactiva la limitación de trabajo en segundo plano de su ventana para reducir la dependencia del compositor. La aplicación distribuida conserva su configuración de ejecución.
- El empaquetado informó un aviso del script de instalación opcional de Tesseract y el entorno gráfico informó un aviso de caché Fontconfig. Se completó la validación empaquetada.

## Reproducción

Usar una sesión gráfica Linux para los últimos dos comandos. La prueba empaquetada usa una copia de la distribución con perfil temporal, documentos sintéticos, diálogos, Gemini y notificador simulados.

```sh
npm ci --prefix backend
npm ci --prefix frontend
npm test --prefix backend
npm run package:linux --prefix frontend
npm run test:packaged --prefix frontend
```

La publicación de etapas específicas y el flujo dedicado de exportación corresponden a [H5P-9](https://h5p-rag-generator.atlassian.net/browse/H5P-9).
