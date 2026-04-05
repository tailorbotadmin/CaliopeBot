"""Tests for API endpoints."""

import pytest
from unittest.mock import MagicMock, patch


class TestHealthCheck:
    def test_health_check(self, test_client):
        response = test_client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "CalíopeBot" in data["service"]


class TestProcessText:
    def test_process_text_returns_suggestions(self, test_client):
        # Mock LanguageTool
        with patch("main.tool") as mock_lt:
            mock_lt.check.return_value = []
            
            response = test_client.post("/api/v1/process-text", json={
                "textId": "test-1",
                "text": "El niño estaba contento.",
                "tenantId": "org-1",
                "authorId": "author-1",
            })
            assert response.status_code == 200
            data = response.json()
            assert "textId" in data
            assert "suggestions" in data


class TestExportDocx:
    def test_export_returns_success(self, test_client):
        response = test_client.post("/api/v1/export-docx", json={
            "originalText": "El niño estaba contento.",
            "acceptedSuggestions": [
                {"originalText": "estaba", "correctedText": "se encontraba"}
            ],
        })
        assert response.status_code == 200
        data = response.json()
        assert "size" in data


class TestLearnCorrection:
    def test_learn_returns_success(self, test_client):
        response = test_client.post("/api/v1/learn-correction", json={
            "tenantId": "org-1",
            "authorId": "author-1",
            "role": "Editor",
            "originalText": "estaba",
            "correctedText": "se encontraba",
            "justification": "Mejora estilística",
        })
        assert response.status_code == 200
