"""
fix_english_rules.py
Traduce directamente al español las normas en inglés de Firestore.
Usa firebase-admin con service-account.json. Sin dependencia de Gemini.

Uso: cd ai-worker && python3 scripts/fix_english_rules.py [--dry-run]
"""

import sys
import os
import re
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import firebase_admin
from firebase_admin import credentials, firestore as fs

SA_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "service-account.json")
if not firebase_admin._apps:
    cred = credentials.Certificate(SA_PATH)
    firebase_admin.initialize_app(cred)

db = fs.client()

# ── Diccionario de traducción: inglés → español ─────────────────────────────
# Clave: fragmento de nombre en inglés (lowercase, insensible)
# Valor: (nombre_español, descripcion_español)
TRANSLATIONS: list[tuple[str, str, str]] = [
    # Tipografía / Puntuación
    ("italics for foreign words", "Cursiva para extranjerismos y latinismos",
     "Las palabras extranjeras y latinismos deben escribirse en cursiva."),
    ("italics: foreign", "Cursiva para extranjerismos",
     "Las palabras extranjeras deben escribirse en cursiva."),
    ("quotation marks: primary", "Comillas primarias (angulares)",
     "Se usan comillas angulares «» como sistema primario de cita."),
    ("quotation marks: nested", "Comillas secundarias (inglesas)",
     "Para citas dentro de citas se usan comillas inglesas ""."),
    ("quotation marks usage", "Uso de comillas",
     "Las comillas angulares «» se usan para citas y términos destacados."),
    ("em dash", "Raya (—) en lugar de guión",
     "Se usa la raya (—) para incisos y diálogos, no el guion corto."),
    ("em-dash", "Raya (—) para incisos",
     "Los incisos parentéticos se marcan con raya (—), no con guión."),
    ("dialogue punctuation", "Puntuación en diálogos",
     "Los diálogos se inician con raya (—) y la puntuación sigue la norma RAE."),
    ("ellipsis", "Puntuación: puntos suspensivos",
     "Los puntos suspensivos son siempre tres (…) y van sin espacio previo."),
    ("guillemets", "Comillas angulares (guillemets)",
     "Se usan comillas angulares «» como comillas primarias, según la norma RAE."),
    ("spanish guillemets", "Comillas angulares españolas",
     "Las comillas primarias son las angulares «», propias del español."),
    ("semicolon", "Uso del punto y coma",
     "El punto y coma separa oraciones relacionadas con cierta autonomía sintáctica."),
    ("colon", "Uso de los dos puntos",
     "Los dos puntos introducen enumeraciones, citas o explicaciones."),
    ("comma usage", "Uso de la coma",
     "Se usa la coma para separar elementos e incisos según la norma RAE."),
    ("period", "Uso del punto",
     "El punto señala el final del enunciado y va seguido de mayúscula."),
    ("punctuation: spacing", "Espaciado de puntuación",
     "No se deja espacio antes de los signos de puntuación."),
    ("spacing", "Espaciado uniforme",
     "Se usa un único espacio entre palabras; sin espacios dobles."),
    ("block quote", "Citas en bloque",
     "Las citas extensas (más de 3 líneas) se sangran en párrafo aparte sin comillas."),
    ("internal thoughts", "Monólogo interior y pensamientos",
     "Los pensamientos del personaje se marcan con cursiva o comillas según el estilo."),

    # Ortografía / Gramática
    ("spelling correction", "Corrección ortográfica",
     "Se corrigen las erratas tipográficas para restaurar la forma correcta."),
    ("typo correction", "Corrección de errata tipográfica",
     "Se corrigen las letras omitidas o intercambiadas por error tipográfico."),
    ("capitalization of religious", "Mayúsculas en términos religiosos",
     "Los nombres propios religiosos se escriben con mayúscula inicial."),
    ("capitalization: 'estado'", "Mayúscula en 'Estado'",
     "'Estado' se escribe con mayúscula cuando designa la organización política."),
    ("capitalization: 'humanidad'", "Uso de mayúscula en 'Humanidad'",
     "'Humanidad' lleva mayúscula cuando se refiere al género humano como concepto abstracto."),
    ("capitalization after dialogue", "Mayúscula tras acotación de diálogo",
     "Después de un guión de diálogo, la primera letra va en minúscula si sigue el texto."),
    ("capitalization of proper", "Mayúsculas en nombres propios",
     "Los nombres propios de personas, lugares e instituciones llevan mayúscula."),
    ("pronoun agreement", "Concordancia de pronombres",
     "Los pronombres deben concordar en género y número con su antecedente."),
    ("possessive pronoun", "Uso de pronombres posesivos",
     "Los pronombres posesivos concuerdan con el sustantivo al que modifican."),
    ("verb choice", "Elección del verbo adecuado",
     "Se prefiere el verbo más preciso y estilísticamente apropiado al contexto."),
    ("noun choice", "Elección del sustantivo adecuado",
     "Se usa el sustantivo más preciso y de registro apropiado."),
    ("adjective choice", "Elección del adjetivo adecuado",
     "Se elige el adjetivo que mejor expresa el matiz semántico requerido."),
    ("grade level terminology", "Terminología de niveles educativos",
     "Los cursos y niveles educativos se nombran con la denominación oficial española."),
    ("consistency in acronyms", "Uniformidad en siglas y abreviaturas",
     "Las siglas y abreviaturas se usan de forma consistente en todo el documento."),
    ("consistency in naming", "Uniformidad en nombres y denominaciones",
     "Los nombres de personajes y lugares se escriben siempre de la misma forma."),
    ("consistency in noun", "Uniformidad léxica",
     "Se usa el mismo término para referirse a un mismo concepto a lo largo del texto."),
    ("sentence structure and flow", "Fluidez y estructura sintáctica",
     "Las oraciones se revisan para mejorar su claridad y fluidez."),
    ("content expansion", "Ampliación o aclaración de contenido",
     "Se añaden detalles cuando el texto resulta ambiguo o insuficiente."),

    # Formato
    ("copyright page", "Página de derechos (copyright)",
     "El libro debe incluir una página de derechos con la información legal obligatoria."),
    ("title page", "Página de título",
     "La portada interior incluye título, autor y editorial según el estilo de la casa."),
    ("chapter title formatting", "Formato de títulos de capítulo",
     "Los títulos de capítulo siguen las normas tipográficas de la editorial."),
    ("chapter headings alignment", "Alineación de encabezados de capítulo",
     "Los encabezados de capítulo se alinean según las normas de maquetación."),
    ("chapter titles: numbering", "Numeración de capítulos",
     "Los capítulos se numeran con cifras romanas o árabes según el estilo editorial."),
    ("font style", "Tipo de fuente",
     "El cuerpo del texto usa la tipografía establecida por la editorial."),
    ("font style: body", "Fuente del texto principal",
     "El texto corrido usa la tipografía, tamaño e interlineado definidos en el diseño."),
    ("paragraph indentation", "Sangría de párrafo",
     "Los párrafos llevan sangría de primera línea, salvo el primero de cada capítulo."),
    ("first paragraph indentation", "Sangría del primer párrafo",
     "El primer párrafo tras un título o separador no lleva sangría."),
    ("text alignment", "Alineación del texto",
     "El texto va justificado a ambos márgenes según las normas de maquetación."),
    ("text justification", "Justificación del texto",
     "El texto se justifica a ambos márgenes para una presentación editorial uniforme."),
    ("footnote style", "Formato de notas al pie",
     "Las notas al pie siguen el estilo tipográfico y de numeración de la editorial."),
    ("footnote numbering", "Numeración de notas al pie",
     "Las notas al pie se numeran correlativamente en cada capítulo o en todo el libro."),
    ("footnote usage", "Uso de notas al pie",
     "Las notas al pie amplían información sin interrumpir el flujo del texto principal."),
    ("page numbering", "Numeración de páginas",
     "Las páginas se numeran según el estilo editorial; las páginas iniciales en romanos."),
    ("page number placement", "Posición del número de página",
     "Los números de página se sitúan en el lugar definido por la maquetación (pie o cabeza)."),
    ("colophon", "Colofón",
     "El libro incluye colofón con los datos de impresión al final de la edición."),
    ("dedication page", "Página de dedicatoria",
     "La dedicatoria ocupa una página propia, antes de los preliminares."),
    ("final page inclusion", "Página final",
     "La última página del libro incluye los datos editoriales requeridos."),
    ("imprint page", "Página de imprenta",
     "La página de imprenta recoge los datos legales y de producción del libro."),
    ("table of contents", "Índice de contenidos",
     "El libro incluye un índice de contenidos con los capítulos y páginas correspondientes."),
    ("legal disclaimer", "Aviso legal",
     "El libro incluye el aviso legal con los derechos de reproducción y propiedad intelectual."),
    ("logo placement", "Posición del logotipo editorial",
     "El logotipo de la editorial se sitúa en la portada y/o la página de derechos."),
    ("bibliography format", "Formato de bibliografía",
     "Las referencias bibliográficas siguen el estilo definido por la editorial."),
    ("list item markers", "Marcadores de lista",
     "Los elementos de lista usan el símbolo o numeración definidos por el estilo editorial."),
    ("thousand separator for years", "Separador de miles en años",
     "Los años de cuatro cifras no llevan punto ni separador de miles."),
    ("consistent numbering", "Uniformidad en la numeración",
     "Los números se expresan en cifras o letras de forma coherente en todo el documento."),
    ("english double quotes", "Comillas dobles inglesas para cita secundaria",
     "Las comillas dobles "" se reservan para citas dentro de citas angulares."),
    ("english single quotes", "Comillas simples para cita terciaria",
     "Las comillas simples '' se usan para citas de tercer nivel."),
]

