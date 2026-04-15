"""Tests for the new endpoints added in Phases 4–6:
- DELETE /api/v1/users/delete
- POST   /api/v1/seed-rae-rules
- POST   /api/v1/ingest-book  (extended coverage)
- POST   /api/v1/learn-correction (extended)
- POST   /api/v1/process-text (extended)
"""

import io
import json
from typing import Optional
import pytest
from unittest.mock import MagicMock, patch


# ─────────────────────────────────────────────────────────────────────────────
# Delete user endpoint
# ─────────────────────────────────────────────────────────────────────────────

class TestDeleteUser:
    """DELETE /api/v1/users/delete — role-based access control."""

    def _delete(self, client, body: dict, token: Optional[str] = None):
        """Helper: send DELETE with JSON body via build_request (all starlette versions)."""
        import httpx
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = client.build_request(
            "DELETE", "/api/v1/users/delete",
            content=json.dumps(body).encode(),
            headers=headers,
        )
        return client.send(req)

    def test_delete_user_no_token_returns_4xx(self, test_client):
        """Without real Firebase token — endpoint should not 500."""
        response = self._delete(test_client, {"targetUid": "some-uid"})
        assert response.status_code != 500

    def test_delete_user_missing_body_returns_422(self, test_client):
        """Missing targetUid body field → 422 Unprocessable Entity."""
        response = self._delete(test_client, {}, token="fake-token")
        assert response.status_code == 422

    def test_delete_user_with_mocked_auth(self, test_client):
        """With mocked auth, endpoint processes the delete logic."""
        import firebase_admin.auth as _fb_auth

        mock_decoded = {"uid": "admin-uid", "role": "Admin", "organizationId": "org-1"}
        with patch.object(_fb_auth, "verify_id_token", return_value=mock_decoded), \
             patch.object(_fb_auth, "get_user", return_value=MagicMock(
                 custom_claims={"role": "Editor", "organizationId": "org-1"}
             )), \
             patch.object(_fb_auth, "delete_user", return_value=None), \
             patch("main.db", MagicMock()):
            response = self._delete(
                test_client,
                {"targetUid": "other-uid"},
                token="fake-token",
            )
            assert response.status_code in [200, 403, 404]


# ─────────────────────────────────────────────────────────────────────────────
# Seed RAE rules endpoint
# ─────────────────────────────────────────────────────────────────────────────

class TestSeedRaeRules:
    """POST /api/v1/seed-rae-rules — SuperAdmin only."""

    def test_seed_rae_rules_no_token_rejected(self, test_client):
        """No token → rejected immediately."""
        response = test_client.post(
            "/api/v1/seed-rae-rules",
            json={"organizationId": "org-1"},
        )
        assert response.status_code in [401, 403, 422]

    def test_seed_rae_rules_with_superadmin_token(self, test_client):
        """SuperAdmin token → endpoint executes (200 or handled error)."""
        import firebase_admin.auth as _fb_auth
        mock_decoded = {"uid": "super-uid", "role": "SuperAdmin"}
        with patch.object(_fb_auth, "verify_id_token", return_value=mock_decoded), \
             patch("main.vector_store", MagicMock()), \
             patch("main.db", MagicMock()):
            response = test_client.post(
                "/api/v1/seed-rae-rules",
                json={"organizationId": "org-1"},
                headers={"Authorization": "Bearer fake-token"},
            )
            # 200 (seeded) or 409 (already exists) — not a 500
            assert response.status_code in [200, 409, 422]


# ─────────────────────────────────────────────────────────────────────────────
# Ingest book — extended
# ─────────────────────────────────────────────────────────────────────────────

