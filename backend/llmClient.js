// ============================================================================
// Archivo: backend/llmClient.js
// Tarea H5P-13: Conectar cliente de API del LLM (Google Gemini)
// ============================================================================

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Recibe un fragmento de texto (chunk) y lo envía a Gemini
 * para generar preguntas de opción múltiple en formato JSON estricto.
 */
async function generateQuestionsFromChunk(chunkText, apiKey) {
    if (!apiKey) {
        throw new Error("No se entregó una API Key de Gemini.");
    }

    // Inicializamos el cliente de Google con tu clave secreta
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Usamos el modelo 'gemini-3.8-flash' indicado por la API de Google
    const model = genAI.getGenerativeModel({ model: "gemini-3.8-flash" });

    // Instrucciones estrictas para obligar a la IA a responder solo con JSON válido
    const prompt = `
    Eres un asistente experto en pedagogía universitaria.
    Lee el siguiente fragmento de un apunte y genera 2 preguntas de opción múltiple para evaluar al alumno.
    
    REGLA ESTRICTA: Tu respuesta debe ser ÚNICAMENTE un arreglo JSON válido. No incluyas saludos, explicaciones ni bloques markdown.
    
    Estructura JSON requerida:
    [
      {
        "pregunta": "Texto de la pregunta",
        "opciones": ["Opción A", "Opción B", "Opción C", "Opción D"],
        "respuestaCorrecta": "Opción A"
      }
    ]

    Fragmento del apunte:
    "${chunkText}"
    `;

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        // Limpiamos posibles etiquetas ```json que la IA agregue por costumbre
        const cleanText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        return JSON.parse(cleanText);
    } catch (error) {
        console.error("Error al comunicarse con Gemini:", error.message);
        throw error;
    }
}

module.exports = {
    generateQuestionsFromChunk
};