# ── Patrones de idioma ────────────────────────────────────────────────────────
_SPANISH = re.compile(
    r"[ñáéíóúüÁÉÍÓÚÜ]|"
    r"\b(de|el|la|los|las|en|que|con|por|para|como|del|una|sin|este|esta|se|su|sus|al|"
    r"pero|más|no|es|son|fue|han|hay|un|ya|lo|le|si|yo|mi|te|me)\b",
    re.IGNORECASE,
)
_ENGLISH = re.compile(
    r"\b(the|and|or|with|for|from|text|using|when|should|must|will|are|is|be|that|this|which|"
    r"have|has|been|their|can|may|format|list|header|italic|bold|margin|spacing|font|style|"
    r"rule|item|use|used|applied|correction|spelling|capitalization|punctuation|alignment|"
    r"inclusion|placement|numbering|formatting|usage|dialogue|paragraph|footnote|quotation|"
    r"consistency|choice|structure|flow|marks|page|title|chapter|content)\b",
    re.IGNORECASE,
)


def is_english(text: str) -> bool:
    if not text:
        return False
    return bool(_ENGLISH.search(text)) and not bool(_SPANISH.search(text))


def find_translation(name: str, desc: str):
    """Find Spanish translation for an English rule name using the lookup table."""
    key = (name + " " + desc).lower()
    for eng_fragment, es_name, es_desc in TRANSLATIONS:
        if eng_fragment.lower() in key:
            return es_name, es_desc
    return None


