# Plan de mejora del diseño del frontend

Fecha: 29 de octubre de 2026. Estado: implementación parcial registrada.

### Estado de ejecución

La rama `codex/frontend-design-polish` implementa la continuidad segura del recorrido actual y la base visual creativa en las pantallas existentes. La biblioteca, el detalle de ramo, la carga, la configuración, los diálogos y la vista previa comparten ahora estados de interacción más claros, manejo de foco y efectos suaves con opción de movimiento reducido. La carga está limitada a PDF/TXT, que son los formatos extraídos por el backend.

Queda pendiente revisar visualmente la aplicación en ambos temas y tamaños de ventana, completar una vista accesible para los proyectos «Sin Asignar» y desarrollar/conectar el selector de actividad y la exportación H5P. La generación real depende de esa integración y no se presenta como disponible en esta entrega.

| Fase | Estado | Resultado |
| --- | --- | --- |
| 0. Línea base | Pendiente de verificación visual | El diagnóstico de código está documentado; no se generaron capturas ni se evaluó con usuarios. |
| 1. Continuidad y acceso | Implementada en los flujos existentes | Se corrigen estados vacíos, validación de formatos, foco/teclado de diálogos y navegación hacia el selector pendiente. |
| 2. Base visual | Implementada en código | Se añaden identidad de taller docente, motivos de fichas, tarjetas, estados, tokens de movimiento y alternativa reducida. |
| 3. Pantallas existentes | Implementada con verificación visual pendiente | Se actualizan biblioteca, detalle, carga, configuración, diálogos y vista previa. |
| 4. Asistente completo | Pendiente de integración funcional | Selector, generación, revisión y exportación siguen sujetos a capacidades reales del generador. |
| 5. Ajustes por uso | Pendiente | Requiere evidencia de uso con docentes. |

## 1. Objetivo y alcance

Convertir el frontend en una herramienta docente más clara, creativa y consistente: encontrar un ramo, preparar material y entender cómo avanzar hacia una actividad H5P. La dirección propuesta es una **biblioteca de ramos con un asistente de creación guiado**, presentada como un taller digital de material educativo, con identidad turquesa y efectos visuales suaves.

El plan se basa en la revisión del HTML, CSS y JavaScript del repositorio. No se ejecutó una evaluación visual de la aplicación ni una prueba con usuarios; los problemas de código indicados están identificados, mientras que la densidad, el contraste y la comodidad visual se deben comprobar durante la primera fase.

La implementación puede hacerse sobre Electron, HTML, CSS y JavaScript actuales. La mejora visual no necesita una migración de framework. La generación y exportación completas se consideran dependencias funcionales separadas cuando corresponda.

## 2. Diagnóstico del estado actual

La aplicación ya tiene una base aprovechable: variables de color, temas claro/oscuro/sistema, iconos SVG, búsqueda de ramos y proyectos, estados vacíos, carga por arrastre, validación de extensiones y previsualización de documentos.

| Hallazgo en el código | Consecuencia para el diseño | Prioridad |
| --- | --- | --- |
| `panel-selector` y `panel-export` están vacíos en `frontend/index.html`; `frontend/js/upload.js` permite avanzar al selector. | El recorrido puede terminar en una pantalla vacía. Se necesita una salida comprensible antes de presentar el asistente como completo. | P0 |
| La carga acepta Word, presentaciones y hojas de cálculo, entre otros; `backend/chunker.js` solo implementa extracción de PDF/TXT. | Los textos prometen una compatibilidad mayor que la implementada. Hay que diferenciar selección, vista previa y procesamiento. | P0 |
| Los modales de ramo, confirmación y opciones parten con `aria-hidden="true"`, pero su apertura no sincroniza ese atributo. | Un diálogo visible puede seguir oculto para lectores de pantalla. | P0 |
| La gestión del foco difiere entre menú y modales; el primer paso del indicador es un `li` con evento de clic. | La navegación por teclado necesita un comportamiento común y controles semánticos. | P0 |
| `global.css` mezcla estilos generales y de todas las pantallas; hay medidas y variantes repetidas. | Cambiar tamaños, separación o estados exige ajustes dispersos. | P1 |
| `.step-panel` limita el ancho a 960 px, aunque inicio y detalle declaran 1080 px dentro de él. | El ancho mayor de esas vistas queda limitado por el contenedor padre. | P1 |
| Las búsquedas de ramos y proyectos regeneran la vista y colocan el cursor al final tras cada entrada. | Editar una consulta en su mitad puede resultar incómodo. | P1 |
| La carga de ramos y proyectos reemplaza los datos por una lista vacía cuando falla la consulta. | Un fallo puede parecer ausencia de contenido; debe existir un estado de error diferenciado. | P1 |
| Conviven diálogos propios con `alert()` y `confirm()` en `courses.js` y `config.js`. | Los errores y confirmaciones cambian de aspecto y contexto. | P1 |
| Aparecen «Ramos», «asignaturas», «proyectos», «actividades» y «Prompt» en distintos lugares. | La terminología necesita una regla común. | P1 |
| Existen animaciones, pero no una regla para `prefers-reduced-motion`. | Falta una variante con movimiento reducido. | P1 |

