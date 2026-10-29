const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { extractTextFromFile, cleanText } = require('../chunker');

describe('Módulo Chunker - Extracción y Normalización de Texto', () => {
    let tmpDir;

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-chunker-tests-'));
    });

    after(() => {
        if (tmpDir && fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    describe('cleanText', () => {
        it('debe estandarizar saltos de línea y colapsar espacios múltiples', () => {
            const raw = '   Línea 1\r\n\r\n\r\nLínea 2   con   muchos espacios.   ';
            const cleaned = cleanText(raw);
            assert.strictEqual(cleaned, 'Línea 1\n\nLínea 2 con muchos espacios.');
        });

        it('debe manejar entradas vacías o nulas sin lanzar error', () => {
            assert.strictEqual(cleanText(null), '');
            assert.strictEqual(cleanText(''), '');
            assert.strictEqual(cleanText('   '), '');
        });
    });

    describe('extractTextFromFile - Formatos de texto plano', () => {
        it('debe extraer y limpiar archivos .txt', async () => {
            const filePath = path.join(tmpDir, 'documento.txt');
            fs.writeFileSync(filePath, 'Párrafo uno.\n\nPárrafo dos con texto docente.');

            const result = await extractTextFromFile(filePath);
            assert.strictEqual(result, 'Párrafo uno.\n\nPárrafo dos con texto docente.');
        });

        it('debe extraer y limpiar archivos .md', async () => {
            const filePath = path.join(tmpDir, 'documento.md');
            fs.writeFileSync(filePath, '# Título de la clase\n\n- Concepto A\n- Concepto B');

            const result = await extractTextFromFile(filePath);
            assert.match(result, /# Título de la clase/);
            assert.match(result, /Concepto A/);
        });

        it('debe extraer y limpiar archivos .csv', async () => {
            const filePath = path.join(tmpDir, 'preguntas.csv');
            fs.writeFileSync(filePath, 'id,pregunta,respuesta\n1,¿Qué es H5P?,Interactivo');

            const result = await extractTextFromFile(filePath);
            assert.match(result, /id,pregunta,respuesta/);
            assert.match(result, /¿Qué es H5P\?,Interactivo/);
        });
    });

    describe('extractTextFromFile - Hojas de cálculo (.xlsx, .xls)', () => {
        it('debe extraer contenido estructurado de archivos .xlsx', async () => {
            const filePath = path.join(tmpDir, 'calificaciones.xlsx');
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([
                ['Código', 'Ramo', 'Nota'],
                ['INF-101', 'Programación', '6.8']
            ]);
            XLSX.utils.book_append_sheet(wb, ws, 'Ramos');
            XLSX.writeFile(wb, filePath);

            const result = await extractTextFromFile(filePath);
            assert.match(result, /--- Hoja: Ramos ---/);
            assert.match(result, /Código,Ramo,Nota/);
            assert.match(result, /INF-101,Programación,6\.8/);
        });

        it('debe extraer contenido de archivos legados .xls (Excel 97-2003)', async () => {
            const filePath = path.join(tmpDir, 'notas_antiguas.xls');
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([
                ['Alumno', 'Promedio'],
                ['Juan Perez', '6.5']
            ]);
            XLSX.utils.book_append_sheet(wb, ws, 'Final');
            XLSX.writeFile(wb, filePath);

            const result = await extractTextFromFile(filePath);
            assert.match(result, /--- Hoja: Final ---/);
            assert.match(result, /Juan Perez,6\.5/);
        });
    });

    describe('extractTextFromFile - Manejo de errores y validaciones defensivas', () => {
        it('debe rechazar con error si el archivo no existe', async () => {
            const nonExistent = path.join(tmpDir, 'no_existe.pdf');
            await assert.rejects(
                extractTextFromFile(nonExistent),
                /El archivo no existe en la ruta/
            );
        });

        it('debe rechazar formatos no soportados con mensaje descriptivo', async () => {
            const unsupported = path.join(tmpDir, 'archivo.exe');
            fs.writeFileSync(unsupported, 'binario ficticio');

            await assert.rejects(
                extractTextFromFile(unsupported),
                /Formato no soportado \(\.exe\)/
            );
        });

        it('debe rechazar archivos vacíos o con solo espacios en blanco', async () => {
            const empty = path.join(tmpDir, 'vacio.txt');
            fs.writeFileSync(empty, '      \n\n   ');

            await assert.rejects(
                extractTextFromFile(empty),
                /No se pudo extraer texto legible/
            );
        });

        it('debe rechazar archivos que superen el límite de tamaño configurado', async () => {
            const bigFile = path.join(tmpDir, 'grande.txt');
            fs.writeFileSync(bigFile, 'A'.repeat(2048)); // 2 KB

            await assert.rejects(
                extractTextFromFile(bigFile, { maxFileSizeMb: 0.001 }), // ~1 KB limit
                /excede el máximo permitido/
            );
        });
    });
});
