"""RAG context builder for LLM prompt injection."""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def build_rag_context(
    vector_store,
    org_id: str,
    author_id: str,
    text: str,
    max_rules: int = 5,
    max_prefs: int = 3,
) -> str:
    """Build RAG context by querying editorial rules and author preferences.
    
    Returns a formatted string ready for injection into LLM prompts.
    """
    sections = []

    # Query editorial rules
    rules = vector_store.query_editorial_rules(org_id, text, top_k=max_rules)
    if rules:
        rule_lines = []
        seen = set()
        for r in rules:
            # Deduplicate by content
            key = r["text"][:100]
            if key not in seen:
                seen.add(key)
                rule_lines.append(f"  - {r['text']}")
        if rule_lines:
            sections.append(
                "REGLAS EDITORIALES DE LA ORGANIZACIÓN:\n" + "\n".join(rule_lines)
            )

    # Query author preferences
    prefs = vector_store.query_author_style(author_id, text, top_k=max_prefs)
    if prefs:
        pref_lines = []
        seen = set()
        for p in prefs:
            key = p["text"][:100]
            if key not in seen:
                seen.add(key)
                pref_lines.append(f"  - {p['text']}")
        if pref_lines:
            sections.append(
                "PREFERENCIAS DE ESTILO DEL AUTOR:\n" + "\n".join(pref_lines)
            )

    if not sections:
        return "No hay reglas editoriales ni preferencias de estilo registradas aún."

    return "\n\n".join(sections)
