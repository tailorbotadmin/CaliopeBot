/**
 * create_user.mjs
 * ---------------
 * Crea o actualiza un usuario en Firebase Auth con su perfil en Firestore
 * y los custom claims de rol necesarios para el dashboard.
 *
 * Usa Firebase Admin SDK (requiere service-account.json).
 * Las credenciales NUNCA se hardcodean en este archivo.
 *
 * Uso:
 *   node create_user.mjs <email> <password> <role> [orgId]
 *
 * Roles válidos: SuperAdmin, Admin, Responsable_Editorial, Editor, Autor, Traductor
 *
 * Ejemplos:
 *   node create_user.mjs admin@org.com secreto123 Admin abc123org
 *   node create_user.mjs super@tailorbot.tech pass123 SuperAdmin
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth }             from "firebase-admin/auth";
import { getFirestore }        from "firebase-admin/firestore";
import { readFileSync }        from "fs";
import { resolve, dirname }    from "path";
import { fileURLToPath }       from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALID_ROLES = [
  "SuperAdmin",
  "Admin",
  "Responsable_Editorial",
  "Editor",
  "Autor",
  "Traductor",
];

// ── Args ────────────────────────────────────────────────────────────────────
const [,, email, password, role = "SuperAdmin", orgId = null] = process.argv;

if (!email || !password) {
  console.log("Uso: node create_user.mjs <email> <password> <role> [orgId]");
  console.log(`Roles: ${VALID_ROLES.join(", ")}`);
  process.exit(1);
}

if (!VALID_ROLES.includes(role)) {
  console.error(`❌ Rol inválido: "${role}". Debe ser uno de: ${VALID_ROLES.join(", ")}`);
  process.exit(1);
}

if (role !== "SuperAdmin" && !orgId) {
  console.error(`❌ El rol "${role}" requiere un orgId como 4º argumento.`);
  process.exit(1);
}

// ── Firebase Admin init (usa service account, sin credenciales hardcodeadas) ──
const saPath = resolve(__dirname, "../ai-worker/service-account.json");
let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(saPath, "utf8"));
} catch {
  console.error(`❌ No se encontró service-account.json en: ${saPath}`);
  console.error("   Copia el archivo desde Firebase Console → Configuración → Service Accounts.");
  process.exit(1);
}

const app  = initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  try {
    let userRecord;

    try {
      userRecord = await auth.getUserByEmail(email);
      console.log(`ℹ️  Usuario ya existe. Actualizando contraseña...`);
      await auth.updateUser(userRecord.uid, { password });
    } catch (e) {
      if (e.code === "auth/user-not-found") {
        userRecord = await auth.createUser({ email, password, displayName: email.split("@")[0] });
        console.log(`✅ Usuario creado en Firebase Auth.`);
      } else throw e;
    }

    // Custom claims (role + organizationId)
    const claims = orgId ? { role, organizationId: orgId } : { role };
    await auth.setCustomUserClaims(userRecord.uid, claims);

    // Firestore profile
    await db.collection("users").doc(userRecord.uid).set({
      email,
      role,
      organizationId: orgId ?? null,
      displayName: email.split("@")[0],
      createdAt: new Date(),
    }, { merge: true });

    console.log(`\n✅ Listo:`);
    console.log(`   uid:            ${userRecord.uid}`);
    console.log(`   email:          ${email}`);
    console.log(`   role:           ${role}`);
    if (orgId) console.log(`   organizationId: ${orgId}`);
    process.exit(0);
  } catch (e) {
    console.error("❌ Error:", e.message);
    process.exit(1);
  }
}

main();