**Prioridades:** P0 = continuidad y acceso al flujo; P1 = rediseño principal; P2 = mejoras posteriores según uso real.

## 3. Dirección visual propuesta

### Identidad, jerarquía y componentes

| Elemento | Decisión propuesta |
| --- | --- |
| Color | Mantener el turquesa como acento principal. Reservar colores semánticos para error, advertencia, información y éxito; acompañarlos siempre de texto o icono. |
| Superficies | Fondo suave con halos de color estáticos, tarjetas inspiradas en portadas de cuadernos y elevación ligera. Concentrar la decoración en encabezados y acentos para mantener despejada la lectura. |
| Tipografía | Mantener Titillium Web inicialmente. Probar cuerpo de 16–17 px, títulos de vista de 28–32 px, títulos de tarjeta de 18–20 px y texto auxiliar de 14 px. Definir tamaños en `rem`. |
| Espaciado | Usar una escala de 4, 8, 12, 16, 24 y 32 px. Aplicar 24 px entre secciones y 16–24 px dentro de tarjetas según el ancho disponible. |
| Bordes | Unificar radios: 8 px en controles, 12 px en tarjetas y 16 px en diálogos. |
| Botones | Una acción principal por sección de trabajo; variantes secundaria, discreta y destructiva. Altura objetivo de 44 px para controles frecuentes. |
| Iconos | Mantener SVG de trazo consistente, normalmente de 20–24 px. Añadir texto a acciones importantes y nombres accesibles específicos a botones de icono. |
| Estados | Definir normal, hover, foco, seleccionado, deshabilitado y ocupado para cada componente interactivo. Explicar junto al control por qué una acción está deshabilitada. |
| Movimiento | Respuestas de controles de 120–160 ms y transiciones de vistas de 180–240 ms; una celebración puntual puede durar hasta 600 ms. Incorporar una variante reducida y mantener disponibles las acciones durante las transiciones. |

Extender los tokens actuales con variables de espacio, tipografía, radios, sombras y estados. Medir el contraste de las combinaciones reales en ambos temas antes de fijar la paleta final. Como metas de diseño, usar al menos 4,5:1 en texto normal y 3:1 en texto grande y controles relevantes; esto no constituye una certificación de accesibilidad.

La fuente se carga actualmente desde Google Fonts. Evaluar distribuirla localmente, verificando su licencia, para mantener la apariencia cuando no haya conexión.

Regla de lenguaje: usar «ramo» para la agrupación académica, «actividad» para el contenido educativo y «proyecto exportado» para su registro en el historial. Usar «instrucciones» en lugar de «prompt» y «Configuración» en lugar de alternar con «Opciones». Mantener un mismo formato de fechas en español de Chile.

### Composición de escritorio

- Barra superior compacta con nombre de la aplicación, acceso claro a «Mis ramos» y «Configuración». Las dos opciones actuales no justifican por sí solas una barra lateral permanente.
- Un solo encabezado principal por vista. En el asistente, mostrar el ramo como contexto breve y el título del paso como contenido principal.
- Ancho máximo propuesto de 1080 px para biblioteca/detalle y 960 px para el asistente, aplicado en el contenedor correcto.
- En pantallas amplias, tarjetas en dos o tres columnas según su ancho mínimo legible. En ventanas estrechas o con zoom, apilar controles y contenido.
- Mover el indicador de pasos al encabezado del asistente y agrupar «Volver» y «Continuar» en una zona de acciones coherente. Evitar dos franjas inferiores que consuman altura.
- Mantener las acciones alcanzables en 840 × 600. Si se usa una barra de acciones fija, reservar su espacio y comprobar que no cubra campos ni el foco.

