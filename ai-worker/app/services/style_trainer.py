"""ML training pipeline: compare DOCX manuscripts with corrected PDFs to learn editorial style."""

import os
import json
import time
import logging
import difflib
from typing import List, Tuple, Dict, Optional

from app.services.document_parser import parse_docx, parse_pdf, normalize_text

logger = logging.getLogger(__name__)


class StyleTrainer:
    """Extracts editorial style rules by comparing manuscript/corrected pairs."""

    def __init__(self, client=None, vector_store=None):
        self.client = client
        self.vector_store = vector_store

    def extract_text_from_docx(self, file_path: str) -> List[str]:
        """Extract paragraph texts from a DOCX file."""
        from docx import Document as DocxDocument
        doc = DocxDocument(file_path)
        return [p.text.strip() for p in doc.paragraphs if p.text.strip()]

    def extract_text_from_pdf(self, file_path: str) -> List[str]:
        """Extract paragraph texts from a PDF file."""
        import fitz
        doc = fitz.open(file_path)
        paragraphs = []
        for page in doc:
            text = page.get_text()
            for para in text.split("\n\n"):
                cleaned = para.strip()
                if cleaned and len(cleaned) > 20:
                    paragraphs.append(cleaned)
        doc.close()
        return paragraphs

    def align_paragraphs(
        self, original: List[str], corrected: List[str], threshold: float = 0.5
    ) -> List[Tuple[str, str]]:
        """Smart paragraph alignment using SequenceMatcher.
        
        Returns list of (original, corrected) tuples where content differs.
        """
        aligned = []
        matcher = difflib.SequenceMatcher(
            None,
            [normalize_text(p) for p in original],
            [normalize_text(p) for p in corrected],
        )

        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                continue  # No changes, skip
            elif tag == "replace":
                # Pair up replacements
                for k in range(min(i2 - i1, j2 - j1)):
                    orig = original[i1 + k]
                    corr = corrected[j1 + k]
                    ratio = difflib.SequenceMatcher(None, normalize_text(orig), normalize_text(corr)).ratio()
                    if ratio >= threshold:
                        aligned.append((orig, corr))
            # 'insert' and 'delete' indicate structural changes, skip for now

        logger.info(f"Aligned {len(aligned)} paragraph pairs (threshold={threshold})")
        return aligned

    def extract_style_rules(
        self, pairs: List[Tuple[str, str]], max_pairs: int = 50
    ) -> List[Dict]:
        """Use Gemini to deduce editorial rules from aligned paragraph pairs."""
        if not self.client:
            logger.warning("No LLM client available, returning empty rules")
            return []

        # Build comparison text (limit to avoid token overflow)
        comparison_text = ""
        for i, (orig, corr) in enumerate(pairs[:max_pairs]):
            comparison_text += f"\n--- Par {i+1} ---\nORIGINAL: {orig[:500]}\nCORREGIDO: {corr[:500]}\n"

        from google.genai import types

        schema = {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "description": {"type": "STRING"},
                    "category": {"type": "STRING"},
                    "examples": {"type": "STRING"},
                },
                "required": ["name", "description", "category"],
            },
        }

        prompt = f"""Eres un Analista Editorial experto en español.
Analiza los siguientes pares de texto (original vs corregido) y DEDUCE las reglas editoriales sistemáticas que aplicó el corrector.
No devuelvas correcciones puntuales, sino REGLAS GENERALES y patrones repetidos.
Categoriza cada regla como: style, grammar, format, o typography.

{comparison_text}"""

        try:
            response = self.client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=schema,
                    temperature=0.2,
                ),
            )
            rules = json.loads(response.text)
            logger.info(f"Extracted {len(rules)} style rules from {len(pairs)} pairs")
            return rules
        except Exception as e:
            logger.error(f"Error extracting rules: {e}")
            return []

    def process_manuscript_pair(
        self, docx_path: str, pdf_path: str, org_id: str, db=None
    ) -> List[Dict]:
        """Full pipeline: extract texts, align, extract rules, store."""
        logger.info(f"Processing pair: {os.path.basename(docx_path)} ↔ {os.path.basename(pdf_path)}")

        # 1. Extract texts
        orig_paragraphs = self.extract_text_from_docx(docx_path)
        corr_paragraphs = self.extract_text_from_pdf(pdf_path)
        logger.info(f"Extracted {len(orig_paragraphs)} original, {len(corr_paragraphs)} corrected paragraphs")

        # 2. Align paragraphs
        aligned = self.align_paragraphs(orig_paragraphs, corr_paragraphs)
        if not aligned:
            logger.warning("No aligned pairs found")
            return []

        # 3. Extract rules
        rules = self.extract_style_rules(aligned)

        # 4. Store in Firestore + Vector DB
        if db and rules:
            from firebase_admin import firestore as fs
            batch = db.batch()
            org_ref = db.collection("organizations").document(org_id)
            for rule in rules:
                import uuid
                rule_id = f"style_{uuid.uuid4().hex[:8]}"
                rule_data = {
                    "id": rule_id,
                    "rule": rule.get("name", ""),
                    "description": rule.get("description", ""),
                    "category": rule.get("category", "style"),
                    "source": os.path.basename(docx_path),
                    "status": "pending",
                    "createdAt": fs.SERVER_TIMESTAMP,
                }
                batch.set(org_ref.collection("pendingRules").document(rule_id), rule_data)

                # Also inject into vector store
                if self.vector_store:
                    self.vector_store.add_editorial_rule(
                        org_id, rule_id,
                        f"{rule.get('name', '')}: {rule.get('description', '')}",
                        {"category": rule.get("category", "style"), "source": os.path.basename(docx_path)},
                    )
            batch.commit()
            logger.info(f"Stored {len(rules)} rules in Firestore and vector store")

        return rules

    def batch_process_manuscripts(self, directory: str, org_id: str, db=None) -> int:
        """Find all Manuscrito/Versión Final pairs and process them."""
        import glob
        docx_files = sorted(glob.glob(os.path.join(directory, "*Manuscrito.docx")))
        total_rules = 0

        for docx_path in docx_files:
            base_name = docx_path.replace(" Manuscrito.docx", "")
            pdf_path = f"{base_name} Versión Final.pdf"

            if not os.path.exists(pdf_path):
                logger.warning(f"No PDF found for {os.path.basename(docx_path)}")
                continue

            try:
                rules = self.process_manuscript_pair(docx_path, pdf_path, org_id, db)
                total_rules += len(rules)
                time.sleep(15)  # Rate limiting between pairs
            except Exception as e:
                logger.error(f"Error processing {os.path.basename(docx_path)}: {e}")

        logger.info(f"Batch complete: {total_rules} total rules from {len(docx_files)} manuscripts")
        return total_rules
