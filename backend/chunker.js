// ============================================================================
// Tarea H5P-11: Implementar lectura de PDF/TXT y fragmentación de texto (Chunking)
// ============================================================================

// 1. IMPORTACIÓN DE LIBRERÍAS
// 'fs' (File System) es nativo de Node. Sirve para leer archivos físicos del disco duro.
const fs = require('fs');
// 'path' es nativo de Node. Sirve para analizar las rutas y extensiones de los archivos.
const path = require('path');
// 'pdf-parse' es la librería externa que instalamos para transformar PDFs a texto puro.
const pdfParse = require('pdf-parse');

/**
 * FUNCIÓN 1: EXTRAER TEXTO
 * Recibe la ruta de un archivo y saca todo el texto que tiene adentro.
 * Incluye la regla de "máximo de páginas" para evitar procesar libros completos por derechos de autor.
 */
async function extractTextFromFile(filePath, maxPages = 30) {
    // Verificamos si el archivo realmente existe en el computador
    if (!fs.existsSync(filePath)) {
        throw new Error(`El archivo no existe en la ruta: ${filePath}`);
    }

    // Obtenemos la extensión del archivo y la pasamos a minúsculas (ej: '.PDF' pasa a '.pdf')
    const ext = path.extname(filePath).toLowerCase();

    // Si el archivo es un bloc de notas (.txt)
    if (ext === '.txt') {
        // Leemos el texto crudo y lo mandamos a la función cleanText para limpiarlo
        const rawText = fs.readFileSync(filePath, 'utf-8');
        return cleanText(rawText);
    }

    // Si el archivo es un PDF 
    if (ext === '.pdf') {
        // Leemos el archivo en formato "Buffer" (datos binarios)
        const dataBuffer = fs.readFileSync(filePath);
        // Usamos la librería pdf-parse para extraer la información
        const pdfData = await pdfParse(dataBuffer);

        // REGLA DE NEGOCIO: Bloqueamos documentos que superen el límite de páginas 
        // Esto protege a la universidad de problemas de propiedad intelectual (Comité de Ética)
        if (pdfData.numpages > maxPages) {
            throw new Error(
                `Archivo rechazado: Tiene ${pdfData.numpages} páginas (máximo permitido para apuntes propios: ${maxPages}).`
            );
        }

        // Retornamos el texto extraído y lo limpiamos
        return cleanText(pdfData.text);
    }

    // Si suben un Word (.docx), un Excel o una imagen, el sistema arroja error
    throw new Error(`Formato no soportado (${ext}). Solo se permiten archivos .pdf o .txt`);
}

/**
 * FUNCIÓN 2: LIMPIAR TEXTO
 * Elimina espacios dobles y saltos de línea basura que suelen quedar al copiar/pegar de un PDF.
 */
function cleanText(text) {
    return text
        .replace(/\r\n/g, '\n')       // Estandariza los saltos de línea al formato universal
        .replace(/\n{3,}/g, '\n\n')   // Si hay 3 o más saltos de línea seguidos, los reduce a 2
        .replace(/[ \t]{2,}/g, ' ')   // Si hay muchos espacios en blanco seguidos, deja solo 1
        .trim();                      // Borra espacios en blanco al inicio y al final de todo el texto
};

// ============================================================================
// EXPORTACIÓN DEL MÓDULO
// ============================================================================
module.exports = {
    extractTextFromFile,
    cleanText
};