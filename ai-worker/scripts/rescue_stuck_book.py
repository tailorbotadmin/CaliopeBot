"""
rescue_stuck_book.py
--------------------
Finds books stuck in 'processing' status in Firestore and either:
  1. Shows their state (--list)
  2. Resets pending/empty chunks so the pipeline can resume (--fix BOOK_ID)
  3. Auto-discovers and fixes all stuck books (--fix-all)

Requires: ai-worker/service-account.json  AND  requests (pip install requests)

Usage:
    python3 rescue_stuck_book.py --list
    python3 rescue_stuck_book.py --fix-all
    python3 rescue_stuck_book.py --fix BOOK_ID --org ORG_ID
"""

import argparse
import os
import sys

import firebase_admin
from firebase_admin import credentials, firestore

# ── Firebase init ─────────────────────────────────────────────────────────────
SA_PATH = os.path.join(os.path.dirname(__file__), '..', 'service-account.json')

def get_db():
    try:
        firebase_admin.get_app()
    except ValueError:
        if os.path.exists(SA_PATH):
            cred = credentials.Certificate(SA_PATH)
            firebase_admin.initialize_app(cred, {'projectId': 'caliopebot-dad29'})
        else:
            print("❌  service-account.json not found at", SA_PATH)
            sys.exit(1)
    return firestore.client()


# ── Core helpers ──────────────────────────────────────────────────────────────
def find_stuck_books(db):
    """Return list of (org_id, book_id, book_data) for books stuck in 'processing'."""
    stuck = []
    orgs = list(db.collection('organizations').stream())
    for org in orgs:
        books = list(org.reference.collection('books')
                     .where('status', '==', 'processing').stream())
        for book in books:
            stuck.append((org.id, book.id, book.to_dict()))
    return stuck


def rescue_book(db, org_id, book_id, dry_run=False):
    """Reset only pending/empty chunks so the pipeline can resume."""
    book_ref = (db.collection('organizations').document(org_id)
                  .collection('books').document(book_id))
    book_data = book_ref.get().to_dict() or {}

    chunks_ref = book_ref.collection('chunks')
    all_chunks = list(chunks_ref.order_by('order').stream())
    total = len(all_chunks)

    truly_done = [
        c for c in all_chunks
        if c.to_dict().get('status') == 'processed'
    ]
    to_reset = [c for c in all_chunks if c.to_dict().get('status') == 'pending']
    done_count = len(truly_done)
    pending_count = len(to_reset)

    title = book_data.get('title', book_id)
    pct = round(done_count / total * 100) if total else 0

    print(f"\n📖  {title}  ({book_id})")
    print(f"    Org: {org_id}")
    print(f"    Total chunks: {total}  |  Done: {done_count} ({pct}%)  |  To reset: {pending_count}")

    if dry_run:
        print("    [DRY RUN — no changes made]")
        return

    if pending_count == 0:
        print("    ✅  All chunks already processed — marking book as review_editor")
        book_ref.update({'status': 'review_editor', 'processedChunks': done_count})
        return

    # Batch-reset pending/empty chunks
    batch_size = 450
    for i in range(0, len(to_reset), batch_size):
        batch = db.batch()
        for c in to_reset[i:i + batch_size]:
            batch.update(chunks_ref.document(c.id), {'status': 'pending', 'suggestions': []})
        batch.commit()

    update_data = {
        'status': 'processing',
        'processedChunks': done_count,
        'totalChunks': total,
    }
    if done_count == 0:
        update_data['voiceProfile'] = None
    book_ref.update(update_data)

    print(f"    ✅  {pending_count} chunks reset to 'pending' — book will resume from {pct}%")
    print(f"    ℹ️   Now call the retry endpoint OR redeploy the worker to pick up pending chunks.")
    print()


# ── Entry point ───────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Rescue stuck CalíopeBot books")
    parser.add_argument('--list',     action='store_true', help='List all stuck books')
    parser.add_argument('--fix-all',  action='store_true', help='Fix all stuck books')
    parser.add_argument('--fix',      metavar='BOOK_ID',   help='Fix a specific book')
    parser.add_argument('--org',      metavar='ORG_ID',    help='Org ID (required with --fix)')
    parser.add_argument('--dry-run',  action='store_true', help='Show what would change, make no writes')
    args = parser.parse_args()

    db = get_db()

    if args.list or args.fix_all:
        stuck = find_stuck_books(db)
        if not stuck:
            print("✅  No stuck books found.")
            return
        print(f"🔍  Found {len(stuck)} stuck book(s):\n")
        for org_id, book_id, data in stuck:
            title = data.get('title', book_id)
            pct   = data.get('processedChunks', 0)
            total = data.get('totalChunks', '?')
            print(f"  • [{org_id}] {title} ({book_id}) — {pct}/{total} chunks")
        if args.fix_all:
            print()
            for org_id, book_id, _ in stuck:
                rescue_book(db, org_id, book_id, dry_run=args.dry_run)
    elif args.fix:
        if not args.org:
            print("❌  --org ORG_ID is required with --fix")
            sys.exit(1)
        rescue_book(db, args.org, args.fix, dry_run=args.dry_run)
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
