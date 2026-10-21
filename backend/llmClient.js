// ============================================================================
// Archivo: backend/llmClient.js
// Tarea H5P-13: Conectar cliente de API del LLM (Google Gemini)
// Incluye: Backoff Exponencial, Fallback e Instrucciones Personalizadas del Docente
// ============================================================================

const { GoogleGenerativeAI } = require('@google/generative-ai');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callGeminiWithResilience(genAI, prompt) {
    const modelsToTry = ["gemini-3.8-flash", "gemini-3.8-flash-lite"];
    const maxRetriesPerModel = 3; 

    for (const modelName of modelsToTry) {
        const model = genAI.getGenerativeModel({ model: modelName });

        for (let attempt = 0; attempt < maxRetriesPerModel; attempt++) {
            try {
                const result = await model.generateContent(prompt);
                return result.response.text();
            } catch (error) {
                const errorMsg = error.message || "";
                const isOverloaded = errorMsg.includes("503") || 
                                     errorMsg.includes("429") || 
                                     errorMsg.toLowerCase().includes("high demand") ||
                                     errorMsg.toLowerCase().includes("overloaded");

                if (errorMsg.includes("404")) {
                    console.warn(`El modelo ${modelName} no está disponible. Cambiando...`);
                    break;
                }
                if (!isOverloaded) throw error;

                if (attempt < maxRetriesPerModel - 1) {
                    const baseWaitTime = Math.pow(2, attempt) * 1000;
                    const jitter = Math.floor(Math.random() * 500);
                    const totalWaitTime = baseWaitTime + jitter;

                    console.warn(`Servidor saturado en ${modelName}. Reintento en ${(totalWaitTime / 1000).toFixed(2)}s...`);
                    await sleep(totalWaitTime);
                } else {
                    console.warn(`${modelName} saturado. Activando modelo de respaldo...`);
                }
            }
        }
    }
    throw new Error("Todos los modelos de Gemini están saturados actualmente.");
}

/**
 * GENERAR PREGUNTAS DESDE EL APUNTE
 * @param {string} chunkText - El texto extraído del apunte.
 * @param {string} apiKey - Clave de Gemini.
 * @param {string} instruccionProfesor - Lo que el docente pide.
 * @param {number} numQuestions - Cantidad de preguntas.
 */
async function generateQuestionsFromChunk(chunkText, apiKey, instruccionProfesor = "", numQuestions = 2) {
    if (!apiKey) throw new Error("No se entregó una API Key de Gemini.");
    if (!chunkText || chunkText.trim().length === 0) throw new Error("El texto del apunte está vacío.");

    const genAI = new GoogleGenerativeAI(apiKey);

    // Condicionamos si el profesor mandó una instrucción específica
    const bloqueInstruccion = instruccionProfesor 
        ? `\nREQUERIMIENTO ESPECÍFICO DEL DOCENTE: "${instruccionProfesor}" (Debes adaptar obligatoriamente el contenido, dificultad o estilo de las preguntas a esta instrucción).` 
        : "";

    const prompt = `
    Eres un asistente experto en pedagogía universitaria y diseño instruccional.
    Tu tarea es leer el siguiente apunte de clases y generar ${numQuestions} preguntas basadas ESTRICTAMENTE en la información proporcionada.
    ${bloqueInstruccion}
    
    REGLAS ESTRICTAS DE FORMATO:
    1. Tu respuesta debe ser ÚNICAMENTE un arreglo JSON válido.
    2. NO incluyas saludos, explicaciones, ni bloques markdown (\`\`\`json).
    3. Devuelve siempre esta estructura exacta (si el profesor pide Verdadero/Falso, pon solo 2 opciones en el arreglo):
    [
      {
        "pregunta": "Texto de la pregunta aquí",
        "opciones": ["Opción A", "Opción B", "Opción C", "Opción D"],
        "respuestaCorrecta": "Texto exacto de la opción correcta"
      }
    ]

    Apunte a evaluar:
    "${chunkText}"
    `;

    try {
        const responseText = await callGeminiWithResilience(genAI, prompt);
        const cleanText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);
    } catch (error) {
        console.error("Error al procesar JSON o conectar con Gemini:", error.message);
        throw error;
    }
}

module.exports = {
    generateQuestionsFromChunk
};