Esquema orientativo de la biblioteca:

```text
Generador H5P                         Mis ramos   Configuración

Mis ramos                                        [+ Nuevo ramo]
Organiza tu material y tus actividades.

[ Buscar por nombre, código o semestre… ]          8 ramos

[ Código · Semestre ]    [ Código · Semestre ]
[ Nombre del ramo  ]     [ Nombre del ramo  ]
[ 3 actividades    ]     [ 1 actividad      ]
[ Abrir ramo  →    ]     [ Abrir ramo  →    ]
```

### Concepto creativo: un taller digital docente

La interfaz debe evocar un espacio donde el material de estudio se transforma en actividades. Usar un lenguaje visual propio de **cuadernos, fichas y hojas superpuestas**, reinterpretado con geometría simple, superficies limpias y pequeños detalles de color.

- **Fondo con profundidad:** colocar dos halos radiales estáticos, turquesa y lavanda, en los extremos del encabezado. Probar opacidades de 6–10 % en claro y 4–8 % en oscuro. Mantener las áreas de texto sobre superficies de contraste estable.
- **Encabezado ilustrado:** acompañar el título de la biblioteca con una pequeña composición SVG de hojas y fichas. En ventanas pequeñas, reducirla u ocultarla para dar espacio al contenido; su presencia no debe aumentar mucho la altura del encabezado.
- **Ramos como portadas:** dar a cada tarjeta un lomo lateral del color elegido y un motivo geométrico discreto en la esquina superior. Repetir ese motivo en el detalle del ramo y su contexto dentro del asistente para que el usuario reconozca dónde está.
- **Paleta con personalidad:** combinar el turquesa principal con lavanda y tonos salvia en ilustraciones y motivos. Reservar rojo y colores de advertencia para estados funcionales, y mantener los colores decorativos fuera del significado de éxito/error.
- **Carga como bandeja de documentos:** representar el área de arrastre con dos o tres hojas SVG superpuestas. Cuando se añadan archivos, transformar la composición en una bandeja compacta junto a la lista, dando protagonismo al material real.
- **Tipos de actividad con ejemplos visuales:** acompañar cada opción disponible de una miniatura esquemática, como alternativas de respuesta o una ficha de pregunta. Identificarla como ejemplo y mantener la misma estructura para todas las opciones.
- **Estados vacíos ilustrados:** diseñar tres variantes de la misma familia: cuaderno abierto para el primer ramo, fichas por completar para un ramo sin actividades y lupa sobre una hoja para una búsqueda sin resultados. Cada una conserva su mensaje y acción útil.
- **Tema oscuro propio:** usar superficies de tono tinta y acentos turquesa suaves; definir bordes, halos y sombras específicos. El aspecto debe conservar la profundidad y los motivos del tema claro.

Las ilustraciones se pueden construir con SVG y CSS locales. Los elementos decorativos serán no interactivos, con `aria-hidden="true"` y `pointer-events: none`; las explicaciones necesarias seguirán presentes como texto.

### Efectos y respuesta visual a las acciones

