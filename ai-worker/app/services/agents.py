"""
Editorial AI Agent Pipeline.

Architecture:
  [0] VoiceAnalyzerAgent  — one-time style extraction from manuscript sample
  [1] CorrectorAgent      — proposes specific rule-grounded corrections (no full rewrites)
  [2] RevisorAgent        — validates each correction; approves / modifies / rejects
  [3] ArbiterAgent        — only called when Revisor has disagreements (rejects/modifications)
  [+] LanguageTool        — deterministic RAE ortho checks (handled in main.py)
"""

import json
import uuid
import logging
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from typing import List, Dict, Optional
from google.genai import types

from app.services.rag_context import build_rag_context
from app.services.metrics import (
    LLM_CALLS, LLM_ERRORS, LLM_LATENCY, track_llm_call,
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Base Agent
# ─────────────────────────────────────────────────────────────────────────────

class BaseAgent:
    """Base class with LLM call, retry and metrics."""

    def __init__(self, client, model: str = "gemini-2.0-flash-001", name: str = "base"):
        self.client = client
        self.model = model
        self.name = name

    LLM_CALL_TIMEOUT: int = 90     # seconds per individual LLM request
    LLM_MAX_RETRIES:  int = 3       # retries per agent call
    LLM_RETRY_WAIT:   float = 3.0   # base wait between retries

    def _call_llm(self, prompt: str, json_schema=None, temperature: float = 0.2) -> str:
        """Call the LLM with timeout and retry. Raises on all-retries exhausted."""
        if not self.client:
            return self._mock_response(prompt)

        def _do_call():
            LLM_CALLS.labels(agent=self.name, model=self.model).inc()
            start = time.time()
            config = types.GenerateContentConfig(
                response_mime_type="application/json" if json_schema else "text/plain",
                **({"response_schema": json_schema} if json_schema else {}),
                temperature=temperature,
            )
            response = self.client.models.generate_content(
                model=self.model, contents=prompt, config=config
            )
            duration = time.time() - start
            LLM_LATENCY.labels(agent=self.name, model=self.model).observe(duration)
            logger.info(f"[{self.name}] LLM call: {duration:.2f}s")
            return response.text.strip()

        last_err = None
        for attempt in range(1, self.LLM_MAX_RETRIES + 1):
            try:
                with ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(_do_call)
                    result = future.result(timeout=self.LLM_CALL_TIMEOUT)
                return result
            except FuturesTimeoutError:
                last_err = TimeoutError(f"LLM call timed out after {self.LLM_CALL_TIMEOUT}s")
                LLM_ERRORS.labels(agent=self.name, model=self.model).inc()
                logger.warning(f"[{self.name}] Attempt {attempt}: LLM timeout (>{self.LLM_CALL_TIMEOUT}s)")
            except Exception as e:
                last_err = e
                LLM_ERRORS.labels(agent=self.name, model=self.model).inc()
                logger.warning(f"[{self.name}] Attempt {attempt}: LLM error: {e}")

            if attempt < self.LLM_MAX_RETRIES:
                wait = self.LLM_RETRY_WAIT * attempt
                logger.info(f"[{self.name}] Retrying in {wait:.1f}s...")
                time.sleep(wait)

        logger.error(f"[{self.name}] All {self.LLM_MAX_RETRIES} attempts failed. Last error: {last_err}")
        raise last_err


    def _mock_response(self, prompt: str) -> str:
        return "[]"


# ─────────────────────────────────────────────────────────────────────────────
# [0] Voice Analyzer
# ─────────────────────────────────────────────────────────────────────────────

class VoiceAnalyzerAgent(BaseAgent):
    """
    One-time analysis of the author's writing style.
    Called once at the start of processing; result stored in book.voiceProfile.
    """

    SCHEMA = {
        "type": "OBJECT",
        "properties": {
            "resumen": {"type": "STRING"},
            "rasgos_clave": {"type": "ARRAY", "items": {"type": "STRING"}},
            "instrucciones_agentes": {"type": "STRING"},
            "ejemplos_representativos": {"type": "ARRAY", "items": {"type": "STRING"}},
        },
        "required": ["resumen", "rasgos_clave", "instrucciones_agentes"],
    }

    def __init__(self, client, model: str = "gemini-2.0-flash-001"):
        super().__init__(client, model, name="voice_analyzer")

    def run(self, sample_paragraphs: List[str]) -> Dict:
        """Analyze a sample of paragraphs and return a voice profile dict."""
        sample = "\n\n".join(p for p in sample_paragraphs if p.strip())[:8000]  # cap at ~8k chars

        prompt = f"""Eres un experto en estilística literaria española. Analiza la voz y el estilo del autor en esta muestra.

MUESTRA DEL MANUSCRITO:
{sample}

Analiza con precisión:
1. Longitud y estructura típica de las frases (¿cortas y directas? ¿largas y subordinadas?)
2. Registro lingüístico (formal, informal, coloquial, literario)
3. Perspectiva narrativa y tiempo verbal predominante
4. Uso específico de puntuación (¿frecuencia de —, …, ;, ?)
5. Características del diálogo (¿cómo hablan los personajes?)
6. Densidad descriptiva (¿narración escueta o rica en detalles?)
7. Cualquier idiosincrasia o firma estilística del autor

instrucciones_agentes: Escribe un párrafo conciso y directo para los agentes correctores con las directrices de qué NO deben cambiar para respetar la voz del autor. Incluye ejemplos concretos si los detectas.

rasgos_clave: Lista de etiquetas cortas (snake_case) que describen rasgos del estilo, ej: frases_cortas, dialogo_coloquial, puntos_suspensivos_intencionales.

ejemplos_representativos: 2-3 frases del texto que mejor ilustran la voz del autor."""

        try:
            result = self._call_llm(prompt, json_schema=self.SCHEMA, temperature=0.1)
            profile = json.loads(result)
            logger.info(f"[voice_analyzer] Profile generated: {profile.get('rasgos_clave', [])}")
            return profile
        except Exception as e:
            logger.error(f"[voice_analyzer] Error: {e}")
            return {
                "resumen": "No se pudo analizar el estilo del autor.",
                "rasgos_clave": [],
                "instrucciones_agentes": "Sé muy conservador. No modifiques la voz del autor.",
                "ejemplos_representativos": [],
            }

    def _mock_response(self, prompt: str) -> str:
        return json.dumps({
            "resumen": "El autor usa frases cortas y directas (mock).",
            "rasgos_clave": ["frases_cortas", "registro_informal"],
            "instrucciones_agentes": "No alargues las frases. El diálogo coloquial es intencional.",
            "ejemplos_representativos": [],
        })


# ─────────────────────────────────────────────────────────────────────────────
# [1] Corrector Agent
# ─────────────────────────────────────────────────────────────────────────────

class CorrectorAgent(BaseAgent):
    """
    Proposes specific, rule-grounded corrections.
    Does NOT rewrite the full text — only flags exact fragments that violate a rule.
    """

    SCHEMA = {
        "type": "ARRAY",
        "items": {
            "type": "OBJECT",
            "properties": {
                "originalText":  {"type": "STRING"},
                "correctedText": {"type": "STRING"},
                "justification": {"type": "STRING"},
                "reglaAplicada": {"type": "STRING"},
                "riskLevel":     {"type": "STRING"},  # "low" | "medium" | "high"
                "category":      {"type": "STRING"},  # Tildes | Gramática | Puntuación | Extranjerismos | Ortografía | Léxico | Tipografía
            },
            "required": ["originalText", "correctedText", "justification", "riskLevel", "category"],
        },
    }

    def __init__(self, client, vector_store=None, model: str = "gemini-2.0-flash-001"):
        super().__init__(client, model, name="corrector")
        self.vector_store = vector_store

    def run(self, text: str, org_id: str, author_id: str, voice_profile: Dict) -> List[Dict]:
        rag_context = (
            build_rag_context(self.vector_store, org_id, author_id, text)
            if self.vector_store else "No hay reglas editoriales registradas."
        )
        voice_summary      = voice_profile.get("resumen", "")
        voice_instructions = voice_profile.get("instrucciones_agentes", "")
        voice_examples     = voice_profile.get("ejemplos_representativos", [])

        has_voice = bool(voice_summary or voice_instructions or voice_examples)

        examples_block = ""
        if voice_examples:
            examples_block = "Ejemplos de su estilo:\n" + "\n".join(f'• "{e}"' for e in voice_examples)

        if has_voice:
            voice_block = f"""════ VOZ DEL AUTOR — PRIORITARIA ════
{voice_summary}
{examples_block}

⚠️ INSTRUCCIÓN CRÍTICA: {voice_instructions}"""
        else:
            voice_block = """════ MODO CORRECCIÓN ORTOTIPOGRÁFICA ════
No se ha detectado perfil de estilo del autor. Aplica corrección técnica exhaustiva:
• Ortografía y tildes (RAE)
• Puntuación: comas, punto y coma, dos puntos, comillas españolas «», guiones
• Concordancia de género y número
• Uso correcto de mayúsculas
• Errores de tipografía: espacios dobles, espacios antes de puntuación
• Anglicismos evitables con equivalente español
• Verbosidad y redundancias evidentes
• Gerundios incorrectos
Sé exhaustivo: un informe académico o técnico tiene errores ortotipográficos reales."""

        prompt = f"""Eres el Corrector Editorial de una editorial profesional española.

{voice_block}

════ REGLAS EDITORIALES (RAG) ════
{rag_context}

════ TEXTO A REVISAR ════
{text}

════ TU MISIÓN ════
Identifica fragmentos del texto que violen las reglas editoriales anteriores.
Para cada fragmento:
- originalText: copia EXACTA del fragmento que debe cambiar (debe aparecer literalmente en el texto)
- correctedText: la versión corregida
- justification: explica qué regla viola y por qué tu corrección es mejor
- reglaAplicada: nombre o número de la regla editorial aplicada (si la conoces)
- riskLevel: "low" si es error claro, "medium" si puede ser opinable, "high" si puede ser elección del autor
- category: una de estas categorías exactas → Tildes | Gramática | Puntuación | Extranjerismos | Ortografía | Léxico | Tipografía

PROHIBIDO:
✗ Reescribir el texto completo
✗ Cambiar frases que no tienen error objetivo
✗ Proponer originalText que no aparezca literalmente en el texto

Si no hay correcciones necesarias, devuelve [].
Devuelve SOLO el array JSON."""

        try:
            result = self._call_llm(prompt, json_schema=self.SCHEMA, temperature=0.2)
            corrections = json.loads(result)
            for c in corrections:
                c["id"] = f"corrector_{uuid.uuid4().hex[:8]}"
                c.setdefault("reglaAplicada", "")
                c.setdefault("riskLevel", "medium")
                c.setdefault("category", "Ortografía")
            logger.info(f"[corrector] {len(corrections)} corrections proposed")
            return corrections
        except Exception as e:
            logger.error(f"[corrector] Error: {e}")
            return []

    def _mock_response(self, prompt: str) -> str:
        return json.dumps([{
            "originalText": "estaba muy cansado",
            "correctedText": "estaba agotado",
            "justification": "Elección de vocabulario más preciso.",
            "reglaAplicada": "Elección léxica",
            "riskLevel": "low",
        }])


# ─────────────────────────────────────────────────────────────────────────────
# [2] Revisor Agent
# ─────────────────────────────────────────────────────────────────────────────

class RevisorAgent(BaseAgent):
    """
    Reviews each correction from CorrectorAgent.
    Decides: 'aprobada' | 'modificada' | 'rechazada'.
    Only corrections with disagreements are passed to the Arbiter.
    """

    SCHEMA = {
        "type": "ARRAY",
        "items": {
            "type": "OBJECT",
            "properties": {
                "correctionId":      {"type": "STRING"},
                "decision":          {"type": "STRING"},  # aprobada | modificada | rechazada
                "correctedTextFinal": {"type": "STRING"}, # only if 'modificada'
                "razon":             {"type": "STRING"},
            },
            "required": ["correctionId", "decision", "razon"],
        },
    }

    def __init__(self, client, vector_store=None, model: str = "gemini-2.0-flash-001"):
        super().__init__(client, model, name="revisor")
        self.vector_store = vector_store

    def run(
        self,
        text: str,
        corrections: List[Dict],
        org_id: str,
        author_id: str,
        voice_profile: Dict,
    ) -> List[Dict]:
        if not corrections:
            return []

        rag_context = (
            build_rag_context(self.vector_store, org_id, author_id, text)
            if self.vector_store else ""
        )
        voice_instructions = voice_profile.get("instrucciones_agentes", "")

        corrections_json = json.dumps(corrections, ensure_ascii=False, indent=2)

        prompt = f"""Eres el Revisor Editorial. Evalúa críticamente cada corrección propuesta por el Corrector.

════ VOZ DEL AUTOR ════
⚠️ {voice_instructions}

════ TEXTO ORIGINAL ════
{text}

════ CORRECCIONES A REVISAR ════
{corrections_json}

════ REGLAS EDITORIALES ════
{rag_context}

════ TU MISIÓN ════
Para cada corrección (usa su campo "id" como correctionId), decide:

• "aprobada"  — la corrección es correcta, necesaria y respeta la voz del autor
• "modificada" — la idea es válida pero el texto corregido debería ser diferente;
                 proporciona correctedTextFinal con tu versión alternativa
• "rechazada" — la corrección es innecesaria, incorrecta o viola la voz del autor

Sé independiente: no apruebes automáticamente. Tu deber es proteger la calidad y la voz del autor.

Devuelve SOLO el array JSON con una entrada por cada corrección recibida."""

        try:
            result = self._call_llm(prompt, json_schema=self.SCHEMA, temperature=0.2)
            reviews = json.loads(result)
            logger.info(
                f"[revisor] {sum(1 for r in reviews if r.get('decision')=='aprobada')} aprobadas, "
                f"{sum(1 for r in reviews if r.get('decision')=='modificada')} modificadas, "
                f"{sum(1 for r in reviews if r.get('decision')=='rechazada')} rechazadas"
            )
            return reviews
        except Exception as e:
            logger.error(f"[revisor] Error: {e}")
            # Fail-safe: auto-approve all if revisor fails
            return [
                {"correctionId": c["id"], "decision": "aprobada", "razon": "Revisión no disponible."}
                for c in corrections
            ]

    def _mock_response(self, prompt: str) -> str:
        return json.dumps([
            {"correctionId": "mock", "decision": "aprobada", "razon": "Mock: corrección válida."}
        ])


# ─────────────────────────────────────────────────────────────────────────────
# [3] Arbiter Agent  (only called when Revisor has disagreements)
# ─────────────────────────────────────────────────────────────────────────────

class ArbiterAgent(BaseAgent):
    """
    Final arbiter. Only receives corrections where Corrector and Revisor disagree.
    Produces the definitive list of suggestions for those contested corrections.
    """

    SCHEMA = {
        "type": "ARRAY",
        "items": {
            "type": "OBJECT",
            "properties": {
                "originalText":  {"type": "STRING"},
                "correctedText": {"type": "STRING"},
                "justification": {"type": "STRING"},
                "riskLevel":     {"type": "STRING"},
            },
            "required": ["originalText", "correctedText", "justification", "riskLevel"],
        },
    }

    def __init__(self, client, vector_store=None, model: str = "gemini-2.0-flash-001"):
        super().__init__(client, model, name="arbiter")
        self.vector_store = vector_store

    def run(
        self,
        text: str,
        contested_corrections: List[Dict],
        reviews: List[Dict],
        org_id: str,
        author_id: str,
        voice_profile: Dict,
    ) -> List[Dict]:
        """Resolve only the corrections where Revisor disagreed."""
        if not contested_corrections:
            return []

        rag_context = (
            build_rag_context(self.vector_store, org_id, author_id, text)
            if self.vector_store else ""
        )
        voice_instructions = voice_profile.get("instrucciones_agentes", "")

        review_map = {r["correctionId"]: r for r in reviews}
        contested_with_review = [
            {**c, "_revision": review_map.get(c["id"], {})}
            for c in contested_corrections
        ]

        prompt = f"""Eres el Árbitro Editorial jefe. El Corrector y el Revisor han discrepado en estas correcciones.

════ VOZ DEL AUTOR ════
⚠️ {voice_instructions}

════ TEXTO ORIGINAL ════
{text}

════ CORRECCIONES EN DISPUTA (con posición del Revisor) ════
{json.dumps(contested_with_review, ensure_ascii=False, indent=2)}

════ REGLAS EDITORIALES ════
{rag_context}

════ TU MISIÓN ════
Decide cuáles de estas correcciones deben aplicarse finalmente y con qué texto exacto.
Puedes combinar las posiciones del Corrector y el Revisor o rechazar ambas.
Devuelve SOLO las correcciones que SÍ deben aplicarse (omite las que rechaces).
Prioriza siempre la voz del autor sobre cualquier mejora estilística."""

        try:
            result = self._call_llm(prompt, json_schema=self.SCHEMA, temperature=0.1)
            resolved = json.loads(result)
            for r in resolved:
                r["id"] = f"arbiter_{uuid.uuid4().hex[:8]}"
                r["sourceRule"] = "Árbitro Editorial"
                r.setdefault("riskLevel", "medium")
            logger.info(f"[arbiter] Resolved {len(resolved)}/{len(contested_corrections)} contested corrections")
            return resolved
        except Exception as e:
            logger.error(f"[arbiter] Error: {e}")
            return []

    def _mock_response(self, prompt: str) -> str:
        return json.dumps([])
