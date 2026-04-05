"""Tests for document parsing and style training."""

import pytest
from app.services.document_parser import normalize_text, parse_docx
from app.services.style_trainer import StyleTrainer


class TestNormalizeText:
    def test_collapses_whitespace(self):
        assert normalize_text("hello   world") == "hello world"

    def test_normalizes_quotes(self):
        result = normalize_text('«hola»')
        assert result == '"hola"'

    def test_strips(self):
        assert normalize_text("  hello  ") == "hello"


class TestStyleTrainer:
    def test_align_paragraphs_finds_diffs(self):
        trainer = StyleTrainer()
        original = [
            "El niño estaba contento.",
            "La casa era grande.",
            "El perro ladraba fuerte.",
        ]
        corrected = [
            "El niño se encontraba contento.",
            "La casa era grande.",
            "El perro ladraba con fuerza.",
        ]
        aligned = trainer.align_paragraphs(original, corrected, threshold=0.5)
        # Should find 2 pairs (skipping identical "La casa era grande.")
        assert len(aligned) == 2

    def test_align_empty_lists(self):
        trainer = StyleTrainer()
        aligned = trainer.align_paragraphs([], [])
        assert aligned == []

    def test_extract_rules_without_client(self):
        trainer = StyleTrainer(client=None)
        rules = trainer.extract_style_rules([("orig", "corr")])
        assert rules == []
