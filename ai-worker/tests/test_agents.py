"""Tests for AI agents."""

import json
import pytest
from unittest.mock import MagicMock
from app.services.agents import GeneratorAgent, CriticAgent, ArbiterAgent


class TestGeneratorAgent:
    def test_mock_fallback(self):
        agent = GeneratorAgent(client=None)
        result = agent.run("El niño estaba contento.")
        assert "se encontraba" in result

    def test_with_client(self, mock_genai_client):
        mock_genai_client.models.generate_content.return_value.text = "El niño se encontraba contento."
        agent = GeneratorAgent(client=mock_genai_client)
        result = agent.run("El niño estaba contento.")
        assert result == "El niño se encontraba contento."


class TestCriticAgent:
    def test_mock_fallback(self):
        agent = CriticAgent(client=None)
        result = agent.run("original", "propuesta", "org-1", "author-1")
        assert "Mock" in result

    def test_with_rag(self, mock_genai_client, mock_vector_store):
        mock_genai_client.models.generate_content.return_value.text = "La propuesta es aceptable."
        agent = CriticAgent(client=mock_genai_client, vector_store=mock_vector_store)
        result = agent.run("original", "propuesta", "org-1", "author-1")
        assert result == "La propuesta es aceptable."


class TestArbiterAgent:
    def test_mock_fallback(self):
        agent = ArbiterAgent(client=None)
        result = agent.run("original", "propuesta", "crítica", "org-1", "author-1", [])
        assert isinstance(result, list)
        assert len(result) > 0
        assert "originalText" in result[0]

    def test_returns_valid_schema(self, mock_genai_client):
        agent = ArbiterAgent(client=mock_genai_client)
        result = agent.run("original", "propuesta", "crítica", "org-1", "author-1", [])
        assert isinstance(result, list)
        for s in result:
            assert "id" in s
            assert "originalText" in s
            assert "correctedText" in s
            assert "sourceRule" in s
