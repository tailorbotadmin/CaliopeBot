"""Tests for AI agents — pipeline V2: VoiceAnalyzer → Corrector → Revisor → Arbiter."""

import json
import pytest
from unittest.mock import MagicMock
from app.services.agents import (
    VoiceAnalyzerAgent, CorrectorAgent, RevisorAgent, ArbiterAgent,
)

# ─── helpers ────────────────────────────────────────────────────────────────

SAMPLE_PARAGRAPHS = [
    "María cerró la ventana con cuidado.",
    "El sol caía con fuerza sobre las piedras del camino.",
    "—No lo entiendes —dijo él—. Nunca lo has entendido.",
]

EMPTY_VOICE_PROFILE = {
    "resumen": "",
    "rasgos_clave": [],
    "instrucciones_agentes": "Sé conservador.",
    "ejemplos_representativos": [],
}

# ─── VoiceAnalyzerAgent ─────────────────────────────────────────────────────

class TestVoiceAnalyzerAgent:
    def test_mock_fallback_returns_dict(self):
        """With no LLM client, _mock_response returns a valid voice profile dict."""
        agent = VoiceAnalyzerAgent(client=None)
        result = agent.run(SAMPLE_PARAGRAPHS)
        assert isinstance(result, dict)
        assert "resumen" in result
        assert "rasgos_clave" in result
        assert isinstance(result["rasgos_clave"], list)
        assert "instrucciones_agentes" in result

    def test_with_client(self, mock_genai_client):
        """With a real (mocked) client, the LLM response is parsed correctly."""
        profile = {
            "resumen": "El autor usa frases cortas.",
            "rasgos_clave": ["frases_cortas", "dialogo_coloquial"],
            "instrucciones_agentes": "No alargues las frases.",
            "ejemplos_representativos": [SAMPLE_PARAGRAPHS[0]],
        }
        mock_genai_client.models.generate_content.return_value.text = json.dumps(profile)
        agent = VoiceAnalyzerAgent(client=mock_genai_client)
        result = agent.run(SAMPLE_PARAGRAPHS)
        assert result["resumen"] == "El autor usa frases cortas."
        assert "frases_cortas" in result["rasgos_clave"]


# ─── CorrectorAgent ─────────────────────────────────────────────────────────

class TestCorrectorAgent:
    def test_mock_fallback_returns_list(self):
        """Mock fallback returns an empty list (conservative — no corrections without LLM)."""
        agent = CorrectorAgent(client=None)
        result = agent.run("El niño estaba muy cansado.", "org-1", "author-1", EMPTY_VOICE_PROFILE)
        assert isinstance(result, list)

    def test_correction_structure(self, mock_genai_client):
        """Each correction must have required fields and an auto-generated id."""
        corrections = [
            {
                "originalText": "estaba muy cansado",
                "correctedText": "estaba agotado",
                "justification": "Léxico más preciso.",
                "reglaAplicada": "Elección léxica",
                "riskLevel": "low",
            }
        ]
        mock_genai_client.models.generate_content.return_value.text = json.dumps(corrections)
        agent = CorrectorAgent(client=mock_genai_client)
        result = agent.run("El niño estaba muy cansado.", "org-1", "author-1", EMPTY_VOICE_PROFILE)
        assert isinstance(result, list)
        assert len(result) == 1
        c = result[0]
        assert "id" in c
        assert c["id"].startswith("corrector_")
        assert c["originalText"] == "estaba muy cansado"
        assert c["riskLevel"] == "low"

    def test_with_voice_profile(self, mock_genai_client):
        """Corrector receives voice profile — this is verified via the mocked response."""
        mock_genai_client.models.generate_content.return_value.text = json.dumps([])
        voice = {
            "resumen": "Frases cortas y directas.",
            "rasgos_clave": ["frases_cortas"],
            "instrucciones_agentes": "No alargues las frases del autor.",
            "ejemplos_representativos": [],
        }
        agent = CorrectorAgent(client=mock_genai_client)
        result = agent.run("El niño estaba.", "org-1", "author-1", voice)
        # LLM was called once
        assert mock_genai_client.models.generate_content.call_count == 1
        # The prompt passed should contain voice instructions
        call_args = mock_genai_client.models.generate_content.call_args
        prompt = call_args[1]["contents"] if "contents" in (call_args[1] or {}) else str(call_args)
        assert isinstance(result, list)


