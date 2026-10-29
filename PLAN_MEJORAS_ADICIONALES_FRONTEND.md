# Plan complementario de mejoras para la interfaz

Fecha: 29 de octubre de 2026. Estado: propuesta.

Este documento complementa [el plan de rediseño principal](PLAN_MEJORAS_FRONTEND.md). Se enfoca en continuidad del trabajo, resguardo de datos y productividad cotidiana; no repite los cambios visuales y de accesibilidad ya implementados ni vuelve a diseñar el selector y la exportación H5P pendientes.

## 1. Hallazgos que motivan las propuestas

| Observación en el código actual | Oportunidad para el usuario |
| --- | --- |
| `frontend/js/upload.js` mantiene los archivos seleccionados y las instrucciones solo en memoria durante la sesión. | Recuperar un borrador después de cerrar la aplicación o de una interrupción. |
| `backend/storage.js` persiste ramos y proyectos en un único `academic_store.json`, pero no hay una pantalla para exportar o restaurar esos datos. La configuración también contiene la clave de Gemini. | Dar control al usuario sobre copias de seguridad sin incluir credenciales por accidente. |
| La biblioteca busca ramos; la búsqueda de proyectos aparece dentro del detalle de cada ramo. | Encontrar un proyecto sin recordar primero a qué ramo pertenece. |
| Los ramos no tienen estado de favorito o archivado ni guardan cuándo se abrieron por última vez. | Mantener a mano los ramos del período actual cuando crece el catálogo. |
| La entrada inicial depende del estado vacío y de explorar los controles disponibles. | Ayudar a docentes nuevos a completar las primeras tareas sin agregar pasos obligatorios. |
| El borrado de ramos y proyectos quita sus registros de las listas; no hay papelera ni opción de deshacer. | Recuperarse de un borrado accidental con una acción reversible. |

## 2. Principios de diseño

- Mantener el trabajo del docente recuperable y hacer visible qué se guardó, dónde y cuándo.
- No copiar documentos ni enviar contenido a servicios externos sin una acción informada del usuario.
- Hacer reversible el ordenamiento y la organización; archivar no debe borrar ni mover archivos.
- Permitir llegar a las acciones frecuentes con ratón, teclado y tecnologías de asistencia.
- Mostrar estados verificables. No confundir una clave guardada con una conexión comprobada ni un registro con un archivo disponible.

## 3. Propuestas

### 3.1 Borradores recuperables del asistente

**Problema:** las instrucciones y la selección viven en el estado JavaScript de la pantalla. Si la aplicación se cierra o se reinicia, el usuario debe reconstruir el trabajo.

**Experiencia propuesta:**

- Guardar automáticamente el ramo, las instrucciones y los nombres/tamaños de los documentos elegidos como borrador local, con una hora de última actualización visible.
- Indicar junto a la acción de borrador qué campos y metadatos quedan guardados en este equipo; el contenido de los documentos no se copia ni se envía al guardar el borrador.
- Al volver a la aplicación, ofrecer «Continuar borrador», «Ver borradores» y «Descartar». No abrir ni enviar documentos automáticamente.
- Si el borrador requiere archivos que ya no están disponibles, conservar las instrucciones y permitir volver a seleccionarlos uno por uno.
- Al iniciar un proyecto nuevo, preguntar si hay cambios sin terminar; conservar el borrador actual al cambiar de ramo.
- Permitir eliminar un borrador desde su propia tarjeta y mostrar una confirmación solo si contiene cambios.

**Privacidad y dependencia técnica:** un objeto `File` no se debe asumir serializable entre sesiones. La primera versión puede guardar solo metadatos y pedir que se seleccionen de nuevo los documentos al reanudar. Si más adelante se ofrece copiar documentos a una carpeta de trabajo, debe ser una opción explícita con ubicación, tamaño y política de borrado visibles. El acceso al sistema de archivos debe mantenerse detrás de IPC validado, nunca exponerse directamente al renderer.

**Criterios de aceptación:** el borrador reaparece después de reiniciar; las instrucciones no se pierden si falta un archivo; un borrador de un ramo no se mezcla con el de otro; un error de guardado muestra una salida clara y no afirma que el borrador quedó guardado.

### 3.2 Copia de seguridad y restauración de datos

