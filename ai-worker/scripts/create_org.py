import os
import firebase_admin
from firebase_admin import credentials, firestore

try:
    firebase_admin.get_app()
except ValueError:
    firebase_admin.initialize_app(options={'projectId': 'caliopebot-dad29'})

db = firestore.client()

orgs_ref = db.collection('organizations')
query = orgs_ref.where('name', '==', 'Biblioteca Homo Legens').limit(1).get()

if not query:
    _, new_ref = orgs_ref.add({
        'name': 'Biblioteca Homo Legens',
        'createdAt': firestore.SERVER_TIMESTAMP
    })
    print(f"Created Organization: Biblioteca Homo Legens with ID: {new_ref.id}")
else:
    print(f"Organization already exists with ID: {query[0].id}")
