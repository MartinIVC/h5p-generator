const fs = require('fs');
const path = require('path');
const { extractTextFromFile, cleanText } = require('./chunker');

async function runTests() {
    console.log('=== Iniciando pruebas de extracción de documentos ===\n');

    // 1. Probar .txt
    const txtPath = '/tmp/test_doc.txt';
    fs.writeFileSync(txtPath, 'Línea 1 del archivo TXT.\n\n\nLínea 2 con espacios    múltiples.');
    const txtResult = await extractTextFromFile(txtPath);
    console.log('✔ TXT extraído correctamente:', JSON.stringify(txtResult));

    // 2. Probar .md
    const mdPath = '/tmp/test_doc.md';
    fs.writeFileSync(mdPath, '# Título en Markdown\n\nContenido de la clase sobre H5P.');
    const mdResult = await extractTextFromFile(mdPath);
    console.log('✔ MD extraído correctamente:', JSON.stringify(mdResult));

    // 3. Probar .csv
    const csvPath = '/tmp/test_doc.csv';
    fs.writeFileSync(csvPath, 'id,pregunta,respuesta\n1,¿Qué es H5P?,Contenido interactivo\n');
    const csvResult = await extractTextFromFile(csvPath);
    console.log('✔ CSV extraído correctamente:', JSON.stringify(csvResult));

    // 4. Probar .xlsx y .xls con SheetJS
    const XLSX = require('xlsx');
    const xlsxPath = '/tmp/test_doc.xlsx';
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
        ['Código', 'Ramo', 'Semestre'],
        ['INF-101', 'Programación I', '2026-1'],
        ['INF-202', 'Bases de Datos', '2026-2']
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Ramos 2026');
    XLSX.writeFile(wb, xlsxPath);
    const xlsxResult = await extractTextFromFile(xlsxPath);
    console.log('✔ XLSX extraído correctamente:\n' + xlsxResult);

    const xlsPath = '/tmp/test_doc.xls';
    XLSX.writeFile(wb, xlsPath);
    const xlsResult = await extractTextFromFile(xlsPath);
    console.log('✔ XLS extraído correctamente:\n' + xlsResult);

    // 5. Probar rechazo de formato inválido
    const invalidPath = '/tmp/test_invalid.xyz';
    fs.writeFileSync(invalidPath, 'Contenido inválido');
    try {
        await extractTextFromFile(invalidPath);
        throw new Error('Debería haber fallado por formato no soportado');
    } catch (e) {
        console.log('✔ Formato inválido rechazado correctamente:', e.message);
    }

    // 6. Probar rechazo de archivo vacío
    const emptyPath = '/tmp/test_empty.txt';
    fs.writeFileSync(emptyPath, '   \n  ');
    try {
        await extractTextFromFile(emptyPath);
        throw new Error('Debería haber fallado por archivo vacío');
    } catch (e) {
        console.log('✔ Archivo vacío rechazado correctamente:', e.message);
    }

    console.log('\n=== Todas las pruebas locales finalizaron con éxito ===');
}

runTests().catch(err => {
    console.error('❌ Error en pruebas:', err);
    process.exit(1);
});
