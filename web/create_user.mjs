import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAYweFWayrIHDxn5b5YrFk66ykQWB4UuFc",
  authDomain: "caliopebot-dad29.firebaseapp.com",
  projectId: "caliopebot-dad29",
  storageBucket: "caliopebot-dad29.firebasestorage.app",
  messagingSenderId: "619707632932",
  appId: "1:619707632932:web:80ef6516bc8100a86337b1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const email = process.argv[2];
const password = process.argv[3];
const role = process.argv[4] || 'SuperAdmin';

if (!email || !password) {
  console.log("Uso: node create_user.mjs <email> <password> [role]");
  process.exit(1);
}

console.log(`Creando usuario ${email} con rol ${role}...`);

async function main() {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;
    
    await setDoc(doc(db, 'users', uid), {
      email,
      role,
      createdAt: serverTimestamp()
    });
    
    console.log(`✅ ¡Éxito! Usuario creado. Ya puedes iniciar sesión con él.`);
    process.exit(0);
  } catch(e) {
    console.error("❌ Error creando el usuario:", e.message);
    process.exit(1);
  }
}
main();
