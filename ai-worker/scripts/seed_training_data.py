"""
seed_training_data.py
---------------------
Inserta muestras de entrenamiento de ejemplo en Firestore para una organización.

Uso:
    python3 seed_training_data.py --org-id <firestoreOrgId>

Obtén el ID con:
    python3 create_org.py --list
"""

import argparse
import os
import sys

import firebase_admin
from firebase_admin import credentials, firestore


# ── Firebase init ─────────────────────────────────────────────────────────────

def get_db():
    sa_path = os.path.join(os.path.dirname(__file__), '..', 'service-account.json')
    try:
        firebase_admin.get_app()
    except ValueError:
        if os.path.exists(sa_path):
            cred = credentials.Certificate(sa_path)
            firebase_admin.initialize_app(cred, options={'projectId': 'caliopebot-dad29'})
        else:
            firebase_admin.initialize_app(options={'projectId': 'caliopebot-dad29'})
    return firestore.client()


# ── Training samples ──────────────────────────────────────────────────────────

SAMPLES = [
    {
        "original": "El equipo han decidido que...",
        "aiSuggestion": "El equipo ha decidido que...",
        "rule": "Concordancia sujeto-verbo (colectivos en singular)",
        "status": "pending",
        "bookId": "sample_book_1",
    },
    {
        "original": "Habían muchas personas en la sala.",
        "aiSuggestion": "Había muchas personas en la sala.",
        "rule": "Verbo haber impersonal en singular",
        "status": "pending",
        "bookId": "sample_book_1",
    },
    {
        "original": "Le dijo a ellos: \"vengan mañana\"",
        "aiSuggestion": "Les dijo: «vengan mañana»",
        "rule": "Leísmo + comillas latinas (norma editorial)",
        "status": "approved",
        "bookId": "sample_book_2",
    },
    {
        "original": "Fué a la tienda ayer.",
        "aiSuggestion": "Fue a la tienda ayer.",
        "rule": "Tilde diacrítica: 'fue' nunca lleva tilde",
        "status": "approved",
        "bookId": "sample_book_2",
    },
    {
        "original": "Solo quería decirte que te quiero.",
        "aiSuggestion": "Solo quería decirte que te quiero.",
        "rule": "RAE 2010: 'solo' (adverbio) sin tilde",
        "status": "approved",
        "bookId": "sample_book_2",
    },
]


# ── Main ──────────────────────────────────────────────────────────────────────

def seed(db, org_id: str):
    existing = db.collection("training_samples").where("organizationId", "==", org_id).limit(1).get()
    if existing:
        print(f"ℹ️  Ya existen muestras de entrenamiento para la org {org_id}.")
        print("   Usa --force para insertar igualmente.")
        return

    batch = db.batch()
    for sample in SAMPLES:
        ref = db.collection("training_samples").document()
        batch.set(ref, {
            **sample,
            "organizationId": org_id,
            "createdAt": firestore.SERVER_TIMESTAMP,
        })
    batch.commit()
    print(f"✅ {len(SAMPLES)} muestras de entrenamiento insertadas para org: {org_id}")


def main():
    parser = argparse.ArgumentParser(
        description="Inserta muestras de entrenamiento de ejemplo en Firestore.",
        epilog="Ejemplo: python3 seed_training_data.py --org-id ZH3he4agLYMRqLwOWSLQ",
    )
    parser.add_argument("--org-id", required=True, help="ID de la organización en Firestore")
    parser.add_argument("--force", action="store_true", help="Insertar aunque ya haya muestras")
    args = parser.parse_args()

    db = get_db()

    if args.force:
        # Skip duplicate check
        batch = db.batch()
        for sample in SAMPLES:
            ref = db.collection("training_samples").document()
            batch.set(ref, {
                **sample,
                "organizationId": args.org_id,
                "createdAt": firestore.SERVER_TIMESTAMP,
            })
        batch.commit()
        print(f"✅ {len(SAMPLES)} muestras insertadas (--force) para org: {args.org_id}")
    else:
        seed(db, args.org_id)


if __name__ == "__main__":
    main()
