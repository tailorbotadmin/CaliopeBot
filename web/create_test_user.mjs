/**
 * create_test_user.mjs
 * --------------------
 * Creates or updates a Firebase Auth user with custom claims.
 * Reads the service account from ../ai-worker/service-account.json.
 *
 * Usage:
 *   node create_test_user.mjs [options]
 *
 * Options:
 *   --email      <email>   User email (default: test_e2e@tailorbot.tech)
 *   --password   <pwd>     User password (default: testpassword123)
 *   --role       <role>    One of: SuperAdmin, Admin, Responsable_Editorial,
 *                          Editor, Autor, Traductor (default: SuperAdmin)
 *   --orgId      <id>      Firestore organization document ID (required for
 *                          non-SuperAdmin roles; optional for SuperAdmin)
 *   --help                 Show this help message
 *
 * Examples:
 *   node create_test_user.mjs --email editor@org.com --role Editor --orgId abc123
 *   node create_test_user.mjs  # uses all defaults
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALID_ROLES = [
  "SuperAdmin",
  "Admin",
  "Responsable_Editorial",
  "Editor",
  "Autor",
  "Traductor",
];

// ── Parse CLI args ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--help" || key === "-h") { args.help = true; continue; }
    const val = argv[i + 1];
    if (key === "--email")    { args.email    = val; i++; continue; }
    if (key === "--password") { args.password = val; i++; continue; }
    if (key === "--role")     { args.role     = val; i++; continue; }
    if (key === "--orgId")    { args.orgId    = val; i++; continue; }
  }
  return args;
}

function showHelp() {
  console.log(`
create_test_user.mjs — Crea o actualiza un usuario de prueba en Firebase Auth

Uso:
  node create_test_user.mjs [opciones]

Opciones:
  --email    <email>   Email del usuario (por defecto: test_e2e@tailorbot.tech)
  --password <pwd>     Contraseña (por defecto: testpassword123)
  --role     <rol>     Rol asignado: ${VALID_ROLES.join(", ")}
                       (por defecto: SuperAdmin)
  --orgId    <id>      ID de organización en Firestore
                       (requerido para roles distintos de SuperAdmin)
  --help               Muestra este mensaje

Ejemplos:
  node create_test_user.mjs
  node create_test_user.mjs --email editor@org.com --role Editor --orgId abc123
  node create_test_user.mjs --role Admin --orgId abc123
`);
}

// ── Main ────────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv);

if (args.help) { showHelp(); process.exit(0); }

const email      = args.email    ?? "test_e2e@tailorbot.tech";
const password   = args.password ?? "testpassword123";
const role       = args.role     ?? "SuperAdmin";
const orgId      = args.orgId    ?? null;

// Validate role
if (!VALID_ROLES.includes(role)) {
  console.error(`❌ Rol inválido: "${role}". Debe ser uno de: ${VALID_ROLES.join(", ")}`);
  process.exit(1);
}

// Warn if non-SuperAdmin without orgId
if (role !== "SuperAdmin" && !orgId) {
  console.error(
    `❌ Error: el rol "${role}" requiere un --orgId.\n` +
    `   Usa: node create_test_user.mjs --role ${role} --orgId <firestoreOrgId>`
  );
  process.exit(1);
}

// ── Firebase init ────────────────────────────────────────────────────────────
const saPath = resolve(__dirname, "../ai-worker/service-account.json");
let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(saPath, "utf8"));
} catch {
  console.error(`❌ No se pudo leer el service account en: ${saPath}`);
  process.exit(1);
}

const app  = initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth(app);

async function main() {
  try {
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
      console.log(`ℹ️  Usuario ya existe: ${email}`);
      await auth.updateUser(userRecord.uid, { password });
      console.log("   Contraseña actualizada.");
    } catch (e) {
      if (e.code === "auth/user-not-found") {
        userRecord = await auth.createUser({
          email,
          password,
          displayName: `Test (${role})`,
        });
        console.log(`✅ Usuario creado: ${email}`);
      } else {
        throw e;
      }
    }

    const claims = orgId ? { role, organizationId: orgId } : { role };
    await auth.setCustomUserClaims(userRecord.uid, claims);

    console.log(`\n✅ Claims asignados correctamente:`);
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
