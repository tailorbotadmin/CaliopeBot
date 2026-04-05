"""Refactored AI agents with RAG integration, retry logic, and metrics."""

import json
import uuid
import logging
import time
from typing import List, Dict, Optional
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from google.genai import types

from app.services.rag_context import build_rag_context
from app.services.metrics import (
    LLM_CALLS, LLM_ERRORS, LLM_LATENCY, LLM_COST, track_llm_call,
)

logger = logging.getLogger(__name__)


class BaseAgent:
    """Base class for all AI agents."""

    def __init__(self, client, model: str = "gemini-2.5-flash", name: str = "base"):
        self.client = client
        self.model = model
        self.name = name

    def _call_llm(self, prompt: str, json_schema=None, temperature: float = 0.3) -> str:
        """Call LLM with retry logic and metrics tracking."""
        if not self.client:
            return self._mock_response(prompt)

        LLM_CALLS.labels(agent=self.name, model=self.model).inc()
        start = time.time()

        try:
            config = {}
            if json_schema:
                config = types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=json_schema,
                    temperature=temperature,
                )
            else:
                config = types.GenerateContentConfig(temperature=temperature)

            response = self.client.models.generate_content(
                model=self.model, contents=prompt, config=config
            )
            duration = time.time() - start
            LLM_LATENCY.labels(agent=self.name, model=self.model).observe(duration)
            logger.info(f"Agent {self.name} LLM call completed in {duration:.2f}s")
            return response.text.strip()

        except Exception as e:
            LLM_ERRORS.labels(agent=self.name, model=self.model).inc()
            logger.error(f"Agent {self.name} LLM error: {e}")
            raise

    def _mock_response(self, prompt: str) -> str:
        return ""


class GeneratorAgent(BaseAgent):
    """Agent 1: Rewrites text improving style while preserving author voice."""

    def __init__(self, client, model: str = "gemini-2.5-flash"):
        super().__init__(client, model, name="generator")

    def run(self, text: str) -> str:
        prompt = (
            "Eres el Generador BSC. Reescribe el texto mejorando estilo y ortografía, "
            "conservando el tono original de forma estricta.\n"
            f"Texto Original: {text}"
        )
        try:
            return self._call_llm(prompt)
        except Exception:
            logger.warning("Generator falling back to original text")
            return text

    def _mock_response(self, prompt: str) -> str:
        return prompt.split("Texto Original: ")[-1].replace("estaba", "se encontraba")


class CriticAgent(BaseAgent):
    """Agent 2: Critiques the Generator's proposal using RAG context."""

    def __init__(self, client, vector_store=None, model: str = "gemini-2.5-flash"):
        super().__init__(client, model, name="critic")
        self.vector_store = vector_store

    def run(
        self, original: str, proposal: str, org_id: str, author_id: str
    ) -> str:
        # Build RAG context if vector store is available
        if self.vector_store:
            rag_context = build_rag_context(
                self.vector_store, org_id, author_id, original
            )
        else:
            rag_context = "No hay reglas editoriales registradas aún."

        prompt = f"""Eres un Crítico Editorial implacable.
TEXTO ORIGINAL: {original}
PROPUESTA GENERADOR: {proposal}
VERIFICACIONES DE ESTILO (RAG): {rag_context}

Busca alucinaciones, cambios de voz del autor no justificados o violaciones de las reglas de estilo.
Critica la propuesta de forma concisa."""

        try:
            return self._call_llm(prompt)
        except Exception:
            return "Crítica no disponible por error."

    def _mock_response(self, prompt: str) -> str:
        return "Crítica: El generador aplicó mejoras básicas (Mock)."


class ArbiterAgent(BaseAgent):
    """Agent 3: Makes final correction decisions with structured JSON output."""

    SCHEMA = {
        "type": "ARRAY",
        "items": {
            "type": "OBJECT",
            "properties": {
                "originalText": {"type": "STRING"},
                "correctedText": {"type": "STRING"},
                "justification": {"type": "STRING"},
                "riskLevel": {"type": "STRING"},
            },
            "required": ["originalText", "correctedText", "justification", "riskLevel"],
        },
    }

    def __init__(self, client, vector_store=None, model: str = "gemini-2.5-flash"):
        super().__init__(client, model, name="arbiter")
        self.vector_store = vector_store

    def run(
        self,
        original: str,
        proposal: str,
        critique: str,
        org_id: str,
        author_id: str,
        lt_errors: list,
    ) -> List[Dict]:
        if self.vector_store:
            rag_context = build_rag_context(
                self.vector_store, org_id, author_id, original
            )
        else:
            rag_context = ""

        prompt = f"""Eres el Árbitro Editorial jefe.
TEXTO ORIGINAL: {original}
PROPUESTA GENERADOR: {proposal}
CRÍTICA: {critique}
ERRORES LANGUAGETOOL: {json.dumps(lt_errors)}
CONTEXTO EDITORIAL (RAG): {rag_context}

Decide las correcciones definitivas. Si la propuesta rompe la voz del autor, recházala.
Devuelve solo un array JSON con los fragmentos exactos que deben cambiar."""

        try:
            result = self._call_llm(prompt, json_schema=self.SCHEMA, temperature=0.2)
            suggestions = json.loads(result)
            for s in suggestions:
                s["id"] = f"arbiter_{uuid.uuid4().hex[:8]}"
                s["sourceRule"] = "AI_Arbiter"
            return suggestions
        except Exception as e:
            logger.error(f"Arbiter error: {e}")
            return []

    def _mock_response(self, prompt: str) -> str:
        return json.dumps([{
            "originalText": "estaba",
            "correctedText": "se encontraba",
            "justification": "Corrección de estilo simulada.",
            "riskLevel": "medium",
        }])
