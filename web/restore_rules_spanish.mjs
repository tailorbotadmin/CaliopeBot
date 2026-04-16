/**
 * restore_rules_spanish.mjs
 * Regenera en español las 130 normas editoriales eliminadas.
 * Usa Gemini para generar nombre+descripción en español a partir del nombre inglés original.
 *
 * Uso: node restore_rules_spanish.mjs [--dry-run]
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { GoogleGenAI } from "@google/genai";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");

// ── Firebase Admin ──────────────────────────────────────────
const saPath = join(__dirname, "../ai-worker/service-account.json");
const serviceAccount = JSON.parse(readFileSync(saPath, "utf8"));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ── Gemini ───────────────────────────────────────────────────
// Load API key from .env.local
let GEMINI_API_KEY = "";
try {
  const envContent = readFileSync(join(__dirname, ".env.local"), "utf8");
  const match = envContent.match(/GEMINI_API_KEY\s*=\s*(.+)/);
  if (match) GEMINI_API_KEY = match[1].trim();
} catch { /* optional */ }

// Try process env as fallback
if (!GEMINI_API_KEY) GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY no encontrada en .env.local ni en el entorno.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ── Org to restore into ──────────────────────────────────────
const ORG_ID = "G8rTqFMuH1xFACIsjEsV";
const ORG_NAME = "Biblioteca Homo Legens";