| Momento | Efecto propuesto | Duración y activación | Variante con movimiento reducido |
| --- | --- | --- | --- |
| Entrar a una vista | Aparición por opacidad y desplazamiento vertical de hasta 6 px. Mostrar las tarjetas como un grupo para evitar esperas acumuladas. | 180–220 ms al navegar; no repetir al escribir en el buscador. | Mostrar el contenido directamente. |
| Explorar un ramo | Elevar la tarjeta 2 px y reforzar suavemente su borde y sombra; desplazar la flecha de «Abrir ramo» 2 px. | 140–160 ms con puntero preciso. Con teclado, destacar borde y foco de la acción. | Cambiar borde y foco sin desplazamiento. |
| Pulsar una acción | Oscurecer ligeramente el fondo y comprimir el botón hasta `scale(0.98)` como respuesta a la pulsación. Mantener su espacio y área de interacción. | 120 ms; la acción se ejecuta inmediatamente. | Cambiar el fondo sin escala. |
| Arrastrar archivos | Expandir ligeramente la separación entre las hojas ilustradas, iluminar el borde y mostrar «Suelta tus documentos aquí». | 160 ms al entrar y salir del área; sin pulsación continua. | Borde y mensaje estáticos. |
| Añadir un archivo | Incorporar la nueva fila con opacidad y un desplazamiento de hasta 4 px, acompañada del resumen actualizado. | 160–180 ms; animar solo los archivos nuevos. | Incorporación directa y anuncio del resumen. |
| Avanzar en el asistente | Completar la línea del paso anterior y reemplazar el número por un icono de verificación; transición breve al siguiente panel. | 200–240 ms después de validar el paso. La línea indica pasos, no porcentaje de generación. | Actualización inmediata del indicador y del panel. |
| Abrir un diálogo | Aparecer con opacidad y escala de `0.98` a `1`, sobre un fondo oscurecido. | 180 ms al abrir y 120 ms al cerrar; el foco se gestiona desde el inicio. | Apertura y cierre directos. |
| Cambiar de tema | Transición suave de los colores de las superficies y del texto, manteniendo estables tamaños y posiciones. | 180 ms solo tras un cambio solicitado por el usuario; aplicar el tema inicial directamente. | Cambio inmediato. |
| Confirmar la exportación | Mostrar una marca de verificación y un pequeño destello de 6–8 formas geométricas alrededor del icono de éxito. Mantener visible el resumen y sus acciones. | Una sola vez, hasta 600 ms, después de confirmar el guardado del archivo y su registro. Depende de la integración de exportación. | Icono de éxito estático con el mismo mensaje. |

Los efectos deben reforzar la acción realizada y resultar agradables también después de muchas repeticiones. Mantener el fondo en reposo, evitar parallax o inclinación de tarjetas que sigan al cursor y no añadir movimiento a las áreas de lectura. Las cargas reales pueden usar un indicador indeterminado acompañado de texto, con representación estática en la variante reducida.

### Implementación y entregables de la propuesta creativa

- Definir tokens compartidos para duración, curva de transición, desplazamiento, elevación y opacidad decorativa. Usar una curva de salida suave, por ejemplo `cubic-bezier(0.2, 0, 0, 1)`, para que los componentes respondan rápido y terminen suavemente.
- Priorizar `transform` y `opacity` para movimiento. Usar gradientes estáticos y limitar sombras o cambios de color a componentes pequeños; evitar animar desenfoques de pantalla completa, dimensiones o posiciones que recalculen la distribución.
- Aplicar elevación de tarjetas solo bajo `@media (hover: hover) and (pointer: fine)` y proporcionar siempre estados equivalentes de foco y selección. Ninguna acción dependerá de descubrir un efecto al pasar el cursor.
- Respetar `prefers-reduced-motion` y proponer en Configuración la opción «Efectos visuales: seguir al sistema / reducidos», con preferencia persistente. En modo reducido, conservar todos los mensajes y estados sin desplazamientos ni partículas.
- Preparar una lámina de referencia con biblioteca, carga de material y diálogo en claro/oscuro; incluir tarjetas en reposo, foco y selección. Usarla para validar la dirección antes de extenderla al resto de las vistas.
- Crear una pequeña muestra de componentes dentro del entorno de desarrollo para revisar animaciones, ilustraciones y variantes reducidas. Incorporar después los mismos tokens y estilos a las pantallas reales.

## 4. Mejoras por pantalla

### 4.1 Biblioteca de ramos

- Mantener «Nuevo ramo» como acción principal, con una explicación breve del propósito de la pantalla.
- Ordenar las tarjetas por jerarquía: nombre, código/semestre, descripción breve, cantidad de actividades y acceso al detalle. Usar el color del ramo como acento secundario.
- Incorporar un control nativo «Abrir ramo» y separar su interacción de editar/eliminar. Evitar que Enter o Espacio sobre una acción secundaria active también la tarjeta.
- Dar a cada acción un nombre contextual, por ejemplo «Editar Álgebra», en vez de repetir una etiqueta indistinguible en todas las tarjetas.
- Añadir etiqueta accesible al buscador y actualizar solo los resultados y el contador, conservando foco y selección del texto.
- Conservar los estados «Sin ramos» y «Sin resultados», con acciones distintas: crear el primero o limpiar la búsqueda.
- Distinguir carga, vacío y error de consulta, también en proyectos. Ofrecer «Reintentar» ante un fallo y conservar los datos previos durante una recarga.
- Mantener el aviso de clave pendiente como información secundaria. La biblioteca debe seguir siendo útil antes de configurar Gemini.