def translate_fallback(name: str) -> str:
    """Generic fallback: convert known English terms in the name."""
    mapping = {
        "Spelling Correction": "Corrección ortográfica",
        "Typo Correction": "Corrección de errata",
        "Capitalization": "Uso de mayúsculas",
        "Punctuation": "Puntuación",
        "Font Style": "Estilo de fuente",
        "Page Numbering": "Numeración de páginas",
        "Footnote": "Nota al pie",
        "Dialogue": "Diálogo",
        "Chapter Title": "Título de capítulo",
        "Paragraph": "Párrafo",
        "Text Alignment": "Alineación del texto",
        "Quotation Marks": "Comillas",
        "Em Dash": "Raya (—)",
        "Ellipsis": "Puntos suspensivos",
        "Consistency": "Uniformidad",
        "Bibliography": "Bibliografía",
        "Colophon": "Colofón",
        "Dedication": "Dedicatoria",
        "Table of Contents": "Índice",
        "Copyright": "Derechos de autor",
        "Legal Disclaimer": "Aviso legal",
        "Imprint": "Página de imprenta",
        "Logo Placement": "Posición del logotipo",
        "Block Quote": "Cita en bloque",
        "Italics": "Cursiva",
        "Guillemets": "Comillas angulares",
    }
    for eng, esp in mapping.items():
        if eng.lower() in name.lower():
            return esp
    return name  # unchanged if no match


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--org-id", default="G8rTqFMuH1xFACIsjEsV")
    args = parser.parse_args()

    dry = args.dry_run
    org_id = args.org_id

    print(f"\n🔍 Escaneando normas de org={org_id} ({'DRY RUN' if dry else 'ESCRITURA REAL'})\n")

    translated = 0
    skipped = 0

    for col_name in ("rules", "pendingRules"):
        snap = db.collection("organizations").document(org_id).collection(col_name).get()
        for doc in snap:
            data = doc.to_dict()
            name = data.get("name") or data.get("rule") or ""
            desc = data.get("description") or ""

            # Skip RAE rules
            if (data.get("source") or "").startswith("RAE"):
                continue

            if not is_english(f"{name} {desc}"):
                skipped += 1
                continue

            # Try translation lookup
            result = find_translation(name, desc)
            if result:
                new_name, new_desc = result
            else:
                new_name = translate_fallback(name)
                new_desc = desc  # keep original desc if no match

            print(f"  {'[dry]' if dry else '✅'} [{col_name}] \"{name}\" → \"{new_name}\"")

            if not dry:
                doc.reference.update({
                    "name": new_name,
                    "rule": new_name,
                    "description": new_desc,
                })
            translated += 1

    print(f"\n{'[DRY RUN] ' if dry else ''}Resultado: {translated} normas traducidas, {skipped} ya en español.")


if __name__ == "__main__":
    main()
