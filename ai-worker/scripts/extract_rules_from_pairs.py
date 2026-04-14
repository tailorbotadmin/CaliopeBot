import os
import glob
import json
import time
import firebase_admin
from firebase_admin import credentials, firestore
from google import genai
from google.genai import types
import docx  # python-docx

PROJECT_ID = "caliopebot-dad29"
LOCATION = "us-central1"
MODEL = "gemini-2.5-flash"

def get_db():
    sa_path = os.path.join(os.path.dirname(__file__), '..', 'service-account.json')
    if os.path.exists(sa_path):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = sa_path

    try:
        firebase_admin.get_app()
    except ValueError:
        if os.path.exists(sa_path):
            cred = credentials.Certificate(sa_path)
            firebase_admin.initialize_app(cred, options={'projectId': PROJECT_ID})
        else:
            firebase_admin.initialize_app(options={'projectId': PROJECT_ID})

    return firestore.client()

def get_genai_client():
    """Crea el cliente de Gemini usando Vertex AI con ADC (service account)."""
    sa_path = os.path.join(os.path.dirname(__file__), '..', 'service-account.json')
    if os.path.exists(sa_path):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = sa_path
    return genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)

def extract_docx_text(docx_path):
    """Extrae todo el texto de un archivo DOCX usando python-docx."""
    doc = docx.Document(docx_path)
    paragraphs = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            paragraphs.append(text)
    return "\n\n".join(paragraphs)

def extract_rules():
    db = get_db()
    orgs = db.collection('organizations').where('name', '==', 'Biblioteca Homo Legens').limit(1).get()
    if not orgs:
        print("Org 'Biblioteca Homo Legens' not found in Firestore.")
        return
    org_id = orgs[0].id

    project_dir = "/Users/tailorbot/Antigravity Projects/CalíopeBot"
    docx_files = sorted(glob.glob(os.path.join(project_dir, "*Manuscrito.docx")))

    print(f"Inicializando cliente Gemini (Vertex AI)...")
    client = get_genai_client()

    print(f"Encontrados {len(docx_files)} manuscritos.")
    processed = 0

    for docx_path in docx_files:
        base_name = docx_path.replace(" Manuscrito.docx", "")
        pdf_file = f"{base_name} Versión Final.pdf"

        if not os.path.exists(pdf_file):
            print(f"⏭ Saltando {os.path.basename(docx_path)}, no hay PDF '{os.path.basename(pdf_file)}'")
            continue

        print(f"\n{'='*60}")
        print(f"📖 Procesando: {os.path.basename(docx_path)}")
        print(f"   PDF: {os.path.basename(pdf_file)}")

        try:
            # 1. Extraer texto del DOCX localmente (Gemini no soporta DOCX)
            print(f"  → Extrayendo texto del manuscrito DOCX...")
            manuscript_text = extract_docx_text(docx_path)
            print(f"    Extraídos {len(manuscript_text)} caracteres ({len(manuscript_text.split())} palabras)")

            # 2. Subir el PDF via File API de Vertex AI
            print(f"  → Subiendo PDF a Vertex AI File API...")
            with open(pdf_file, "rb") as f:
                pdf_bytes = f.read()
            pdf_part = types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf")
            print(f"    PDF listo ({len(pdf_bytes) // 1024} KB)")

            # 3. Construir prompt con el texto del manuscrito y el PDF
            prompt = f"""Eres el Responsable Editorial de la editorial 'Biblioteca Homo Legens'.

A continuación tienes el MANUSCRITO ORIGINAL del autor (texto extraído del Word):

--- INICIO MANUSCRITO ---
{manuscript_text[:80000]}
--- FIN MANUSCRITO ---

Y adjunto encontrarás la VERSIÓN FINAL editada, maquetada y pulida (PDF adjunto).

Compara ambos documentos detalladamente.
Extrae las reglas editoriales, ortotipográficas, de estilo y de formato que aplicó el corrector/maquetador.
Identifica el formato exacto que quiere la editorial (por ej. tipos de letra, espaciados, uso de cursivas, rayas de diálogo, comillas latinas vs inglesas, etc.).

Devuelve tu respuesta ÚNICAMENTE como un array de objetos JSON con esta estructura y NADA MÁS:
[
  {{
    "name": "Nombre corto de la regla",
    "description": "Explicación detallada de la regla a aplicar",
    "category": "style" | "grammar" | "format" | "typography"
  }}
]"""

            # 4. Llamar a Gemini vía Vertex AI
            print(f"  → Llamando a {MODEL} (Vertex AI) para inferencia...")
            response = client.models.generate_content(
                model=MODEL,
                contents=[pdf_part, prompt],
                config=types.GenerateContentConfig(
                    temperature=0.2,
                    response_mime_type="application/json",
                ),
            )

            raw_text = response.text.strip()
            # Eliminar posibles bloques de markdown
            if raw_text.startswith("```json"):
                raw_text = raw_text[7:]
            if raw_text.endswith("```"):
                raw_text = raw_text[:-3]
            raw_text = raw_text.strip()

            rules = json.loads(raw_text)

            # 5. Guardar en Firestore
            for rule in rules:
                rule['source'] = os.path.basename(docx_path)
                rule['status'] = 'pending'
                rule['createdAt'] = firestore.SERVER_TIMESTAMP
                db.collection('organizations').document(org_id).collection('pendingRules').add(rule)

            print(f"  ✅ Añadidas {len(rules)} reglas a Firestore para '{os.path.basename(docx_path)}'")
            processed += 1

            # Esperar entre pares para no agotar la cuota
            if docx_path != docx_files[-1]:
                print(f"  ⏳ Esperando 15s antes del siguiente par...")
                time.sleep(15)

        except Exception as e:
            print(f"  ❌ Error: {e}")
            # Si es error de cuota, esperar más
            if "429" in str(e) or "quota" in str(e).lower():
                print(f"  ⏳ Error de cuota, esperando 60s...")
                time.sleep(60)

    print(f"\n{'='*60}")
    print(f"🏁 Completado. Procesados {processed}/{len(docx_files)} pares.")

if __name__ == "__main__":
    extract_rules()
