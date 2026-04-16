"""
restore_rules_spanish.py
Regenera en español las normas editoriales que se eliminaron.
Usa el cliente Gemini ya configurado en el ai-worker.

Uso: cd ai-worker && python3 scripts/restore_rules_spanish.py [--dry-run]
"""

import sys
import os
import json
import time
import uuid
import argparse

# ── Setup path ─────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Cargar settings y Firebase igual que en main.py
import firebase_admin
from firebase_admin import credentials, firestore as fs

sa_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "service-account.json")
if not firebase_admin._apps:
    cred = credentials.Certificate(sa_path)
    firebase_admin.initialize_app(cred)

db = fs.client()

# ── Gemini ──────────────────────────────────────────────────
try:
    from google import genai
    from google.genai import types

    # GCP Application Default Credentials (works since service-account.json gives SA)
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        # Try to read from ai-worker .env
        env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
        if os.path.exists(env_path):
            for line in open(env_path):
                if line.startswith("GEMINI_API_KEY="):
                    api_key = line.strip().split("=", 1)[1].strip('"\'')
                    break

    if not api_key:
        print("❌ GEMINI_API_KEY no encontrada. Ejecuta: export GEMINI_API_KEY=tu_clave")
        sys.exit(1)

    client = genai.Client(api_key=api_key)
    print(f"✅ Gemini client configurado")
except Exception as e:
    print(f"❌ Error configurando Gemini: {e}")
    sys.exit(1)

# ── Org ──────────────────────────────────────────────────────
ORG_ID = "G8rTqFMuH1xFACIsjEsV"
ORG_NAME = "Biblioteca Homo Legens"

