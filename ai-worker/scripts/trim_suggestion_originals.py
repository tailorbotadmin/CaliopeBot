"""
trim_suggestion_originals.py
-----------------------------
Retroactively trims overly long `originalText` in existing Firestore suggestions.

Uses a word-level prefix/suffix diff to extract the minimal changed fragment,
without re-running any LLM. Safe: only updates suggestions where the trimmed
fragment is non-trivial (≥ 3 chars) AND appears literally in the chunk text.

Uso:
    python3 trim_suggestion_originals.py                        # all orgs, dry-run
    python3 trim_suggestion_originals.py --apply               # all orgs, write to Firestore
    python3 trim_suggestion_originals.py --org-id <id> --apply # single org
"""

import argparse
import os

import firebase_admin
from firebase_admin import credentials, firestore


# ── Firebase init ─────────────────────────────────────────────────────────────

def get_db():
    sa_path = os.path.join(os.path.dirname(__file__), '..', 'service-account.json')
    try:
        firebase_admin.get_app()
    except ValueError:
        if os.path.exists(sa_path):
            cred = credentials.Certificate(sa_path)
            firebase_admin.initialize_app(cred, options={'projectId': 'caliopebot-dad29'})
        else:
            firebase_admin.initialize_app(options={'projectId': 'caliopebot-dad29'})
    return firestore.client()


# ── Core trimming logic ────────────────────────────────────────────────────────

MIN_ORIG_WORDS = 4   # only process suggestions with originalText longer than this
MIN_FRAG_CHARS = 3   # minimum length of the trimmed fragment to be considered valid


def extract_minimal_fragment(original: str, corrected: str):
    """
    Find the minimal word-level changed region between original and corrected text.

    Example:
        original  = "El niño Fué a la escuela"
        corrected = "El niño fue a la escuela"
        → ("Fué", "fue")

        original  = "en relación a los datos disponibles"
        corrected = "en relación con los datos disponibles"
        → ("a", "con")
    """
    orig_words = original.split()
    corr_words = corrected.split()

    if not orig_words or not corr_words:
        return original, corrected

    # ── Common prefix ──────────────────────────────────────────────────────────
    prefix_len = 0
    for i in range(min(len(orig_words), len(corr_words))):
        if orig_words[i].lower() == corr_words[i].lower():
            prefix_len += 1
        else:
            break

    # ── Common suffix (from the end, not overlapping with prefix) ─────────────
    suffix_len = 0
    max_suffix = min(len(orig_words), len(corr_words)) - prefix_len
    for i in range(1, max_suffix + 1):
        if orig_words[-i].lower() == corr_words[-i].lower():
            suffix_len += 1
        else:
            break

    # ── Extract minimal middle region ──────────────────────────────────────────
    orig_end = len(orig_words) - suffix_len if suffix_len > 0 else len(orig_words)
    corr_end = len(corr_words) - suffix_len if suffix_len > 0 else len(corr_words)

    new_orig = ' '.join(orig_words[prefix_len:orig_end])
    new_corr = ' '.join(corr_words[prefix_len:corr_end])

    return new_orig, new_corr


def should_trim(original: str) -> bool:
    """Return True if the originalText is long enough to be worth trimming."""
    return len(original.split()) > MIN_ORIG_WORDS


def trim_suggestion(sugg: dict, chunk_text: str):
    """
    Attempt to trim a single suggestion's originalText.
    Returns (new_original, new_corrected) if trimming is valid, else (None, None).
    """
    original  = sugg.get('originalText',  '').strip()
    corrected = sugg.get('correctedText', '').strip()

    if not should_trim(original):
        return None, None

    new_orig, new_corr = extract_minimal_fragment(original, corrected)

    # Guard: trimmed fragment must be meaningful
    if not new_orig or len(new_orig) < MIN_FRAG_CHARS:
        return None, None

    # Guard: trimmed fragment must still exist literally in the chunk text
    if new_orig not in chunk_text:
        return None, None

    # Guard: no-op (nothing changed)
    if new_orig == original:
        return None, None

    return new_orig, new_corr


# ── Migration ─────────────────────────────────────────────────────────────────

def migrate(db, org_ids: list, apply: bool):
    total_suggs   = 0
    trimmed_suggs = 0
    skipped_suggs = 0

    for org_id in org_ids:
        print(f"\n📁 Organización: {org_id}")
        books = list(
            db.collection('organizations').document(org_id)
              .collection('books').stream()
        )
        print(f"   {len(books)} manuscritos")

        for book_doc in books:
            book_id   = book_doc.id
            book_data = book_doc.to_dict() or {}
            book_title = book_data.get('title', book_id)

            chunks = list(
                db.collection('organizations').document(org_id)
                  .collection('books').document(book_id)
                  .collection('chunks').stream()
            )

            book_trimmed = 0
            for chunk_doc in chunks:
                chunk_data = chunk_doc.to_dict() or {}
                chunk_text = chunk_data.get('text', '')
                suggestions = chunk_data.get('suggestions', [])

                if not suggestions:
                    continue

                changed = False
                new_suggestions = []
                for sugg in suggestions:
                    total_suggs += 1
                    new_orig, new_corr = trim_suggestion(sugg, chunk_text)
                    if new_orig:
                        trimmed_suggs += 1
                        book_trimmed  += 1
                        changed = True
                        new_sugg = dict(sugg)
                        new_sugg['originalText']  = new_orig
                        new_sugg['correctedText'] = new_corr
                        new_suggestions.append(new_sugg)
                        if not apply:
                            # Print preview in dry-run
                            print(
                                f"      [{chunk_doc.id[:8]}] "
                                f"ANTES: «{sugg['originalText'][:60]}»\n"
                                f"             DESPUÉS: «{new_orig}»  →  «{new_corr}»"
                            )
                    else:
                        skipped_suggs += 1
                        new_suggestions.append(sugg)

                if apply and changed:
                    db.collection('organizations').document(org_id)\
                      .collection('books').document(book_id)\
                      .collection('chunks').document(chunk_doc.id)\
                      .update({'suggestions': new_suggestions})

            if book_trimmed:
                mode = "✅ Actualizado" if apply else "🔍 (dry-run)"
                print(f"   {mode} «{book_title}»: {book_trimmed} sugerencias recortadas")

    print(f"\n{'═'*60}")
    print(f"Total sugerencias procesadas : {total_suggs}")
    print(f"Recortadas                   : {trimmed_suggs}")
    print(f"Sin cambios (ya correctas)   : {skipped_suggs}")
    if not apply:
        print("\n⚠️  Modo DRY-RUN. Nada se ha escrito en Firestore.")
        print("   Ejecuta con --apply para aplicar los cambios.")
    else:
        print("\n✅ Cambios escritos en Firestore.")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Recorta originalText en sugerencias ya ingestadas.",
        epilog="Ejemplo: python3 trim_suggestion_originals.py --apply",
    )
    parser.add_argument(
        '--org-id', dest='org_id', default=None,
        help='ID de una organización concreta (por defecto: todas)',
    )
    parser.add_argument(
        '--apply', action='store_true',
        help='Escribir cambios en Firestore (por defecto es dry-run)',
    )
    args = parser.parse_args()

    db = get_db()

    if args.org_id:
        org_ids = [args.org_id]
    else:
        org_ids = [doc.id for doc in db.collection('organizations').stream()]

    print(f"{'DRY-RUN' if not args.apply else 'APPLY'} — {len(org_ids)} organización(es)")
    migrate(db, org_ids, apply=args.apply)


if __name__ == '__main__':
    main()