### 4.2 Detalle del ramo y proyectos

- Simplificar la navegación de regreso y evitar repetir el nombre completo del ramo en varios encabezados prominentes.
- Destacar «Crear actividad». Presentar la ayuda de Lumi como acción informativa secundaria, identificando las capacidades todavía pendientes.
- Unificar las tarjetas de proyectos: título, tipo H5P, fecha, documentos de origen y acción «Ver en carpeta».
- Mostrar un estado claro cuando no haya ruta registrada o el archivo no exista. Reutilizar `academicAPI.verifyFileExists` donde corresponda antes de ofrecer una acción que pueda fallar.
- Diferenciar «Eliminar registro» de eliminar un archivo. Mantener explícito el efecto de borrar un ramo sobre sus registros y archivos.
- Verificar que los proyectos que queden «Sin asignar» después de eliminar un ramo tengan un acceso visible antes de prometer esa recuperación en la confirmación.
- Dejar filtros por tipo, semestre u orden configurable como P2. La búsqueda existente debe funcionar bien antes de añadir más controles.

### 4.3 Asistente: material e instrucciones

- Cambiar «Carga de Documentos y Prompt» por «Material e instrucciones» y «Instrucciones o Prompt» por «Instrucciones para la actividad (opcional)».
- Ofrecer ejemplos breves de instrucciones, como «Evalúa los conceptos principales con preguntas de dificultad media». Si se permite insertarlos, no reemplazar texto escrito sin una acción explícita.
- Mantener la carga por arrastre y el selector de archivos. Evitar un botón interactivo anidado dentro de otro elemento con rol de botón.
- Reducir el protagonismo del estado vacío cuando ya existan documentos; dar prioridad a la lista, los errores y la siguiente acción.
- Mostrar por archivo nombre, formato, tamaño y resultado de validación. Conservar la vista previa y la eliminación individual; informar cuando se omita un duplicado.
- Alinear extensiones y mensajes con las capacidades reales. Como primera opción, permitir para generación solo PDF/TXT hasta que existan más extractores; documentar por separado qué formatos tienen vista previa.
- Mostrar los límites efectivos del procesamiento, incluido el límite de páginas de PDF configurado, sin inventar un máximo de peso que el código no aplique.
- Sustituir instrucciones basadas solo en color, como «elimina los marcados en rojo», por mensajes con nombres o estados explícitos.
- Mantener archivos e instrucciones al retroceder dentro del mismo asistente. Definir cuándo se inicia un borrador nuevo y evitar reutilizar por accidente material de otro ramo.

### 4.4 Asistente: tipo de actividad y exportación

Estas vistas necesitan diseño e implementación nuevos. No existe una integración completa de generación/exportación en el frontend revisado.

- **Medida inmediata P0:** impedir que «Continuar» abra una vista vacía. Mostrar una explicación del paso pendiente y una acción para volver, conservando la selección actual.
- **Tipo de actividad:** diseñar opciones seleccionables con nombre, ejemplo breve y finalidad pedagógica. Mostrar como disponibles únicamente los tipos que soporte el generador integrado.
- **Antes de generar:** mostrar un resumen de documentos, instrucciones y tipo elegido. Solicitar la clave en el momento en que sea necesaria, conservando el borrador al abrir y cerrar configuración.
- **Generación:** diseñar estados de espera, error y reintento. Usar mensajes de fase si existen eventos reales; si no, un indicador indeterminado. No mostrar porcentajes ficticios.
- **Revisión y exportación:** prever revisión del contenido, nombre del archivo y destino. Estas acciones quedan condicionadas al soporte real de generación, edición y empaquetado H5P.
- **Resultado:** ofrecer «Ver en carpeta» y «Volver al ramo» solo tras confirmar el guardado. Separar un fallo al generar, al guardar el archivo o al registrar el proyecto.

### 4.5 Configuración, diálogos y vista previa

