import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync('../ai-worker/service-account.json', 'utf8'));

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: "caliopebot-dad29",
});

const auth = getAuth(app);

const emails = process.argv.slice(2);

if (emails.length === 0) {
  console.log("Uso: node send_password_reset.mjs <email1> [email2] ...");
  process.exit(1);
}

async function main() {
  for (const email of emails) {
    try {
      // Generate a password reset link
      const link = await auth.generatePasswordResetLink(email, {
        url: 'https://caliope.tailorbot.tech/dashboard',
        handleCodeInApp: false,
      });
      console.log(`✅ Reset link generado para ${email}:`);
      console.log(`   ${link}`);
      console.log('');
    } catch (e) {
      console.error(`❌ Error para ${email}:`, e.message);
    }
  }
  process.exit(0);
}

main();
