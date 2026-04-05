"""Pytest fixtures for CalíopeBot tests."""

import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient


@pytest.fixture
def mock_firebase_db():
    """Mock Firestore client."""
    db = MagicMock()
    batch = MagicMock()
    db.batch.return_value = batch
    db.collection.return_value.document.return_value.collection.return_value = MagicMock()
    return db


@pytest.fixture
def mock_genai_client():
    """Mock Gemini API client with predictable responses."""
    client = MagicMock()
    response = MagicMock()
    response.text = '  [{"originalText": "estaba", "correctedText": "se encontraba", "justification": "Mejora estilística", "riskLevel": "low"}]  '
    client.models.generate_content.return_value = response
    return client


@pytest.fixture
def mock_vector_store():
    """Mock ChromaDB vector store."""
    from app.services.vector_store import EditorialVectorStore
    store = EditorialVectorStore(ephemeral=True)
    return store


@pytest.fixture
def sample_spanish_text():
    return "El niño estaba muy contento porque había recibido un regalo de su abuela."


@pytest.fixture
def sample_paragraphs():
    return [
        "En un lugar de la Mancha, de cuyo nombre no quiero acordarme.",
        "No ha mucho tiempo que vivía un hidalgo de los de lanza en astillero.",
        "Frisaba la edad de nuestro hidalgo con los cincuenta años.",
    ]


@pytest.fixture
def test_client():
    """FastAPI test client."""
    # Patch Firebase before importing app
    with patch("firebase_admin.get_app"), \
         patch("firebase_admin.initialize_app"), \
         patch("firebase_admin.credentials.Certificate"), \
         patch("main.db", MagicMock()), \
         patch("main.client", MagicMock()), \
         patch("main.tool", MagicMock()):
        from main import app
        return TestClient(app)