// ── Deleted rules (from dry-run output) ────────────────────
// These were the ACTIVE rules in English that got deleted.
// Each entry: { englishName, source, category? }
const DELETED_RULES = [
  { englishName: "Italics: Foreign words and Latin phrases", source: "Nosotros", category: "typography" },
  { englishName: "Copyright Page Inclusion", source: "Nosotros", category: "format" },
  { englishName: "Quotation Marks: Primary", source: "Nosotros", category: "typography" },
  { englishName: "Thousand Separator for Years", source: "Nosotros", category: "style" },
  { englishName: "Consistent Numbering Style", source: "Nosotros", category: "style" },
  { englishName: "Italics for Foreign Words and Titles", source: "Conservatismo", category: "typography" },
  { englishName: "Capitalization of Religious Terms", source: "Conservatismo", category: "grammar" },
  { englishName: "Font Style", source: "Conservatismo", category: "format" },
  { englishName: "Spelling Correction: 'umanidad'", source: "Conservatismo", category: "grammar" },
  { englishName: "Chapter Headings Alignment", source: "Entre los impostores", category: "format" },
  { englishName: "Chapter Title Formatting", source: "Entre los impostores", category: "format" },
  { englishName: "Consistent Spacing", source: "Entre los impostores", category: "format" },
  { englishName: "Verb Choice for 'marcha'", source: "Conservatismo", category: "style" },
  { englishName: "Chapter Title Formatting", source: "Nosotros", category: "format" },
  { englishName: "Final Page Inclusion", source: "Nosotros", category: "format" },
  { englishName: "Em Dashes for Parenthetical Phrases", source: "Conservatismo", category: "typography" },
  { englishName: "Block Quotes for Extended Passages", source: "Entre los impostores", category: "format" },
  { englishName: "Punctuation: Guillemets for quotes", source: "Nosotros", category: "typography" },
  { englishName: "Spelling Correction: 'aqullos'", source: "Conservatismo", category: "grammar" },
  { englishName: "Punctuation: Em dashes", source: "Conservatismo", category: "typography" },
  { englishName: "Consistency in Naming Conventions", source: "Entre los impostores", category: "style" },
  { englishName: "Em-Dashes for Parentheticals", source: "Entre los impostores", category: "typography" },
  { englishName: "Noun Choice for 'cole'", source: "Conservatismo", category: "style" },
  { englishName: "Colophon Formatting", source: "Entre los impostores", category: "format" },
  { englishName: "Spelling Correction: 'istoria'", source: "Conservatismo", category: "grammar" },
  { englishName: "Sentence Structure and Flow", source: "Entre los impostores", category: "style" },
  { englishName: "English Double Quotes for Secondary Quotes", source: "Nosotros", category: "typography" },
  { englishName: "Consistency in Acronyms/Abbreviations", source: "Conservatismo", category: "style" },
  { englishName: "Capitalization: 'Estado'", source: "Conservatismo", category: "grammar" },
  { englishName: "Font Style: Body Text", source: "Entre los impostores", category: "format" },
  { englishName: "Footnote Style", source: "Entre los impostores", category: "format" },
  { englipshName: "Ellipsis Spacing", source: "Entre los impostores", category: "typography" },
  { englishName: "Spelling Correction: 'rogresismo'", source: "Conservatismo", category: "grammar" },
  { englishName: "Typo Correction: Missing 'd' or 'g'", source: "Conservatismo", category: "grammar" },
  { englishName: "Imprint Page Details", source: "Nosotros", category: "format" },
  { englishName: "Table of Contents Inclusion", source: "Nosotros", category: "format" },
  { englishName: "Comma Usage for Clarity", source: "Entre los impostores", category: "grammar" },
  { englishName: "Use of Spanish Guillemets for Quotes", source: "Conservatismo", category: "typography" },
  { englishName: "English Single Quotes for Tertiary Quotes", source: "Nosotros", category: "typography" },
  { englishName: "Logo Placement", source: "Entre los impostores", category: "format" },
  { englishName: "Page Numbering", source: "Entre los impostores", category: "format" },
  { englishName: "Comma Usage for Parenthetical Phrases", source: "Conservatismo", category: "grammar" },
  { englishName: "Footnote Numbering", source: "Entre los impostores", category: "format" },
  { englishName: "Punctuation: Semicolons", source: "Nosotros", category: "typography" },
  { englishName: "Punctuation: Periods", source: "Entre los impostores", category: "typography" },
  { englishName: "Legal Disclaimer", source: "Nosotros", category: "format" },
  { englishName: "Quotation Marks: Nested/Specific Terms", source: "Conservatismo", category: "typography" },
  { englishName: "Dialogue Punctuation", source: "Entre los impostores", category: "typography" },
  { englishName: "Dialogue Punctuation", source: "Nosotros", category: "typography" },
  { englishName: "Em Dash Usage in Dialogue", source: "Conservatismo", category: "typography" },
  { englishName: "Content Expansion/Clarification", source: "Entre los impostores", category: "style" },
  { englishName: "Quotation Marks Usage", source: "Conservatismo", category: "typography" },
  { englishName: "Paragraph Indentation", source: "Entre los impostores", category: "format" },
  { englishName: "Pronoun Agreement", source: "Conservatismo", category: "grammar" },
  { englishName: "Punctuation: Ellipses", source: "Nosotros", category: "typography" },
  { englishName: "Typo Correction: 'onservatismo'", source: "Conservatismo", category: "grammar" },
  { englishName: "Internal Thoughts/Quoted Phrases Punctuation", source: "Entre los impostores", category: "typography" },
  { englishName: "Text Alignment", source: "Entre los impostores", category: "format" },
  { englishName: "Punctuation: Spacing", source: "Entre los impostores", category: "typography" },
  { englishName: "Adjective Choice for 'digno'", source: "Conservatismo", category: "style" },
  { englishName: "Title Page Structure", source: "Nosotros", category: "format" },
  { englishName: "Chapter Titles: Numbering", source: "Entre los impostores", category: "format" },
  { englishName: "Text Justification", source: "Entre los impostores", category: "format" },
  { englishName: "Typo Correction: Missing 'r'", source: "Conservatismo", category: "grammar" },
  { englishName: "Spelling Correction: 'ealeza'", source: "Conservatismo", category: "grammar" },
  { englishName: "Page Numbering", source: "Nosotros", category: "format" },
  { englishName: "Use of Em-dashes for Parenthetical Phrases", source: "Conservatismo", category: "typography" },
  { englishName: "Page Number Placement", source: "Nosotros", category: "format" },
  { englishName: "Dedication Page", source: "Nosotros", category: "format" },
  { englishName: "Spelling Correction: 'erecho'", source: "Conservatismo", category: "grammar" },
  { englishName: "Font Style", source: "Nosotros", category: "format" },
  { englishName: "Dialogue Punctuation", source: "Conservatismo", category: "typography" },
  { englishName: "Colophon Inclusion", source: "Nosotros", category: "format" },
  { englishName: "First Paragraph Indentation", source: "Entre los impostores", category: "format" },
  { englishName: "Spanish Guillemets for Quotes", source: "Entre los impostores", category: "typography" },
  { englishName: "Spelling Correction: 'onarca'", source: "Conservatismo", category: "grammar" },
  { englishName: "Punctuation: Colons", source: "Entre los impostores", category: "typography" },
  { englishName: "Capitalization: 'Humanidad'", source: "Conservatismo", category: "grammar" },
  { englishName: "Chapter Title Formatting", source: "Conservatismo", category: "format" },
  { englishName: "Ellipsis Character", source: "Nosotros", category: "typography" },
  { englishName: "Consistency in Noun Usage", source: "Entre los impostores", category: "style" },
  { englishName: "Capitalization After Dialogue Tag", source: "Entre los impostores", category: "grammar" },
  { englishName: "Footnote Usage", source: "Conservatismo", category: "format" },
  { englishName: "Chapter Title Formatting", source: "Nosotros", category: "format" },
  { englishName: "Grade Level Terminology", source: "Conservatismo", category: "style" },
  { englishName: "Em Dashes for Parenthetical Phrases", source: "Nosotros", category: "typography" },
  { englishName: "Bibliography Format", source: "Entre los impostores", category: "format" },
  { englishName: "Capitalization of Proper Nouns", source: "Conservatismo", category: "grammar" },
  { englishName: "Dedication Page Formatting", source: "Nosotros", category: "format" },
  // Extra from other runs  
  { englishName: "List Item Markers", source: "Nosotros", category: "format" },
  { englishName: "Ellipses Formatting", source: "Conservatismo", category: "typography" },
  { englishName: "Possessive Pronoun Usage", source: "Entre los impostores", category: "grammar" },
];