- Unificar estructura, separación, títulos y botones de todos los diálogos; sustituir las alertas nativas por validación junto al campo o confirmaciones del mismo sistema visual.
- Mostrar «Guardando…» o «Eliminando…» durante operaciones pendientes, impedir envíos repetidos y conservar los campos si ocurre un error.
- Crear un comportamiento compartido: nombre accesible, visibilidad sincronizada, foco inicial, navegación contenida, cierre con Escape y devolución del foco al control de origen.
- Evitar que el menú cerrado o el fondo de un modal reciban foco. Corregir los roles de diálogo duplicados en configuración.
- Dar a tema y color controles de selección con comportamiento de teclado completo, preferentemente radios nativos, y foco visible.
- Mantener claro/oscuro/sistema y la clave enmascarada. Usar «Clave guardada» como estado mientras no exista una comprobación real de conexión; guardar una clave no demuestra que esté activa.
- Aclarar en el texto de configuración que la generación usa un servicio externo; describir con precisión el tratamiento del material cuando se conecte el flujo.
- En vista previa, conservar navegación entre archivos y contador. Mostrar «Vista previa no disponible para este formato» sin confundirlo con un archivo corrupto o procesable.
- Añadir estados de carga/error y un retorno de foco consistente al cerrar la vista previa.

## 5. Organización técnica para sostener el diseño

| Archivos | Trabajo previsto |
| --- | --- |
| `frontend/css/light.css`, `dark.css` | Ajustar colores por rol y comprobar ambos temas. Mantener los tokens ya usados por las paletas de ramos. |
| `frontend/css/global.css` | Consolidar medidas, estados y efectos; definir tokens de movimiento y su variante reducida. Separar progresivamente estilos base, componentes y vistas cuando se modifiquen. |
| Nuevos recursos en `frontend/assets/illustrations/` | Crear la familia SVG de cuadernos, fichas, bandeja de documentos y estados vacíos; reutilizar motivos y colores de los temas. |
| `frontend/index.html` | Ajustar navegación, estructura del asistente, semántica y contenedores de diálogos. Actualizar enlaces CSS/scripts si se crean módulos. |
| `frontend/js/courses.js` | Mejorar tarjetas, buscadores, mensajes, diálogos y continuidad entre biblioteca, detalle y asistente. |
| `frontend/js/upload.js` | Mejorar carga, instrucciones, validación y navegación; mantener el estado coherente durante el recorrido. |
| `frontend/js/menu.js`, `config.js`, `preview.js` | Aplicar el mismo contrato de foco, cierre, selección y mensajes. |
| Nuevos módulos de UI, por ejemplo `frontend/js/ui/dialog.js` | Centralizar comportamiento compartido únicamente cuando existan varios consumidores reales. |
| Nuevos módulos de selector/exportación | Implementar las pantallas pendientes con estados explícitos; conectar las acciones cuando existan sus capacidades funcionales. |
| `frontend/preload.js`, `index.js` y backend | Dependencia para eventos de generación y guardado. Mantener el acceso a funciones nativas a través del puente de Electron. |

Crear componentes compartidos pequeños para botones, campos, tarjetas, avisos y diálogos. Mantener intactos los datos existentes durante la implementación y usar datos de prueba para verificar las acciones destructivas.

## 6. Secuencia de implementación

El esfuerzo es relativo: **S** = cambio localizado, **M** = varias vistas/componentes, **L** = flujo nuevo o integración. No representa un compromiso de fechas.

| Fase | Prioridad | Entregable | Esfuerzo | Condición para avanzar |
| --- | --- | --- | --- | --- |
| 0. Línea base | P0 | Capturas de las vistas existentes, inventario de componentes y estados, comprobación visual en ambos temas. | S | Se conocen los recortes, desbordamientos y contrastes que requieren ajuste. |
| 1. Continuidad y acceso | P0 | Ningún avance a pantallas vacías; compatibilidad de archivos coherente; diálogos y navegación operables con teclado. | M | Los flujos disponibles tienen salida clara y foco recuperable. |
| 2. Base visual | P1 | Lámina de dirección creativa, tokens de medidas y movimiento, componentes comunes, portadas de ramos, encabezados y ancho por vista. | M | Biblioteca, formulario y carga comparten identidad y estados de interacción en ambos temas. |
| 3. Pantallas existentes | P1 | Biblioteca, detalle, carga, configuración y vista previa actualizados; ilustraciones, transiciones y opción de efectos reducidos. | M | Se supera la matriz de verificación de las funciones actuales, con efectos completos y reducidos. |
| 4. Asistente completo | P1, con dependencia funcional | Selector con ejemplos visuales, revisión/exportación y celebración de éxito; integración real en una entrega separable. | L | Cada acción habilitada corresponde a una capacidad disponible; éxito y celebración solo tras guardado confirmado. |
| 5. Ajustes por uso | P2 | Filtros, densidad alternativa y mejoras derivadas de observación con docentes. | S–M | Hay evidencia de una necesidad y no se agregan controles sin propósito. |