# ── Lista de normas eliminadas (del dry-run) ─────────────────
DELETED_RULES = [
    {"name": "Italics: Foreign words and Latin phrases", "source": "Nosotros", "category": "typography"},
    {"name": "Copyright Page Inclusion", "source": "Nosotros", "category": "format"},
    {"name": "Quotation Marks: Primary", "source": "Nosotros", "category": "typography"},
    {"name": "Thousand Separator for Years", "source": "Nosotros", "category": "style"},
    {"name": "Consistent Numbering Style", "source": "Nosotros", "category": "style"},
    {"name": "Italics for Foreign Words and Titles", "source": "Conservatismo", "category": "typography"},
    {"name": "Capitalization of Religious Terms", "source": "Conservatismo", "category": "grammar"},
    {"name": "Font Style", "source": "Conservatismo", "category": "format"},
    {"name": "Spelling Correction: 'umanidad'", "source": "Conservatismo", "category": "grammar"},
    {"name": "Chapter Headings Alignment", "source": "Entre los impostores", "category": "format"},
    {"name": "Chapter Title Formatting", "source": "Entre los impostores", "category": "format"},
    {"name": "Consistent Spacing", "source": "Entre los impostores", "category": "format"},
    {"name": "Verb Choice for 'marcha'", "source": "Conservatismo", "category": "style"},
    {"name": "Chapter Title Formatting", "source": "Nosotros", "category": "format"},
    {"name": "Final Page Inclusion", "source": "Nosotros", "category": "format"},
    {"name": "Em Dashes for Parenthetical Phrases", "source": "Conservatismo", "category": "typography"},
    {"name": "Block Quotes for Extended Passages", "source": "Entre los impostores", "category": "format"},
    {"name": "Punctuation: Guillemets for quotes", "source": "Nosotros", "category": "typography"},
    {"name": "Spelling Correction: 'aqullos'", "source": "Conservatismo", "category": "grammar"},
    {"name": "Punctuation: Em dashes", "source": "Conservatismo", "category": "typography"},
    {"name": "Consistency in Naming Conventions", "source": "Entre los impostores", "category": "style"},
    {"name": "Em-Dashes for Parentheticals", "source": "Entre los impostores", "category": "typography"},
    {"name": "Noun Choice for 'cole'", "source": "Conservatismo", "category": "style"},
    {"name": "Colophon Formatting", "source": "Entre los impostores", "category": "format"},
    {"name": "Spelling Correction: 'istoria'", "source": "Conservatismo", "category": "grammar"},
    {"name": "Sentence Structure and Flow", "source": "Entre los impostores", "category": "style"},
    {"name": "English Double Quotes for Secondary Quotes", "source": "Nosotros", "category": "typography"},
    {"name": "Consistency in Acronyms/Abbreviations", "source": "Conservatismo", "category": "style"},
    {"name": "Capitalization: 'Estado'", "source": "Conservatismo", "category": "grammar"},
    {"name": "Font Style: Body Text", "source": "Entre los impostores", "category": "format"},
    {"name": "Footnote Style", "source": "Entre los impostores", "category": "format"},
    {"name": "Ellipsis Spacing", "source": "Entre los impostores", "category": "typography"},
    {"name": "Spelling Correction: 'rogresismo'", "source": "Conservatismo", "category": "grammar"},
    {"name": "Typo Correction: Missing 'd' or 'g'", "source": "Conservatismo", "category": "grammar"},
    {"name": "Imprint Page Details", "source": "Nosotros", "category": "format"},
    {"name": "Table of Contents Inclusion", "source": "Nosotros", "category": "format"},
    {"name": "Comma Usage for Clarity", "source": "Entre los impostores", "category": "grammar"},
    {"name": "Use of Spanish Guillemets for Quotes", "source": "Conservatismo", "category": "typography"},
    {"name": "English Single Quotes for Tertiary Quotes", "source": "Nosotros", "category": "typography"},
    {"name": "Logo Placement", "source": "Entre los impostores", "category": "format"},
    {"name": "Page Numbering", "source": "Entre los impostores", "category": "format"},
    {"name": "Comma Usage for Parenthetical Phrases", "source": "Conservatismo", "category": "grammar"},
    {"name": "Footnote Numbering", "source": "Entre los impostores", "category": "format"},
    {"name": "Punctuation: Semicolons", "source": "Nosotros", "category": "typography"},
    {"name": "Punctuation: Periods", "source": "Entre los impostores", "category": "typography"},
    {"name": "Legal Disclaimer", "source": "Nosotros", "category": "format"},
    {"name": "Quotation Marks: Nested/Specific Terms", "source": "Conservatismo", "category": "typography"},
    {"name": "Dialogue Punctuation A", "source": "Entre los impostores", "category": "typography"},
    {"name": "Dialogue Punctuation B", "source": "Nosotros", "category": "typography"},
    {"name": "Em Dash Usage in Dialogue", "source": "Conservatismo", "category": "typography"},
    {"name": "Content Expansion/Clarification", "source": "Entre los impostores", "category": "style"},
    {"name": "Quotation Marks Usage", "source": "Conservatismo", "category": "typography"},
    {"name": "Paragraph Indentation", "source": "Entre los impostores", "category": "format"},
    {"name": "Pronoun Agreement", "source": "Conservatismo", "category": "grammar"},
    {"name": "Punctuation: Ellipses", "source": "Nosotros", "category": "typography"},
    {"name": "Typo Correction: 'onservatismo'", "source": "Conservatismo", "category": "grammar"},
    {"name": "Internal Thoughts Punctuation", "source": "Entre los impostores", "category": "typography"},
    {"name": "Text Alignment", "source": "Entre los impostores", "category": "format"},
    {"name": "Punctuation: Spacing", "source": "Entre los impostores", "category": "typography"},
    {"name": "Adjective Choice for 'digno'", "source": "Conservatismo", "category": "style"},
    {"name": "Title Page Structure", "source": "Nosotros", "category": "format"},
    {"name": "Chapter Titles: Numbering", "source": "Entre los impostores", "category": "format"},
    {"name": "Text Justification", "source": "Entre los impostores", "category": "format"},
    {"name": "Typo Correction: Missing 'r'", "source": "Conservatismo", "category": "grammar"},
    {"name": "Spelling Correction: 'ealeza'", "source": "Conservatismo", "category": "grammar"},
    {"name": "Page Numbering (portada)", "source": "Nosotros", "category": "format"},
    {"name": "Use of Em-dashes for Parenthetical Phrases", "source": "Conservatismo", "category": "typography"},
    {"name": "Page Number Placement", "source": "Nosotros", "category": "format"},
    {"name": "Dedication Page", "source": "Nosotros", "category": "format"},
    {"name": "Spelling Correction: 'erecho'", "source": "Conservatismo", "category": "grammar"},
    {"name": "Font Style (Nosotros)", "source": "Nosotros", "category": "format"},
    {"name": "Dialogue Punctuation C", "source": "Conservatismo", "category": "typography"},
    {"name": "Colophon Inclusion", "source": "Nosotros", "category": "format"},
    {"name": "First Paragraph Indentation", "source": "Entre los impostores", "category": "format"},
    {"name": "Spanish Guillemets for Quotes", "source": "Entre los impostores", "category": "typography"},
    {"name": "Spelling Correction: 'onarca'", "source": "Conservatismo", "category": "grammar"},
    {"name": "Punctuation: Colons", "source": "Entre los impostores", "category": "typography"},
    {"name": "Capitalization: 'Humanidad'", "source": "Conservatismo", "category": "grammar"},
    {"name": "Chapter Title Formatting (Conservatismo)", "source": "Conservatismo", "category": "format"},
    {"name": "Ellipsis Character", "source": "Nosotros", "category": "typography"},
    {"name": "Consistency in Noun Usage", "source": "Entre los impostores", "category": "style"},
    {"name": "Capitalization After Dialogue Tag", "source": "Entre los impostores", "category": "grammar"},
    {"name": "Footnote Usage", "source": "Conservatismo", "category": "format"},
    {"name": "Chapter Title Formatting (Nosotros B)", "source": "Nosotros", "category": "format"},
    {"name": "Grade Level Terminology", "source": "Conservatismo", "category": "style"},
    {"name": "Em Dashes for Parenthetical Phrases (Nosotros)", "source": "Nosotros", "category": "typography"},
    {"name": "Bibliography Format", "source": "Entre los impostores", "category": "format"},
    {"name": "Capitalization of Proper Nouns", "source": "Conservatismo", "category": "grammar"},
    {"name": "Dedication Page Formatting", "source": "Nosotros", "category": "format"},
    {"name": "List Item Markers", "source": "Nosotros", "category": "format"},
    {"name": "Ellipses Formatting", "source": "Conservatismo", "category": "typography"},
    {"name": "Possessive Pronoun Usage", "source": "Entre los impostores", "category": "grammar"},
]


