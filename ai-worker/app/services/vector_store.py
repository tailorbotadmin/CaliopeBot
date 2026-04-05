"""ChromaDB-based vector store for editorial rules and author style preferences."""

import logging
from typing import Optional
import chromadb
from chromadb.config import Settings as ChromaSettings

logger = logging.getLogger(__name__)


class EditorialVectorStore:
    """Dual-collection vector store for editorial RAG."""

    def __init__(self, persist_dir: str = "./chroma_data", ephemeral: bool = False):
        if ephemeral:
            self.client = chromadb.EphemeralClient()
        else:
            self.client = chromadb.PersistentClient(
                path=persist_dir,
                settings=ChromaSettings(anonymized_telemetry=False),
            )
        logger.info(f"ChromaDB initialized (ephemeral={ephemeral})")

    def _get_rules_collection(self, org_id: str):
        return self.client.get_or_create_collection(
            name=f"editorial_rules_{org_id}",
            metadata={"type": "editorial_rules", "org_id": org_id},
        )

    def _get_author_collection(self, author_id: str):
        return self.client.get_or_create_collection(
            name=f"author_style_{author_id}",
            metadata={"type": "author_style", "author_id": author_id},
        )

    def add_editorial_rule(
        self, org_id: str, rule_id: str, rule_text: str, metadata: Optional[dict] = None
    ) -> None:
        """Add an editorial rule to the organization's collection."""
        collection = self._get_rules_collection(org_id)
        meta = {"org_id": org_id, "type": "rule"}
        if metadata:
            meta.update(metadata)
        collection.upsert(ids=[rule_id], documents=[rule_text], metadatas=[meta])
        logger.info(f"Added rule {rule_id} for org {org_id}")

    def add_author_preference(
        self, author_id: str, pref_id: str, original: str, corrected: str, context: str = ""
    ) -> None:
        """Add an author style preference."""
        collection = self._get_author_collection(author_id)
        doc = f"Original: {original}\nCorregido: {corrected}\nContexto: {context}"
        collection.upsert(
            ids=[pref_id],
            documents=[doc],
            metadatas=[{"author_id": author_id, "type": "preference"}],
        )
        logger.info(f"Added preference {pref_id} for author {author_id}")

    def query_editorial_rules(
        self, org_id: str, text: str, top_k: int = 5
    ) -> list[dict]:
        """Query relevant editorial rules for a given text."""
        try:
            collection = self._get_rules_collection(org_id)
            if collection.count() == 0:
                return []
            results = collection.query(query_texts=[text], n_results=min(top_k, collection.count()))
            rules = []
            for i, doc in enumerate(results["documents"][0]):
                rules.append({
                    "text": doc,
                    "id": results["ids"][0][i],
                    "distance": results["distances"][0][i] if results.get("distances") else None,
                })
            return rules
        except Exception as e:
            logger.error(f"Error querying rules for org {org_id}: {e}")
            return []

    def query_author_style(
        self, author_id: str, text: str, top_k: int = 3
    ) -> list[dict]:
        """Query relevant author style preferences."""
        try:
            collection = self._get_author_collection(author_id)
            if collection.count() == 0:
                return []
            results = collection.query(query_texts=[text], n_results=min(top_k, collection.count()))
            prefs = []
            for i, doc in enumerate(results["documents"][0]):
                prefs.append({
                    "text": doc,
                    "id": results["ids"][0][i],
                    "distance": results["distances"][0][i] if results.get("distances") else None,
                })
            return prefs
        except Exception as e:
            logger.error(f"Error querying author style for {author_id}: {e}")
            return []

    def learn_from_correction(
        self, org_id: str, author_id: str, original: str, corrected: str, justification: str
    ) -> None:
        """Dual injection: store correction as both org rule and author preference."""
        import uuid

        rule_id = f"learned_{uuid.uuid4().hex[:8]}"
        rule_text = f"Regla aprendida: Cambiar '{original}' por '{corrected}'. Justificación: {justification}"
        self.add_editorial_rule(org_id, rule_id, rule_text, {"source": "learned"})

        pref_id = f"pref_{uuid.uuid4().hex[:8]}"
        self.add_author_preference(author_id, pref_id, original, corrected, justification)

        logger.info(f"Learned correction for org={org_id}, author={author_id}")
