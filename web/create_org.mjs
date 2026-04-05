import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
  readFileSync('./serviceAccountKey.json', 'utf8')
);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function run() {
    try {
        console.log("Checking for Biblioteca Homo Legens...");
        const orgsRef = db.collection('organizations');
        const snapshot = await orgsRef.where('name', '==', 'Biblioteca Homo Legens').get();
        if (snapshot.empty) {
            const newOrgRef = await orgsRef.add({
                name: 'Biblioteca Homo Legens',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log("Created Organization: Biblioteca Homo Legens with ID:", newOrgRef.id);
        } else {
            console.log("Organization already exists with ID:", snapshot.docs[0].id);
        }
    } catch (e) {
        console.error("Error creating organization", e);
    }
}
run();