**Problema:** los datos locales no cuentan con una función de exportación/importación visible y el archivo de almacenamiento combina datos académicos con configuración sensible.

**Experiencia propuesta:** agregar en Configuración una sección «Datos y copias de seguridad» con:

- «Crear copia de seguridad» que permita elegir una ubicación y confirme fecha, cantidad de ramos y proyectos incluidos.
- «Restaurar copia» con previsualización de contenido y validación antes de aplicar cambios; mostrar si reemplazará o combinará registros y cómo se resolverán duplicados.
- Una copia automática previa a cualquier restauración que vaya a reemplazar datos existentes.
- Un resultado explícito con la ubicación del archivo y acciones para volver a la pantalla principal o abrir la carpeta.

**Formato y privacidad:** usar un formato versionado y validado. Excluir siempre la clave de Gemini, incluso si está cifrada. La copia inicial incluirá metadatos de ramos y proyectos; no incluirá los documentos fuente ni los archivos `.h5p` externos. Explicar esa limitación antes de crearla. Rechazar archivos inválidos sin modificar el almacén actual.

**Criterios de aceptación:** una copia puede restaurarse en otra instalación compatible; la previsualización detecta el formato antes de escribir; una restauración fallida deja intactos los datos actuales; la clave de Gemini nunca aparece en el archivo exportado.

### 3.3 Búsqueda global y acceso rápido

**Problema:** para buscar proyectos hay que abrir cada ramo y usar su buscador local.

**Experiencia propuesta:**

- Incorporar una búsqueda global accesible desde la barra superior y con `Ctrl/Cmd + K`.
- Agrupar resultados en «Ramos» y «Proyectos», mostrando para cada proyecto su ramo, tipo y fecha.
- Permitir abrir un ramo o mostrar la ubicación de un `.h5p` desde el resultado, con un mensaje útil si el archivo ya no existe.
- Mostrar sugerencias recientes de ramos/proyectos al abrir, coincidencias parciales mientras se escribe y una salida para limpiar la consulta.
- Añadir un pequeño conjunto de acciones directas: crear ramo, reanudar borrador y abrir Configuración. Mantener acciones destructivas fuera de esta búsqueda.

**Accesibilidad:** implementar patrón de cuadro de búsqueda con resultados navegables por flechas, selección con Enter, cierre con Escape, foco visible y anuncios del número de coincidencias. En ventanas compactas, los resultados deben desplazarse sin tapar los botones de cierre.

**Criterios de aceptación:** la búsqueda encuentra un proyecto sin conocer su ramo; cada resultado identifica claramente su contexto; teclado y puntero permiten completar la acción; una búsqueda vacía y una sin coincidencias tienen mensajes distintos.

### 3.4 Organización de la biblioteca

**Problema:** la biblioteca actual muestra el catálogo completo y no diferencia ramos activos de históricos ni permite guardar accesos frecuentes.

**Experiencia propuesta:**

- Permitir marcar y desmarcar ramos favoritos, con una sección «Favoritos» que no duplique tarjetas en la lista principal.
- Permitir archivar un ramo al cerrar un período. Los archivados quedan ocultos de la vista principal, pero se pueden consultar y reactivar.
- Ofrecer orden por nombre, período y último acceso. Recordar el orden elegido.
- Mostrar cantidades pequeñas y útiles: favoritos, ramos activos y archivados; evitar paneles de métricas que no conduzcan a una acción.

**Reglas:** archivar conserva proyectos, historial y archivos. El último acceso solo se actualiza cuando el usuario abre el ramo. Favoritos y orden se guardan localmente; el estado de archivo se almacena junto con el ramo.

**Criterios de aceptación:** un ramo archivado se encuentra y se puede reactivar; las búsquedas respetan el filtro activo; la sección de favoritos no repite resultados; ninguna operación de organización altera el historial de proyectos.

### 3.5 Inicio guiado, breve y opcional

**Problema:** una pantalla vacía orienta la primera creación de un ramo, pero no explica el recorrido completo ni cómo preparar los requisitos antes de empezar.

**Experiencia propuesta:** mostrar una lista de inicio de tres acciones que se pueda cerrar y volver a abrir desde Ayuda:

1. Crear o elegir un ramo.
2. Añadir un documento PDF o TXT e instrucciones.
3. Revisar el requisito de configuración de generación cuando esté disponible en esa versión.

