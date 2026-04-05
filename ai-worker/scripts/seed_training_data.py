import firebase_admin
from firebase_admin import credentials, firestore
import json
import os

# Path to the service account
cred_path = os.path.join(os.path.dirname(__file__), "..", "service-account.json")

# Initialize Firebase (Only once)
try:
    firebase_admin.get_app()
except ValueError:
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred, {
        "projectId": "caliopebot-dad29"
    })

db = firestore.client()

def seed_training_data():
    # 1. Get the organization (Biblioteca Homo Legens)
    orgs_ref = db.collection("organizations").where("name", "==", "Biblioteca Homo Legens").stream()
    org_id = None
    for org in orgs_ref:
        org_id = org.id
        break
        
    if not org_id:
        print("Error: Organization 'Biblioteca Homo Legens' not found.")
        return
        
    print(f"Adding training samples to organization: {org_id}")
    
    samples = [
        {
            "original": "El equipo han decidido que...",
            "aiSuggestion": "El equipo ha decidido que...",
            "rule": "Concordancia sujeto-verbo (colectivos en singular)",
            "status": "pending",
            "organizationId": org_id,
            "bookId": "sample_book_1",
            "createdAt": firestore.SERVER_TIMESTAMP
        },
        {
            "original": "Habían muchas personas en la sala.",
            "aiSuggestion": "Había muchas personas en la sala.",
            "rule": "Verbo haber impersonal en singular",
            "status": "pending",
            "organizationId": org_id,
            "bookId": "sample_book_1",
            "createdAt": firestore.SERVER_TIMESTAMP
        },
        {
            "original": "Le dijo a ellos: \"vengan mañana\"",
            "aiSuggestion": "Les dijo: «vengan mañana»",
            "rule": "Leísmo + comillas latinas (norma editorial)",
            "status": "approved",
            "organizationId": org_id,
            "bookId": "sample_book_2",
            "createdAt": firestore.SERVER_TIMESTAMP
        }
    ]
    
    batch = db.batch()
    for sample in samples:
        ref = db.collection("training_samples").document()
        batch.set(ref, sample)
        
    batch.commit()
    print("Successfully seeded 3 training samples into Firestore!")

if __name__ == "__main__":
    seed_training_data()