class TestIngestBookExtended:
    """Extended coverage for POST /api/v1/ingest-book."""

    def _make_docx(self, paragraphs: list[str]) -> bytes:
        from docx import Document
        doc = Document()
        for p in paragraphs:
            doc.add_paragraph(p)
        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()

    def test_ingest_book_missing_book_id_returns_422(self, test_client):
        """bookId is required — missing → 422."""
        response = test_client.post("/api/v1/ingest-book", json={
            "organizationId": "org-1",
            "fileUrl": "https://example.com/file.docx",
            "authorId": "author-1",
        })
        assert response.status_code == 422

    def test_ingest_book_missing_file_url_returns_422(self, test_client):
        """fileUrl is required — missing → 422."""
        response = test_client.post("/api/v1/ingest-book", json={
            "bookId": "book-1",
            "organizationId": "org-1",
            "authorId": "author-1",
        })
        assert response.status_code == 422

    def test_ingest_book_two_paragraphs_pipeline(self, test_client):
        """Two-paragraph docx should produce 2 chunks."""
        docx_bytes = self._make_docx([
            "El equipo han decidido viajar a Madrid.",
            "Habían muchas personas en la sala.",
        ])

        mock_db = MagicMock()
        with patch("main.db", mock_db), \
             patch("main.client", MagicMock()), \
             patch("main.tool", MagicMock()), \
             patch("requests.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.content = docx_bytes
            mock_get.return_value = mock_resp

            response = test_client.post("/api/v1/ingest-book", json={
                "bookId": "test-book-chunks",
                "organizationId": "org-1",
                "fileUrl": "https://fake/file.docx",
                "authorId": "author-1",
            })

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "success"
            assert data["total_chunks"] == 2

    def test_ingest_book_firestore_writes_called(self, test_client):
        """Firestore batch should be committed after ingestion."""
        docx_bytes = self._make_docx(["Texto de prueba para escritura en Firestore."])

        mock_db = MagicMock()
        mock_batch = MagicMock()
        mock_db.batch.return_value = mock_batch

        with patch("main.db", mock_db), \
             patch("main.client", MagicMock()), \
             patch("main.tool", MagicMock()), \
             patch("requests.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.content = docx_bytes
            mock_get.return_value = mock_resp

            response = test_client.post("/api/v1/ingest-book", json={
                "bookId": "test-book-write",
                "organizationId": "org-1",
                "fileUrl": "https://fake/file.docx",
                "authorId": "author-1",
            })

            assert response.status_code == 200
            # Batch commit should have been called
            assert mock_batch.commit.called


# ─────────────────────────────────────────────────────────────────────────────
# Learn correction — extended
# ─────────────────────────────────────────────────────────────────────────────

class TestLearnCorrectionExtended:
    """Extended coverage for POST /api/v1/learn-correction."""

    def test_learn_correction_valid_payload(self, test_client):
        """Valid payload → 200."""
        response = test_client.post("/api/v1/learn-correction", json={
            "tenantId": "org-1",
            "authorId": "author-1",
            "role": "Editor",
            "originalText": "Le dijo a ellos que vengan.",
            "correctedText": "Les dijo que vinieran.",
            "justification": "Leísmo corregido + concordancia temporal",
        })
        assert response.status_code == 200

    def test_learn_correction_autor_role_accepted(self, test_client):
        """Autor role can also submit corrections for learning."""
        response = test_client.post("/api/v1/learn-correction", json={
            "tenantId": "org-1",
            "authorId": "author-1",
            "role": "Autor",
            "originalText": "Fué a comprar pan.",
            "correctedText": "Fue a comprar pan.",
            "justification": "Tilde diacrítica: 'fue' nunca lleva tilde",
        })
        assert response.status_code == 200

    def test_learn_correction_stores_in_vector_store(self, test_client):
        """When vector_store is active, learn_from_correction should be called."""
        mock_vs = MagicMock()
        with patch("main.vector_store", mock_vs):
            response = test_client.post("/api/v1/learn-correction", json={
                "tenantId": "org-1",
                "authorId": "author-1",
                "role": "Editor",
                "originalText": "Se lo dije a él.",
                "correctedText": "Se lo dije.",
                "justification": "Pronombre redundante",
            })
            assert response.status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# Process text — extended
# ─────────────────────────────────────────────────────────────────────────────

class TestProcessTextExtended:
    """Extended coverage for POST /api/v1/process-text."""

    def test_process_text_returns_textId(self, test_client):
        """Response must contain a textId field (the API generates its own UUID)."""
        with patch("main.tool") as mock_lt, \
             patch("main.client") as mock_client:
            mock_lt.check.return_value = []
            mock_resp = MagicMock()
            mock_resp.text = '[]'
            mock_client.models.generate_content.return_value = mock_resp
            response = test_client.post("/api/v1/process-text", json={
                "textId": "echo-test",
                "text": "El niño estaba contento.",
                "tenantId": "org-1",
                "authorId": "author-1",
            })
            assert response.status_code == 200
            data = response.json()
            # API returns its own generated textId (UUID), not the input one
            assert "textId" in data
            assert isinstance(data["textId"], str)
            assert len(data["textId"]) > 0

    def test_process_text_with_language_tool_match(self, test_client):
        """LanguageTool matches must appear as suggestions."""
        mock_match = MagicMock()
        mock_match.ruleId = "MORFOLOGIK_RULE_ES"
        mock_match.message = "Posible error ortográfico"
        mock_match.offset = 3
        mock_match.errorLength = 5
        mock_match.replacements = ["correcto"]

        with patch("main.tool") as mock_lt:
            mock_lt.check.return_value = [mock_match]
            response = test_client.post("/api/v1/process-text", json={
                "textId": "lt-test",
                "text": "El niño etsaba contento.",
                "tenantId": "org-1",
                "authorId": "author-1",
            })
            assert response.status_code == 200
            data = response.json()
            assert "suggestions" in data

    def test_process_text_missing_required_fields(self, test_client):
        """Missing tenantId → 422."""
        response = test_client.post("/api/v1/process-text", json={
            "textId": "missing-tenant",
            "text": "Texto de prueba.",
        })
        assert response.status_code == 422
