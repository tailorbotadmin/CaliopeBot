import io
from docx import Document
from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import List, Dict
import uuid
import language_tool_python

app = FastAPI(title="CalíopeBot AI Orchestrator")

# Inicializamos LanguageTool localmente para español
tool = language_tool_python.LanguageTool('es')

class CorrectionRequest(BaseModel):
    textId: str
    text: str # Chunk of text (e.g., a paragraph)
    tenantId: str # Organization ID for style RAG
    authorId: str # Author ID for voice/style RAG

class SuggestionResponse(BaseModel):
    id: str
    originalText: str
    correctedText: str
    justification: str
    riskLevel: str
    sourceRule: str

class CorrectionResponse(BaseModel):
    textId: str
    suggestions: List[SuggestionResponse]

@app.get("/")
def health_check():
    return {"status": "ok", "service": "CalíopeBot AI Orchestrator (LLM Judge Pipeline)"}

@app.post("/api/v1/process-docx")
async def process_docx(file: UploadFile = File(...)):
    """
    Recibe un archivo .docx, lo lee en memoria, y extrae los párrafos y estilos
    para dividirlos en chunks listos para el pipeline IA.
    """
    if not file.filename.endswith('.docx'):
        raise HTTPException(status_code=400, detail="El archivo debe ser un documento Word (.docx)")
    
    try:
        content = await file.read()
        doc = Document(io.BytesIO(content))
        
        chunks = []
        for i, para in enumerate(doc.paragraphs):
            text = para.text.strip()
            if text:
                chunks.append({
                    "id": f"chunk-{i}",
                    "text": text,
                    "style": para.style.name if para.style else "Normal"
                })
        
        return {
            "message": f"Archivo {file.filename} parseado correctamente.", 
            "total_chunks": len(chunks),
            "preview": chunks[:3]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parseando docx: {str(e)}")

def call_bsc_gpt2_base(text: str) -> str:
    """
    Agente 1: El Generador (Modelo BSC GPT-2).
    Simula la llamada al modelo SFT entrenado con los 7 libros.
    Solo hace traducción Párrafo Original -> Párrafo Corregido.
    """
    # TODO: Implementar llamada real a la API de inferencia del BSC
    return text.replace("estaba", "se encontraba")  # Mock

def call_critic_llm(original_text: str, gpt2_proposal: str, tenant_id: str, author_id: str) -> str:
    """
    Agente 2: El Crítico (Gemini Flash / Llama-3 Rápido).
    Ataca la propuesta del GPT-2 usando el RAG Aislado del Tenant y del Autor.
    """
    # TODO: Consultar base de datos vectorial estricta por `tenant_id` Y `author_id`
    # RAG_context_editorial = vector_search.query(original_text, tenant_id)
    # RAG_context_author = vector_search.query(original_text, author_id)
    
    prompt = f"""
    Eres un Crítico Editorial implacable.
    TEXTO ORIGINAL: {original_text}
    PROPUESTA GPT-2: {gpt2_proposal}
    
    Busca alucinaciones, cambios de voz del autor no justificados o violaciones de estilo.
    Critica la propuesta de forma concisa.
    """
    # Mock de la respuesta del crítico
    return "Crítica: El GPT-2 cambió 'estaba' por 'se encontraba', lo cual altera la voz del autor sin justificación ortográfica normativa."

def call_arbiter_llm(original_text: str, gpt2_proposal: str, critique: str, tenant_id: str, author_id: str, lt_errors: list) -> List[Dict]:
    """
    Agente 3: El Árbitro (Modelo Superior, ej. GPT-4o o Gemini Pro).
    Toma la decisión final basándose en el original, la propuesta, la crítica y los errores de LT.
    Devuelve las sugerencias estructuradas en JSON.
    """
    # En producción este prompt estructura la salida y fuerza Markdown JSON
    final_suggestions = []
    
    if "altera la voz del autor" not in critique:
        final_suggestions.append({
            "id": str(uuid.uuid4()),
            "type": "Style",
            "originalText": "estaba",
            "correctedText": "se encontraba",
            "justification": "Sugerencia de estilo base (Aprobada por el Árbitro).",
            "riskLevel": "Medium"
        })
    else:
        # El Árbitro hace caso al crítico y rechaza el cambio del GPT-2
        pass
        
    return final_suggestions

@app.post("/api/v1/process-text", response_model=CorrectionResponse)
async def process_text(request: CorrectionRequest):
    """
    Endpoint principal para la corrección mediante Debate Multi-Agente.
    """
    # 1. Capa Objetiva (LanguageTool)
    lt_matches = tool.check(request.text)
    lt_errors = [{"rule": m.ruleId, "message": m.message, "replacements": m.replacements[:3]} for m in lt_matches]
    
    # 2. Agente 1 (Generador BSC)
    gpt2_text = call_bsc_gpt2_base(request.text)
    
    # 3. Agente 2 (Crítico Dual RAG)
    critique = call_critic_llm(request.text, gpt2_text, request.tenantId, request.authorId)
    
    # 4. Agente 3 (Árbitro)
    final_suggestions = call_arbiter_llm(request.text, gpt2_text, critique, request.tenantId, request.authorId, lt_errors)
    
    # Agregamos las correcciones duras de LanguageTool si las hay
    for error in lt_errors:
        if error["replacements"]:
            final_suggestions.append(
                SuggestionResponse(
                    id="lt_" + str(uuid.uuid4())[:8],
                    originalText=error["context"] if "context" in error else request.text, # Simplified for Mock, need actual context from match
                    correctedText=error["replacements"][0],
                    justification=f"Regla {error['rule']}: {error['message']}",
                    riskLevel="low",
                    sourceRule=error["rule"]
                )
            )
    
    # 2. Consultar RAG (Firestore Vector o Pinecone)
    style_guidelines = ["Regla CSIC: Las cursivas para extranjerismos."]
    
    # 3. Llamada al Modelo BSC GPT-2 (Generador Base)
    bsc_generated_correction = f"{text} (Simulación de salida del BSC)"
    
    # 4. Llamada al Juez (Gemini / Claude Haiku / Llama3)
    # Aquí construimos el prompt del Juez utilizando el contexto y el borrador de BSC
    
    juez_system_prompt = f"""
    Eres un Juez de Corrección Editorial (CalíopeBot).
    RECIBES:
    1. Texto Original
    2. Texto procesado por un modelo base (BSC GPT-2)
    3. Guías de Estilo (RAG): {style_guidelines[0]}
    
    DEBES:
    - Analizar las diferencias entre Original y BSC.
    - Confirmar que se aplican los criterios RAE/Fundéu obligatorios.
    - Descartar alucinaciones (cambios de voz del autor no necesarios).
    - Asignar "Risk Level": low (ortografía/tipografía), medium (sintaxis), high (estilo/tono).
    - Devolver un JSON con las sugerencias aprobadas y su justificación.
    """
    
    juez_user_prompt = f"""
    Original: {text}
    BSC Draft: {bsc_generated_correction}
    """
    
    # Simulación de la respuesta del LLM estructurada
    # response = llm_client.generate_content(juez_system_prompt + juez_user_prompt)
    # suggestions = parse_json(response.text)
    
    final_suggestions = lt_suggestions + [
        SuggestionResponse(
            id="llm_" + str(uuid.uuid4())[:8],
            originalText="Ejemplo llm",
            correctedText="Ejemplo Juez",
            justification="Corrección de estilo según CSIC (Simulada).",
            riskLevel="medium",
            sourceRule="RAG: Guía Estilo"
        )
    ]
    
    return CorrectionResponse(
        textId=str(uuid.uuid4()),
        suggestions=final_suggestions
    )

class ExportRequest(BaseModel):
    originalText: str
    acceptedSuggestions: List[Dict]

@app.post("/api/v1/export-docx")
async def export_docx(request: ExportRequest):
    """
    Toma el texto original y las sugerencias aceptadas
    y genera un documento .docx para descargar.
    """
    doc = Document()
    doc.add_paragraph("CalíopeBot - Documento Corregido")
    
    # Simulación de aplicación de sugerencias (reemplazo simple)
    # En producción requiere algoritmos de offset para no romper el formato.
    final_text = request.originalText
    for sug in request.acceptedSuggestions:
        final_text = final_text.replace(sug.get("originalText", ""), sug.get("correctedText", ""))
        
    doc.add_paragraph(final_text)
    
    file_stream = io.BytesIO()
    doc.save(file_stream)
    file_stream.seek(0)
    
    # Retornarías esto como un FileResponse en FastAPI
    return {"message": "Exportación docx exitosa, bytes generados", "size": len(file_stream.getvalue())}

class LearnRequest(BaseModel):
    tenantId: str
    authorId: str
    role: str # 'Editor', 'Responsable Editorial', or 'Autor'
    originalText: str
    correctedText: str
    justification: str

@app.post("/api/v1/learn-correction")
async def learn_correction(request: LearnRequest):
    """
    Ruta de Self-Learning (Dual): 
    Recibe una corrección aprobada manualmente por el Editor, Responsable o Autor.
    La inyecta en el RAG Aislado (Editorial) y, si es relevante, en el RAG específico del Autor.
    """
    # TODO: Inyectar document en la Vector DB de la organización
    # vector_db.insert(tenant_id=request.tenantId, ... )
    
    # TODO: Inyectar preferencia de estilo particular en el espacio del autor
    # vector_db.insert(author_id=request.authorId, text=f"Preferencia del autor: Usar '{request.correctedText}' en lugar de '{request.originalText}'.")
    
    return {"status": "success", "message": f"Regla inyectada y asociada al Autor {request.authorId} por el rol {request.role}."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