La fase 4 puede diseñarse en paralelo a la 3 una vez acordados los componentes y las capacidades disponibles. Su integración no debe impedir entregar las mejoras de las pantallas actuales.

**Primera entrega recomendada:** fases 0–2, centradas en biblioteca y carga como pantallas representativas, con los arreglos de diálogos aplicados a todas las vistas. Así se establece un diseño coherente y se corrigen los puntos que interrumpen el recorrido.

## 7. Verificación y criterios de aceptación

El frontend no dispone actualmente de una suite automatizada útil: `npm test` es un marcador que termina con error. Para ejecutar este plan, documentar primero una revisión manual reproducible y añadir pruebas de interacción solo para comportamiento crítico.

| Área | Casos que se deben revisar |
| --- | --- |
| Ventana | 840 × 600, 1024 × 720 y 1440 × 900; zoom de 125 %, 150 % y 200 %. Sin recortes ni desplazamiento horizontal global; desplazamiento local permitido para documentos que lo requieran. |
| Temas | Claro, oscuro y sistema; cambio de tema con un modal abierto; contraste de botones, textos auxiliares, avisos y selección. |
| Efectos visuales | Movimiento normal y reducido por sistema/configuración; navegación rápida, búsquedas sucesivas y carga de varios archivos. Sin animaciones reiniciadas por cada pulsación ni bloqueos de acciones. |
| Identidad creativa | Motivos coherentes entre tarjeta, detalle y asistente; ilustraciones adaptadas a ventana pequeña; halos y decoración sin reducir el contraste del contenido. |
| Biblioteca | 0, 1 y 20 ramos; nombres largos; sin código o descripción; consulta sin resultados; edición de búsqueda en la mitad del texto. |
| Proyectos | Lista vacía, títulos largos, ruta ausente y archivo movido; eliminar un registro sin confundirlo con borrar el archivo. |
| Carga | Sin archivos, uno válido, varios, duplicados, extensión no procesable, nombre largo y eliminación del último archivo. |
| Diálogos | Tab, Shift+Tab, Enter, Espacio y Escape; foco visible, título anunciado, fondo inaccesible y retorno del foco. |
| Configuración | Sin clave, guardado pendiente, fallo al guardar y clave guardada; cambio de tema mediante teclado. |
| Asistente futuro | Retroceso con datos conservados; configuración contextual; error/reintento; fallo de guardado; éxito confirmado y registro visible en el ramo. |

Lista de cierre de la mejora:

- [ ] Las vistas comparten tipografía, espaciado, botones, campos y mensajes.
- [ ] La acción principal y el siguiente paso se entienden sin explorar un menú.
- [ ] No quedan pantallas vacías alcanzables desde una acción habilitada.
- [ ] Los formatos, la clave y el resultado de exportación se describen según capacidades comprobadas.
- [ ] Ningún diálogo visible conserva `aria-hidden="true"`; todos tienen nombre y gestión de foco.
- [ ] El teclado permite realizar los flujos actuales sin activar acciones secundarias por accidente.
- [ ] Los errores se explican junto al elemento afectado y los cambios relevantes se anuncian mediante una región accesible.
- [ ] Los controles permanecen alcanzables con ventana pequeña, zoom y nombres largos.
- [ ] Existe una variante con movimiento reducido.
- [ ] La biblioteca y el asistente incorporan la familia visual de cuadernos, fichas y documentos en ambos temas.
- [ ] Las animaciones siguen las duraciones definidas, mantienen disponibles las acciones y no alteran el foco ni reinician al filtrar resultados.
- [ ] La preferencia de efectos reducidos se conserva y elimina desplazamientos, escalas y partículas, manteniendo visibles todos los estados.
- [ ] Se revisa el rendimiento de las transiciones en Electron con 20 ramos y varios archivos; no hay saltos de distribución ni trabajo continuo de animación decorativa cuando la interfaz está en reposo.
- [ ] Se guardan capturas comparables de antes/después en claro y oscuro.
- [ ] Una prueba breve con 3–5 docentes permite observar si encuentran un ramo, adjuntan material y entienden qué hacer después; las dificultades registradas alimentan la siguiente iteración.
