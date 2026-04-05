import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';

// Inicializar prestando de service-account (si está, o usar default)
// Como ai-worker tiene service-account.json, lo usamos.
const serviceAccount = JSON.parse(readFileSync('../ai-worker/service-account.json', 'utf8'));

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: "caliopebot-dad29",
});

const auth = getAuth(app);

const email = process.argv[2];
const role = process.argv[3] || 'SuperAdmin';
const organizationId = process.argv[4] || 'ZH3he4agLYMRqLwOWSLQ';

if (!email) {
  console.log("Uso: node set_claims.mjs <email> [role] [orgId]");
  process.exit(1);
}

async function main() {
  try {
    const userRecord = await auth.getUserByEmail(email);
    console.log(`Setting claims for ${userRecord.uid} (${email})...`);
    
    await auth.setCustomUserClaims(userRecord.uid, {
      role: role,
      organizationId: organizationId
    });
    
    console.log(`✅ ¡Éxito! Claims assigned: { role: "${role}", organizationId: "${organizationId}" }`);
    console.log("⚠️ IMPORTANTE: El usuario debe CERRAR SESIÓN e INICIAR SESIÓN de nuevo en el navegador para que los claims se refresquen en el JWT local.");
    process.exit(0);
  } catch(e) {
    console.error("❌ Error setting claims:", e.message);
    process.exit(1);
  }
}
main();