def translate_batch(batch: list) -> list:
    """Translate a batch of English rule names to Spanish using Gemini."""
    list_text = "\n".join(
        f'{i+1}. "{r["name"]}" (fuente: {r["source"]}, categoría: {r["category"]})'
        for i, r in enumerate(batch)
    )
    prompt = f"""Eres un editor experto en lengua española. 
Para cada norma editorial de la siguiente lista, proporciona en español:
- "nombre": nombre breve y claro de la norma editorial (máx. 8 palabras, en español)
- "descripcion": explicación práctica concisa de la norma (1-2 frases, en español)

Lista de normas (originalmente en inglés por un error del sistema, ahora deben traducirse):
{list_text}

Devuelve exactamente un array JSON con {len(batch)} objetos.
Cada objeto debe tener los campos "nombre" y "descripcion" en español.
IMPORTANTE: Toda la respuesta debe estar en español. No uses inglés en ningún campo."""

    schema = {
        "type": "ARRAY",
        "items": {
            "type": "OBJECT",
            "properties": {
                "nombre": {"type": "STRING"},
                "descripcion": {"type": "STRING"},
            },
            "required": ["nombre", "descripcion"],
        },
    }

    try:
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema,
                temperature=0.2,
            ),
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"  ⚠️  Error Gemini: {e}")
        # Fallback: return minimal Spanish names
        return [{"nombre": r["name"], "descripcion": f"Norma aplicada en {r['source']}."} for r in batch]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    dry = args.dry_run
    print(f"\n🌐 Restaurando {len(DELETED_RULES)} normas en español para: {ORG_NAME}")
    if dry:
        print("   (DRY RUN — no se escribirá nada en Firestore)\n")

    org_ref = db.collection("organizations").document(ORG_ID)
    BATCH_SIZE = 10
    total = 0

    for i in range(0, len(DELETED_RULES), BATCH_SIZE):
        batch = DELETED_RULES[i:i + BATCH_SIZE]
        end = min(i + BATCH_SIZE, len(DELETED_RULES))
        print(f"📦 Procesando {i+1}-{end}/{len(DELETED_RULES)}...")

        translated = translate_batch(batch)

        if not dry:
            firestore_batch = db.batch()
            for j, rule in enumerate(batch):
                t = translated[j] if j < len(translated) else {"nombre": rule["name"], "descripcion": ""}
                rule_id = f"restored_{uuid.uuid4().hex[:10]}"
                rule_ref = org_ref.collection("rules").document(rule_id)
                firestore_batch.set(rule_ref, {
                    "id": rule_id,
                    "name": t["nombre"],
                    "rule": t["nombre"],
                    "description": t["descripcion"],
                    "category": rule["category"],
                    "source": rule["source"],
                    "status": "active",
                    "createdAt": fs.SERVER_TIMESTAMP,
                })
                print(f"  ✅ \"{rule['name']}\" → \"{t['nombre']}\"")
                total += 1
            firestore_batch.commit()
        else:
            for j, rule in enumerate(batch):
                t = translated[j] if j < len(translated) else {"nombre": rule["name"], "descripcion": ""}
                print(f"  [dry] \"{rule['name']}\" → \"{t['nombre']}\"")

        time.sleep(1)  # rate limit

    print(f"\n✅ Total restauradas: {total}")


if __name__ == "__main__":
    main()
