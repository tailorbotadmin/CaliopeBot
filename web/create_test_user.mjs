import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';

// Inicializar prestando de service-account (si está, o usar default)
const serviceAccount = JSON.parse(readFileSync('../ai-worker/service-account.json', 'utf8'));

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: "caliopebot-dad29",
});

const auth = getAuth(app);

async function main() {
  try {
    const email = "test_e2e@tailorbot.tech";
    const password = "testpassword123";
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
      console.log("Test user already exists.");
      await auth.updateUser(userRecord.uid, { password });
    } catch(e) {
      if (e.code === 'auth/user-not-found') {
        userRecord = await auth.createUser({
          email: email,
          password: password,
          displayName: "E2E Test User",
        });
        console.log("Created testing user.");
      } else {
        throw e;
      }
    }
    
    // Set custom claims for the test user
    const role = 'SuperAdmin';
    const organizationId = 'ZH3he4agLYMRqLwOWSLQ';
    await auth.setCustomUserClaims(userRecord.uid, { role, organizationId });
    console.log(`✅ ¡Éxito! Claims assigned for testing user.`);
    process.exit(0);
  } catch(e) {
    console.error("❌ Error setting claims:", e.message);
    process.exit(1);
  }
}
main();