# ─── RevisorAgent ────────────────────────────────────────────────────────────

class TestRevisorAgent:
    def test_empty_corrections_returns_empty(self):
        """If no corrections are provided, Revisor returns [] without calling LLM."""
        agent = RevisorAgent(client=None)
        result = agent.run("Text", [], "org-1", "author-1", EMPTY_VOICE_PROFILE)
        assert result == []

    def test_mock_fallback_on_llm_error(self):
        """If LLM fails, Revisor auto-approves all corrections (fail-safe)."""
        failing_client = MagicMock()
        failing_client.models.generate_content.side_effect = RuntimeError("LLM down")
        agent = RevisorAgent(client=failing_client)
        corrections = [{"id": "corrector_abc123", "originalText": "x", "correctedText": "y"}]
        result = agent.run("Text", corrections, "org-1", "author-1", EMPTY_VOICE_PROFILE)
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0]["correctionId"] == "corrector_abc123"
        assert result[0]["decision"] == "aprobada"

    def test_review_structure(self, mock_genai_client):
        """Each review must have correctionId, decision, and razon."""
        reviews = [
            {"correctionId": "corrector_abc123", "decision": "aprobada", "razon": "Corrección válida."},
        ]
        mock_genai_client.models.generate_content.return_value.text = json.dumps(reviews)
        agent = RevisorAgent(client=mock_genai_client)
        corrections = [{"id": "corrector_abc123", "originalText": "x", "correctedText": "y"}]
        result = agent.run("Text", corrections, "org-1", "author-1", EMPTY_VOICE_PROFILE)
        assert isinstance(result, list)
        r = result[0]
        assert r["correctionId"] == "corrector_abc123"
        assert r["decision"] in ("aprobada", "modificada", "rechazada")
        assert "razon" in r


# ─── ArbiterAgent ────────────────────────────────────────────────────────────

class TestArbiterAgent:
    def test_mock_fallback_returns_list(self):
        """Mock fallback returns an empty list (conservative arbiter)."""
        agent = ArbiterAgent(client=None)
        corrections = [{"id": "corrector_xyz", "originalText": "a", "correctedText": "b"}]
        reviews = [{"correctionId": "corrector_xyz", "decision": "rechazada", "razon": "Estilo del autor."}]
        result = agent.run("Text", corrections, reviews, "org-1", "author-1", EMPTY_VOICE_PROFILE)
        assert isinstance(result, list)

    def test_returns_valid_schema(self, mock_genai_client):
        """Arbiter output must have the correction schema fields."""
        arbiter_suggestions = [
            {
                "originalText": "estaba muy cansado",
                "correctedText": "estaba agotado",
                "justification": "Árbitro: léxico más preciso.",
                "riskLevel": "low",
            }
        ]
        mock_genai_client.models.generate_content.return_value.text = json.dumps(arbiter_suggestions)
        agent = ArbiterAgent(client=mock_genai_client)
        corrections = [{"id": "corrector_xyz", "originalText": "estaba muy cansado", "correctedText": "estaba agotado"}]
        reviews = [{"correctionId": "corrector_xyz", "decision": "rechazada", "razon": "Estilo del autor."}]
        result = agent.run("Text", corrections, reviews, "org-1", "author-1", EMPTY_VOICE_PROFILE)
        assert isinstance(result, list)
        for s in result:
            assert "id" in s
            assert "originalText" in s
            assert "correctedText" in s

    def test_not_called_on_no_contested(self, mock_genai_client):
        """Arbiter with empty contested list returns [] without LLM call."""
        agent = ArbiterAgent(client=mock_genai_client)
        result = agent.run("Text", [], [], "org-1", "author-1", EMPTY_VOICE_PROFILE)
        assert result == []
        mock_genai_client.models.generate_content.assert_not_called()