Indicar el progreso solo con estados concretos («Listo», «Pendiente»), sin porcentajes. Permitir omitir la guía. Ofrecer un ejemplo de ramo demostrativo solo si puede crearse y eliminarse por separado sin modificar datos reales del usuario.

**Criterios de aceptación:** la guía no bloquea la biblioteca; se puede cerrar y reabrir; cada paso lleva al lugar correcto; no afirma que una actividad se generó si solo se guardó una clave o un borrador.

### 3.6 Papelera y recuperación de eliminaciones

**Problema:** las confirmaciones informan del borrado, pero una vez que el registro sale de la lista no existe recuperación desde la interfaz.

**Experiencia propuesta:**

- Convertir el borrado de ramos y proyectos en archivado temporal del registro, con una sección «Papelera» y fecha de eliminación.
- Ofrecer «Restaurar» y «Eliminar definitivamente» con una confirmación distinta para la acción irreversible.
- Definir un período de conservación y comunicarlo antes de activar borrado automático. No eliminar archivos `.h5p` desde la papelera sin una acción separada y explícita.
- Si se restaura un ramo cuyos proyectos quedaron sin asignar, devolverlos al ramo solo cuando aún no se hayan reasignado a otro.

**Dependencia técnica:** requiere cambiar el modelo del almacén y definir cómo migrar los registros existentes. Debe coordinarse con la vista «Sin Asignar» ya identificada en el plan principal para evitar que una restauración cree duplicados o esconda proyectos.

**Criterios de aceptación:** se puede restaurar cada tipo de registro; el borrado definitivo explica el efecto sobre el archivo físico; los proyectos reasignados no cambian de ramo al restaurar el ramo anterior.

## 4. Priorización propuesta

| Fase | Prioridad | Entrega | Esfuerzo | Dependencia principal |
| --- | --- | --- | --- | --- |
| A. Recuperar trabajo | P0 | Borradores locales y reanudación segura | M | Definir persistencia de metadatos y revalidación de archivos. |
| B. Resguardar datos | P0 | Exportación y restauración con validación | M–L | IPC para diálogos de archivo y formato versionado del almacén. |
| C. Encontrar y organizar | P1 | Búsqueda global, acceso rápido, favoritos y archivo | M | Índices de búsqueda sobre ramos/proyectos y nuevos campos de organización. |
| D. Acompañar el primer uso | P1 | Lista inicial opcional y ayuda reabrible | S–M | Definir qué requisitos están realmente disponibles en cada versión. |
| E. Recuperación ante errores | P2 | Papelera y restauración de eliminaciones | L | Migración del almacén y reglas coherentes con proyectos sin asignar. |

Se recomienda empezar por borradores y copias de seguridad. Reducen el costo de perder trabajo y habilitan sesiones largas antes de añadir más filtros o atajos. La búsqueda global y la organización de ramos pueden entregarse después en cambios separados. La papelera debe esperar hasta acordar el modelo de reasignación y restauración de proyectos.

## 5. Verificación de experiencia

Revisar cada entrega con datos de ejemplo y con un almacén existente, no solo con una instalación vacía:

- Reanudar un borrador con todos los archivos disponibles y con uno que fue movido o eliminado.
- Crear una copia, restaurarla en una instalación limpia y probar un archivo corrupto, una versión desconocida y un caso con registros duplicados.
- Confirmar que la clave de Gemini no se exporta y que no se copian documentos fuente por sorpresa.
- Buscar ramos y proyectos con nombres parecidos, sin coincidencias y con archivos faltantes; operar con teclado.
- Archivar, buscar y reactivar ramos de varios períodos sin cambiar sus proyectos.
- Eliminar y restaurar un ramo con proyectos, uno sin proyectos y uno cuyos proyectos fueron reasignados.
- Comprobar que las acciones críticas explican si modifican un registro local, un archivo físico o ambos.

## 6. Fuera del alcance de este complemento

- Implementar el generador, selector de tipos, revisión y empaquetado H5P; siguen condicionados a la integración funcional del plan principal.
- Rehacer colores, tipografía, ilustraciones, animaciones, responsive y diálogos ya tratados allí.
- Sincronizar datos entre equipos o crear cuentas. La primera copia se mantiene local y el usuario decide si mueve el archivo.
