import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate('ai-worker/service-account.json')
firebase_admin.initialize_app(cred)
db = firestore.client()

books = db.collection('organizations').document('ZH3he4agLYMRqLwOWSLQ').collection('books').where(filter=firestore.FieldFilter("title", "==", "Test Automated Manuscript")).get()

if books:
    book_id = books[0].id
    chunks = db.collection('organizations').document('ZH3he4agLYMRqLwOWSLQ').collection('books').document(book_id).collection('paragraphs').get()
    print(f"Book ID: {book_id}")
    print(f"Number of paragraph chunks fetched: {len(chunks)}")
    if chunks:
        print(f"First chunk text: {chunks[0].to_dict().get('originalText')}")
else:
    print("No automated book found.")
