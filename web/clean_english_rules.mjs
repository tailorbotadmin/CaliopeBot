/**
 * clean_english_rules.mjs
 * Elimina de Firestore las normas editoriales cuyo texto está en inglés.
 * Detecta inglés: si el nombre/descripción contiene palabras inglesas comunes
 * y NO contiene caracteres o palabras típicas del español.
 *
 * Uso: node clean_english_rules.mjs [--dry-run]
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");

// Load service account
const saPath = join(__dirname, "../ai-worker/service-account.json");
let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(saPath, "utf8"));
} catch {
  console.error("❌ serviceAccountKey.json not found at", saPath);
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// Heurística: si el texto tiene caracteres ASCII básicos y palabras inglesas
// comunes SIN español (ñ, tildes, artículos en español)
const SPANISH_MARKERS = /[ñáéíóúüÁÉÍÓÚÜ]|(\b(de|el|la|los|las|en|que|con|por|para|como|del|una|los|sin|este|esta|se|su|sus|al|pero|más|no|y|o|es|son|fue|han|hay)\b)/i;
const ENGLISH_MARKERS = /\b(the|and|or|with|for|from|text|using|when|should|must|will|are|is|be|to|in|of|that|this|which|have|has|been|their|can|may|format|list|header|italic|bold|margin|spacing|font|style|rule|item|use|used|applied)\b/i;

function isEnglish(text) {
  if (!text) return false;
  const hasSpanish = SPANISH_MARKERS.test(text);
  const hasEnglish = ENGLISH_MARKERS.test(text);
  return hasEnglish && !hasSpanish;
}

async function cleanOrg(orgId, orgName) {
  let deleted = 0;
  let kept = 0;

  // Clean pendingRules
  const pendingSnap = await db.collection("organizations").doc(orgId).collection("pendingRules").get();
  for (const doc of pendingSnap.docs) {
    const data = doc.data();
    const text = (data.rule || data.name || "") + " " + (data.description || "");
    if (isEnglish(text)) {
      console.log(`  🗑️  [pending] "${data.rule || data.name}" — ${DRY_RUN ? "SKIP (dry-run)" : "DELETING"}`);
      if (!DRY_RUN) await doc.ref.delete();
      deleted++;
    } else {
      kept++;
    }
  }

  // Clean active rules (source != RAE)
  const rulesSnap = await db.collection("organizations").doc(orgId).collection("rules").get();
  for (const doc of rulesSnap.docs) {
    const data = doc.data();
    if (data.source === "RAE" || (data.source || "").startsWith("RAE")) continue; // never touch RAE rules
    const text = (data.rule || data.name || "") + " " + (data.description || "");
    if (isEnglish(text)) {
      console.log(`  🗑️  [active]  "${data.rule || data.name}" — ${DRY_RUN ? "SKIP (dry-run)" : "DELETING"}`);
      if (!DRY_RUN) await doc.ref.delete();
      deleted++;
    } else {
      kept++;
    }
  }

  console.log(`  → ${orgName}: ${deleted} eliminadas, ${kept} conservadas\n`);
  return deleted;
}

async function main() {
  console.log(`\n🧹 Limpieza de normas en inglés ${DRY_RUN ? "(DRY RUN — no se borra nada)" : "(REAL — borrando)"}\n`);

  const orgsSnap = await db.collection("organizations").get();
  let total = 0;

  for (const orgDoc of orgsSnap.docs) {
    const orgName = orgDoc.data().name || orgDoc.id;
    console.log(`📁 Organización: ${orgName} (${orgDoc.id})`);
    total += await cleanOrg(orgDoc.id, orgName);
  }

  console.log(`\n✅ Total eliminadas: ${total}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