// Fix typo in source data
const RULES_FIXED = DELETED_RULES.map(r => ({
  englishName: r.englishName ?? r.englipshName,
  source: r.source,
  category: r.category || "style",
})).filter(r => r.englishName);

async function translateRuleBatch(batch) {
  const list = batch.map((r, i) => `${i + 1}. "${r.englishName}" (categoría: ${r.category})`).join("\n");
  const prompt = `Eres un editor experto en lengua española. Para cada norma editorial, 
proporciona en español:
- "nombre": nombre breve y claro de la norma (máx. 8 palabras)
- "descripcion": explicación práctica de la norma (1-2 frases)

Lista de normas a traducir/adaptar al español:
${list}

Devuelve un array JSON con exactamente ${batch.length} objetos con campos "nombre" y "descripcion".
IMPORTANTE: Toda la respuesta debe estar en español.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });
    const text = response.text?.trim() ?? "[]";
    return JSON.parse(text);
  } catch (e) {
    console.error("  ⚠️  Error Gemini:", e.message);
    return batch.map(r => ({
      nombre: r.englishName,
      descripcion: `Norma aplicada en ${r.source}.`,
    }));
  }
}

async function main() {
  console.log(`\n🌐 Restaurando ${RULES_FIXED.length} normas en español para: ${ORG_NAME}\n`);

  const BATCH_SIZE = 10;
  const orgRef = db.collection("organizations").doc(ORG_ID);
  let totalInserted = 0;

  for (let i = 0; i < RULES_FIXED.length; i += BATCH_SIZE) {
    const batch = RULES_FIXED.slice(i, i + BATCH_SIZE);
    console.log(`📦 Procesando ${i + 1}-${Math.min(i + BATCH_SIZE, RULES_FIXED.length)}/${RULES_FIXED.length}...`);

    const translated = await translateRuleBatch(batch);

    if (!DRY_RUN) {
      const firestoreBatch = db.batch();
      for (let j = 0; j < batch.length; j++) {
        const t = translated[j] ?? { nombre: batch[j].englishName, descripcion: "" };
        const ruleId = `restored_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const ruleRef = orgRef.collection("rules").doc(ruleId);
        firestoreBatch.set(ruleRef, {
          id: ruleId,
          name: t.nombre,
          rule: t.nombre,
          description: t.descripcion,
          category: batch[j].category,
          source: batch[j].source,
          status: "active",
          createdAt: FieldValue.serverTimestamp(),
        });
        console.log(`  ✅ "${batch[j].englishName}" → "${t.nombre}"`);
        totalInserted++;
      }
      await firestoreBatch.commit();
    } else {
      for (let j = 0; j < batch.length; j++) {
        const t = translated[j] ?? { nombre: batch[j].englishName, descripcion: "" };
        console.log(`  [dry-run] "${batch[j].englishName}" → "${t.nombre}"`);
      }
    }
    
    // Rate limit: 1s between batches
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n✅ Total restauradas: ${totalInserted}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
