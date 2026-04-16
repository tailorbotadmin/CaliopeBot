"""
seed_rae_rules.py
-----------------
Siembra las reglas canónicas de la RAE (Ortografía 2010 + DPD)
en Firestore (colección `rules`) y ChromaDB para la organización
'Biblioteca Homo Legens'.

Uso:
    python3 ai-worker/scripts/seed_rae_rules.py
"""

import os
import sys

# ---------------------------------------------------------------------------
# Firebase
# ---------------------------------------------------------------------------
import firebase_admin
from firebase_admin import credentials, firestore

def get_db():
    sa_path = os.path.join(os.path.dirname(__file__), '..', 'service-account.json')
    if os.path.exists(sa_path):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = sa_path
    try:
        firebase_admin.get_app()
    except ValueError:
        if os.path.exists(sa_path):
            cred = credentials.Certificate(sa_path)
            firebase_admin.initialize_app(cred, options={'projectId': 'caliopebot-dad29'})
        else:
            firebase_admin.initialize_app(options={'projectId': 'caliopebot-dad29'})
    return firestore.client()

# ---------------------------------------------------------------------------
# ChromaDB
# ---------------------------------------------------------------------------
CHROMA_DIR = os.path.join(os.path.dirname(__file__), '..', 'chroma_data')

def get_vector_store():
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    from app.services.vector_store import EditorialVectorStore
    return EditorialVectorStore(persist_dir=CHROMA_DIR)

# ---------------------------------------------------------------------------
# RAE Rules corpus
# ---------------------------------------------------------------------------
# Imported from the pure data module to avoid duplication
import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from rae_rules_corpus import RAE_RULES  # noqa: E402


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("📚 Conectando a Firebase...")
    db = get_db()

    # Find org
    orgs = db.collection('organizations').where('name', '==', 'Biblioteca Homo Legens').limit(1).get()
    if not orgs:
        print("❌ Organización 'Biblioteca Homo Legens' no encontrada en Firestore.")
        sys.exit(1)
    org_id = orgs[0].id
    print(f"   Org ID: {org_id}")

    print("🗃️  Inicializando ChromaDB...")
    try:
        vs = get_vector_store()
        chroma_ok = True
    except Exception as e:
        print(f"   ⚠️  ChromaDB no disponible: {e}. Solo se escribirá en Firestore.")
        chroma_ok = False

    org_ref = db.collection('organizations').document(org_id)

    print(f"\n➡️  Sembrando {len(RAE_RULES)} reglas RAE...")
    batch = db.batch()
    batch_count = 0

    for i, rule in enumerate(RAE_RULES):
        rule_id = f"rae_{i:03d}"
        firestore_doc = {
            **rule,
            "status": "active",
            "source": rule.get("source", "RAE"),
            "createdAt": firestore.SERVER_TIMESTAMP,
        }

        # Firestore
        rule_ref = org_ref.collection('rules').document(rule_id)
        batch.set(rule_ref, firestore_doc)
        batch_count += 1

        # ChromaDB
        if chroma_ok:
            chroma_text = f"{rule['name']}: {rule['description']}"
            vs.add_editorial_rule(
                org_id, rule_id, chroma_text,
                metadata={"category": rule["category"], "source": rule.get("source", "RAE")}
            )

        # Commit Firestore every 400 docs (safe under 500 limit)
        if batch_count >= 400:
            batch.commit()
            batch = db.batch()
            batch_count = 0

    if batch_count > 0:
        batch.commit()

    print(f"\n✅ Completado.")
    print(f"   • {len(RAE_RULES)} reglas escritas en Firestore → organizations/{org_id}/rules")
    if chroma_ok:
        print(f"   • {len(RAE_RULES)} reglas indexadas en ChromaDB → editorial_rules_{org_id}")
    print(f"\n💡 Las reglas ya están activas en el pipeline RAG para 'Biblioteca Homo Legens'.")
    print(f"   LanguageTool ya aplica ortografía RAE por defecto (es-ES).")
    print(f"   Los agentes Crítico y Árbitro consultarán estas reglas en cada corrección.")

if __name__ == "__main__":
    main()
