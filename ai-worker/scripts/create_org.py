"""
create_org.py
-------------
Crea organizaciones en Firestore o lista las existentes.

Uso:
    python3 create_org.py --name "Editorial Anagrama"
    python3 create_org.py --list
    python3 create_org.py --name "Org X" --list   # crea y luego lista

Requiere: GOOGLE_APPLICATION_CREDENTIALS o service-account.json en ../
"""

import argparse
import os
import sys

import firebase_admin
from firebase_admin import credentials, firestore

# ── Firebase init ────────────────────────────────────────────────────────────

def get_db():
    sa_path = os.path.join(os.path.dirname(__file__), '..', 'service-account.json')
    try:
        firebase_admin.get_app()
    except ValueError:
        if os.path.exists(sa_path):
            cred = credentials.Certificate(sa_path)
            firebase_admin.initialize_app(cred, options={'projectId': 'caliopebot-dad29'})
        else:
            # Fallback: Application Default Credentials (Cloud Run / CI)
            firebase_admin.initialize_app(options={'projectId': 'caliopebot-dad29'})
    return firestore.client()


# ── Actions ──────────────────────────────────────────────────────────────────

def create_org(db, name: str) -> str:
    """Create org if it doesn't exist. Returns the org ID."""
    existing = db.collection('organizations').where('name', '==', name).limit(1).get()
    if existing:
        org_id = existing[0].id
        print(f"ℹ️  La organización '{name}' ya existe → ID: {org_id}")
        return org_id

    _, ref = db.collection('organizations').add({
        'name': name,
        'createdAt': firestore.SERVER_TIMESTAMP,
    })
    print(f"✅ Organización creada: '{name}' → ID: {ref.id}")
    return ref.id


def list_orgs(db):
    """Print all organizations with their IDs."""
    orgs = db.collection('organizations').order_by('name').get()
    if not orgs:
        print("ℹ️  No hay organizaciones en Firestore.")
        return
    print(f"\n{'ID':<28}  Nombre")
    print("─" * 60)
    for org in orgs:
        data = org.to_dict()
        print(f"{org.id:<28}  {data.get('name', '—')}")
    print(f"\nTotal: {len(orgs)} organización(es)\n")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Gestiona organizaciones en Firestore para CalíopeBot.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python3 create_org.py --name "Editorial Anagrama"
  python3 create_org.py --list
  python3 create_org.py --name "Nueva Org" --list
        """,
    )
    parser.add_argument('--name', type=str, help="Nombre de la organización a crear")
    parser.add_argument('--list', action='store_true', help="Listar todas las organizaciones existentes")

    args = parser.parse_args()

    if not args.name and not args.list:
        parser.print_help()
        sys.exit(1)

    db = get_db()

    if args.name:
        create_org(db, args.name.strip())

    if args.list:
        list_orgs(db)


if __name__ == '__main__':
    main()
