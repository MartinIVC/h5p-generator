// ============================================================================
// chunker.js
// Extracción de texto y preparación para RAG / Generación H5P.
// Soporta: PDF, TXT, MD, CSV, DOCX, DOC, XLSX, XLS, PPTX, ODP, ODT, ODS, RTF.
// ============================================================================

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const WordExtractor = require('word-extractor');
const XLSX = require('xlsx');
const { parseOffice } = require('officeparser');

/**
 * Normaliza y limpia el texto extraído eliminando saltos de línea y espacios redundantes.
 * @param {string} text
 * @returns {string}
 */
function cleanText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/\r\n/g, '\n')       // Estandariza los saltos de línea al formato universal
        .replace(/\r/g, '\n')
        .replace(/\n{3,}/g, '\n\n')   // Si hay 3 o más saltos de línea seguidos, los reduce a 2
        .replace(/[ \t]{2,}/g, ' ')   // Si hay muchos espacios en blanco seguidos, deja solo 1
        .trim();                      // Borra espacios en blanco al inicio y al final
}

/**
 * Extrae texto de un archivo según su tipo.
 * @param {string} filePath - Ruta absoluta al archivo.
 * @param {object} [options={}] - Configuración opcional de extracción.
 * @returns {Promise<string>} Texto extraído y limpio.
 */
async function extractTextFromFile(filePath, options = {}) {
    const config = Object.assign({ maxFileSizeMb: 50 }, typeof options === 'object' ? options : {});

    // 1. Verificación de existencia del archivo
    if (!fs.existsSync(filePath)) {
        throw new Error(`El archivo no existe en la ruta: ${filePath}`);
    }

    // 2. Verificación de tamaño máximo físico (evita desbordamiento de memoria)
    const stats = fs.statSync(filePath);
    const maxSizeBytes = config.maxFileSizeMb * 1024 * 1024;
    if (stats.size > maxSizeBytes) {
        throw new Error(
            `Archivo rechazado: El tamaño (${(stats.size / (1024 * 1024)).toFixed(1)} MB) excede el máximo permitido de ${config.maxFileSizeMb} MB.`
        );
    }

    const ext = path.extname(filePath).toLowerCase();
    let rawText = '';

    // 3. Extracción según extensión de archivo
    switch (ext) {
        // --- Texto plano y Markdown ---
        case '.txt':
        case '.md':
        case '.csv': {
            rawText = fs.readFileSync(filePath, 'utf-8');
            break;
        }

        // --- Documentos PDF ---
        case '.pdf': {
            const dataBuffer = fs.readFileSync(filePath);
            const pdfData = await pdfParse(dataBuffer);
            rawText = pdfData.text;
            break;
        }

        // --- Word Moderno (.docx) ---
        case '.docx': {
            const result = await mammoth.extractRawText({ path: filePath });
            rawText = result.value || '';
            break;
        }

        // --- Word Clásico 97-2003 (.doc) ---
        case '.doc': {
            const wordExtractor = new WordExtractor();
            const extracted = await wordExtractor.extract(filePath);
            rawText = extracted.getBody() || '';
            break;
        }

        // --- Hojas de cálculo (.xlsx, .xls) ---
        case '.xlsx':
        case '.xls': {
            const workbook = XLSX.readFile(filePath);
            const sheetTexts = [];
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                const csvData = XLSX.utils.sheet_to_csv(sheet);
                if (csvData && csvData.trim()) {
                    sheetTexts.push(`--- Hoja: ${sheetName} ---\n${csvData}`);
                }
            }
            rawText = sheetTexts.join('\n\n');
            break;
        }

        // --- Presentaciones y suites ofimáticas (.pptx, .odp, .odt, .ods, .rtf) ---
        case '.pptx':
        case '.odp':
        case '.odt':
        case '.ods':
        case '.rtf': {
            const officeDoc = await parseOffice(filePath);
            const converted = await officeDoc.to('text');
            rawText = converted && converted.value ? converted.value : '';
            break;
        }

        default:
            throw new Error(
                `Formato no soportado (${ext}). Formatos admitidos: PDF, Word (DOC/DOCX), Planillas (XLS/XLSX), Presentaciones (PPTX), OpenDocument (ODP/ODT/ODS) y Texto (TXT/MD/CSV/RTF).`
            );
    }

    // 4. Limpieza y normalización de texto
    const cleaned = cleanText(rawText);

    // 5. Validación de legibilidad mínima (detecta archivos corruptos o imágenes vacías)
    if (cleaned.length < 5) {
        throw new Error(
            `No se pudo extraer texto legible del archivo ${path.basename(filePath)}. Verifique que no sea un documento escaneado sólo como imagen o protegido con contraseña.`
        );
    }

    return cleaned;
}

// ============================================================================
// EXPORTACIÓN DEL MÓDULO
// ============================================================================
module.exports = {
    extractTextFromFile,
    cleanText
};
