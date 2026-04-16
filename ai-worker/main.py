"""
CalíopeBot AI Orchestrator
Multi-agent editorial correction system with RAG, observability, and vector store.
"""

import io
import os
import json
import uuid
import logging
from typing import List, Dict

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import language_tool_python
from google import genai
from google.genai import types
from dotenv import load_dotenv
import requests

load_dotenv()

# ==========================================
# CONFIGURATION
# ==========================================
from app.config import get_settings

settings = get_settings()

# ==========================================
# LOGGING
# ==========================================
from app.services.logging_config import setup_logging, RequestTimingMiddleware

setup_logging(
    level=settings.LOG_LEVEL,
    json_format=settings.is_production,
)
logger = logging.getLogger(__name__)

# ==========================================
# FIREBASE
# ==========================================
import firebase_admin
from firebase_admin import credentials, firestore

try:
    firebase_admin.get_app()
except ValueError:
    if settings.FIREBASE_SERVICE_ACCOUNT_PATH and os.path.exists(settings.FIREBASE_SERVICE_ACCOUNT_PATH):
        cred = credentials.Certificate(settings.FIREBASE_SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred)
    else:
        firebase_admin.initialize_app()

db = firestore.client()

# ==========================================
# VERTEX AI CLIENT (ADC via service account — no API key needed)
# ==========================================
try:
    logger.info("Initializing Gemini Client via Vertex AI (ADC)")
    client = genai.Client(
        vertexai=True,
        project=settings.GCP_PROJECT_ID,
        location=settings.GCP_LOCATION,
    )
except Exception as e:
    logger.warning(f"Vertex AI GenAI init failed, using mocks: {e}")
    client = None

# ==========================================
# VECTOR STORE (ChromaDB)
# ==========================================
from app.services.vector_store import EditorialVectorStore

try:
    vector_store = EditorialVectorStore(persist_dir=settings.CHROMA_PERSIST_DIR)
    logger.info("ChromaDB vector store initialized")
except Exception as e:
    logger.warning(f"ChromaDB init failed: {e}")
    vector_store = None

# ==========================================
# AI AGENTS
# ==========================================
from app.services.agents import GeneratorAgent, CriticAgent, ArbiterAgent

generator = GeneratorAgent(client=client, model=settings.LLM_MODEL)
critic = CriticAgent(client=client, vector_store=vector_store, model=settings.LLM_MODEL)
arbiter = ArbiterAgent(client=client, vector_store=vector_store, model=settings.LLM_MODEL)

# ==========================================
# METRICS
# ==========================================
from app.services.metrics import (
    metrics_endpoint, CORRECTIONS_PROCESSED, SUGGESTIONS_ACCEPTED,
    SUGGESTIONS_REJECTED, ACTIVE_JOBS, VECTOR_QUERIES,
)

# ==========================================
# LANGUAGETOOL
# ==========================================
import language_tool_python
class MockTool:
    def check(self, text):
        return []

try:
    # es-ES = español peninsular, normativa RAE
    tool = language_tool_python.LanguageToolPublicAPI('es-ES')
    logger.info("LanguageTool initialized: es-ES (RAE)")
except Exception as e:
    logger.warning(f"Failed to initialize LanguageTool, using mock: {e}")
    tool = MockTool()

# ==========================================
# FASTAPI APP
# ==========================================
app = FastAPI(
    title="CalíopeBot AI Orchestrator",
    version="2.0.0",
    description="Multi-agent editorial correction system with RAG and observability",
)

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestTimingMiddleware)

# Metrics endpoint
app.add_route("/metrics", metrics_endpoint)

# ==========================================
# MODELS
# ==========================================

class CorrectionRequest(BaseModel):
    textId: str
    text: str
    tenantId: str
    authorId: str

class SuggestionResponse(BaseModel):
    id: str
    originalText: str
    correctedText: str
    justification: str
    riskLevel: str
    sourceRule: str

class CorrectionResponse(BaseModel):
    textId: str
    suggestions: List[SuggestionResponse]

class IngestRequest(BaseModel):
    bookId: str
    organizationId: str
    fileUrl: str
    authorId: str

class ExtractRulesRequest(BaseModel):
    organizationId: str
    originalFileUrl: str
    correctedFileUrl: str

class ExportRequest(BaseModel):
    originalText: str
    acceptedSuggestions: List[Dict]

class LearnRequest(BaseModel):
    tenantId: str
    authorId: str
    role: str
    originalText: str
    correctedText: str
    justification: str

class TrainStyleRequest(BaseModel):
    organizationId: str
    directory: str  # Path to directory with manuscript pairs

class CreateUserRequest(BaseModel):
    email: str
    password: str
    name: str
    role: str
    organizationId: str

# ==========================================
# ENDPOINTS
# ==========================================

@app.get("/")
def health_check():
    return {
        "status": "ok",
        "service": "CalíopeBot AI Orchestrator v2.0",
        "environment": settings.ENVIRONMENT,
        "vector_store": vector_store is not None,
        "llm_client": client is not None,
    }


@app.post("/api/v1/process-text", response_model=CorrectionResponse)
async def process_text(request: CorrectionRequest):
    """Main correction endpoint: multi-agent debate pipeline."""
    logger.info(f"Processing text {request.textId} for org={request.tenantId}")

    # 1. LanguageTool (deterministic)
    lt_matches = tool.check(request.text)
    lt_errors = [
        {
            "rule": m.ruleId,
            "message": m.message,
            "replacements": m.replacements[:3],
            "context": request.text[m.offset:m.offset + m.errorLength],
        }
        for m in lt_matches
    ]

    # 2. Generator Agent
    gpt2_text = generator.run(request.text)

    # 3. Critic Agent (with RAG)
    critique = critic.run(request.text, gpt2_text, request.tenantId, request.authorId)

    # 4. Arbiter Agent (with RAG)
    final_suggestions_raw = arbiter.run(
        request.text, gpt2_text, critique,
        request.tenantId, request.authorId, lt_errors,
    )

    # Parse to SuggestionResponse
    final_suggestions = [SuggestionResponse(**s) for s in final_suggestions_raw]

    # Add LanguageTool suggestions (etiquetadas como RAE)
    for error in lt_errors:
        if error["replacements"]:
            final_suggestions.append(SuggestionResponse(
                id=f"lt_{uuid.uuid4().hex[:8]}",
                originalText=error["context"],
                correctedText=error["replacements"][0],
                justification=f"[RAE / LanguageTool] {error['message']} (Regla: {error['rule']})",
                riskLevel="low",
                sourceRule=f"RAE:{error['rule']}",
            ))

    CORRECTIONS_PROCESSED.inc()
    return CorrectionResponse(textId=str(uuid.uuid4()), suggestions=final_suggestions)


async def process_book_background(org_id: str, book_id: str, author_id: str):
    """Background task: process book chunks through multi-agent pipeline."""
    ACTIVE_JOBS.inc()
    try:
        logger.info(f"Background processing started: book={book_id}")
        chunks_ref = (
            db.collection("organizations").document(org_id)
            .collection("books").document(book_id).collection("chunks")
        )
        chunks = chunks_ref.order_by("order").limit(settings.MAX_CHUNKS_PER_BATCH).stream()

        batch = db.batch()
        processed_count = 0

        for chunk in chunks:
            data = chunk.to_dict()
            if data.get("status") != "pending":
                continue

            text = data["text"]

            # 1. LanguageTool
            lt_matches = tool.check(text)
            lt_errors = [
                {"rule": m.ruleId, "message": m.message,
                 "replacements": m.replacements[:3],
                 "context": text[m.offset:m.offset + m.errorLength]}
                for m in lt_matches
            ]

            # 2-4. Agent pipeline
            gpt2_text = generator.run(text)
            critique = critic.run(text, gpt2_text, org_id, author_id)
            suggestions = arbiter.run(text, gpt2_text, critique, org_id, author_id, lt_errors)

            # Add LT suggestions
            for error in lt_errors:
                if error["replacements"]:
                    suggestions.append({
                        "id": f"lt_{uuid.uuid4().hex[:8]}",
                        "originalText": error["context"],
                        "correctedText": error["replacements"][0],
                        "justification": f"Regla {error['rule']}: {error['message']}",
                        "riskLevel": "low",
                        "status": "pending",
                        "sourceRule": error["rule"],
                    })

            for s in suggestions:
                s.setdefault("status", "pending")

            batch.update(chunks_ref.document(chunk.id), {
                "status": "processed",
                "suggestions": suggestions,
            })
            processed_count += 1

        if processed_count > 0:
            batch.commit()
        else:
            logger.warning(f"No pending chunks found for book={book_id}. Already processed or empty.")

        # Update book status — always runs even if processed_count == 0
        book_ref = (
            db.collection("organizations").document(org_id)
            .collection("books").document(book_id)
        )
        book_ref.update({"status": "review_editor", "processedChunks": processed_count})
        logger.info(f"Background done: book={book_id}, processed={processed_count}")

    except Exception as e:
        logger.error(f"Background task error for book={book_id}: {e}", exc_info=True)
        # Mark book as error so the user can see it and retry
        try:
            book_ref = (
                db.collection("organizations").document(org_id)
                .collection("books").document(book_id)
            )
            book_ref.update({
                "status": "error",
                "errorMessage": str(e)[:500],  # cap at 500 chars
            })
        except Exception as inner_e:
            logger.error(f"Could not update error status for book={book_id}: {inner_e}")
    finally:
        ACTIVE_JOBS.dec()


@app.post("/api/v1/ingest-book")
async def ingest_book(request: IngestRequest, background_tasks: BackgroundTasks):
    """Parse DOCX manuscript and create chunks in Firestore."""
    try:
        from docx import Document

        response = requests.get(request.fileUrl, timeout=60)
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to download file")

        doc = Document(io.BytesIO(response.content))
        chunks_ref = (
            db.collection("organizations").document(request.organizationId)
            .collection("books").document(request.bookId).collection("chunks")
        )

        # Batch with proper 500 limit handling
        all_chunks = []
        chunk_index = 0
        for para in doc.paragraphs:
            text = para.text.strip()
            if text:
                all_chunks.append({
                    "id": f"chunk_{str(chunk_index).zfill(4)}",
                    "text": text,
                    "style": para.style.name if para.style else "Normal",
                    "status": "pending",
                    "order": chunk_index,
                })
                chunk_index += 1

        # Commit in batches of 450 (safe margin under 500 limit)
        for i in range(0, len(all_chunks), 450):
            batch = db.batch()
            for chunk_data in all_chunks[i:i + 450]:
                doc_ref = chunks_ref.document(chunk_data["id"])
                batch.set(doc_ref, chunk_data)
            batch.commit()

        # Update book status
        book_ref = (
            db.collection("organizations").document(request.organizationId)
            .collection("books").document(request.bookId)
        )
        book_ref.update({
            "status": "processing",
            "totalChunks": len(all_chunks),
            "processedChunks": 0,
        })

        background_tasks.add_task(
            process_book_background, request.organizationId, request.bookId, request.authorId
        )

        logger.info(f"Ingested book {request.bookId}: {len(all_chunks)} chunks")
        return {"status": "success", "total_chunks": len(all_chunks)}

    except Exception as e:
        logger.error(f"Ingest error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/extract-rules")
async def extract_rules(request: ExtractRulesRequest):
    """Extract editorial rules by comparing original vs corrected documents."""
    try:
        from docx import Document

        resp_orig = requests.get(request.originalFileUrl, timeout=60)
        resp_corr = requests.get(request.correctedFileUrl, timeout=60)

        if resp_orig.status_code != 200 or resp_corr.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to download files")

        doc_orig = Document(io.BytesIO(resp_orig.content))
        doc_corr = Document(io.BytesIO(resp_corr.content))

        text_orig = "\n".join([p.text for p in doc_orig.paragraphs[:100] if p.text.strip()])
        text_corr = "\n".join([p.text for p in doc_corr.paragraphs[:100] if p.text.strip()])

        if not client:
            rules = [{"id": f"p{uuid.uuid4().hex[:8]}", "rule": "Mock rule", "description": "No LLM.", "status": "pending"}]
        else:
            schema = {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "rule": {"type": "STRING"},
                        "description": {"type": "STRING"},
                    },
                    "required": ["rule", "description"],
                },
            }
            prompt = f"""Eres un Analista Editorial experto en lengua española.
Compara estos dos textos y DEDUCE las reglas editoriales sistemáticas que aplicó el corrector.
Busca patrones consistentes. No devuelvas correcciones puntuales, sino REGLAS GENERALES.

IMPORTANTE: Responde SIEMPRE en español. Los campos 'rule' y 'description' deben estar
escritos en español, independientemente del idioma del texto analizado.

=== TEXTO ORIGINAL ===
{text_orig}

=== TEXTO CORREGIDO ===
{text_corr}"""

            response = client.models.generate_content(
                model=settings.LLM_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=schema,
                    temperature=0.2,
                ),
            )
            deduced = json.loads(response.text)
            rules = []
            for r in deduced:
                rules.append({
                    "id": f"p{uuid.uuid4().hex[:8]}",
                    "rule": r["rule"],
                    "description": r["description"],
                    "status": "pending",
                    "createdAt": firestore.SERVER_TIMESTAMP,
                })

        # Store in Firestore + Vector DB
        batch = db.batch()
        org_ref = db.collection("organizations").document(request.organizationId)
        for rule in rules:
            rule_ref = org_ref.collection("pendingRules").document(rule["id"])
            batch.set(rule_ref, rule)
            if vector_store:
                vector_store.add_editorial_rule(
                    request.organizationId, rule["id"],
                    f"{rule['rule']}: {rule['description']}",
                )
        batch.commit()

        logger.info(f"Extracted {len(rules)} rules for org={request.organizationId}")
        return {"status": "success", "extractedRules": rules}

    except Exception as e:
        logger.error(f"Extract rules error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/export-docx")
async def export_docx(request: ExportRequest):
    """Export corrected document as DOCX."""
    from docx import Document

    doc = Document()
    doc.add_paragraph("CalíopeBot - Documento Corregido")

    final_text = request.originalText
    for sug in request.acceptedSuggestions:
        final_text = final_text.replace(
            sug.get("originalText", ""), sug.get("correctedText", "")
        )
    doc.add_paragraph(final_text)

    file_stream = io.BytesIO()
    doc.save(file_stream)
    file_stream.seek(0)

    return {"message": "Export successful", "size": len(file_stream.getvalue())}


@app.post("/api/v1/learn-correction")
async def learn_correction(request: LearnRequest):
    """Self-learning: inject accepted correction into vector store for RAG."""
    if vector_store:
        vector_store.learn_from_correction(
            org_id=request.tenantId,
            author_id=request.authorId,
            original=request.originalText,
            corrected=request.correctedText,
            justification=request.justification,
        )
        SUGGESTIONS_ACCEPTED.inc()
        VECTOR_QUERIES.labels(collection_type="learn").inc()
        logger.info(f"Learned correction for org={request.tenantId}, author={request.authorId}")
    else:
        logger.warning("Vector store not available, correction not persisted")

    return {
        "status": "success",
        "message": f"Correction learned for author {request.authorId} by {request.role}",
    }


@app.post("/api/v1/train-style")
async def train_style(request: TrainStyleRequest, background_tasks: BackgroundTasks):
    """Batch process manuscript pairs to extract editorial style rules."""
    from app.services.style_trainer import StyleTrainer

    trainer = StyleTrainer(client=client, vector_store=vector_store)

    async def _run():
        total = trainer.batch_process_manuscripts(
            request.directory, request.organizationId, db
        )
        logger.info(f"Style training complete: {total} rules extracted")

    background_tasks.add_task(_run)
    return {"status": "processing", "message": "Style training started in background"}


class UpdateRoleRequest(BaseModel):
    targetUid: str
    role: str

@app.post("/api/v1/users/update-role")
async def update_user_role(request: UpdateRoleRequest, raw_req: Request):
    """Update a user's role in Firebase Auth custom claims and Firestore."""
    auth_header = raw_req.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = auth_header.split("Bearer ")[1]
    try:
        from firebase_admin import auth as firebase_auth
        decoded_token = firebase_auth.verify_id_token(token)

        caller_role = decoded_token.get("role", "")
        if caller_role not in ["Admin", "SuperAdmin"]:
            raise HTTPException(status_code=403, detail="Forbidden, insufficient permissions")

        # Admins cannot promote to Admin or SuperAdmin
        if caller_role == "Admin" and request.role in ["Admin", "SuperAdmin"]:
            raise HTTPException(status_code=403, detail="Admins cannot assign Admin or SuperAdmin roles")

        # Get target user's current org to prevent cross-org attacks
        target_user = db.collection("users").document(request.targetUid).get()
        if not target_user.exists:
            raise HTTPException(status_code=404, detail="User not found")

        target_org = target_user.to_dict().get("organizationId")
        caller_org = decoded_token.get("organizationId")
        if caller_role != "SuperAdmin" and target_org != caller_org:
            raise HTTPException(status_code=403, detail="Cannot edit users outside your organization")

        # Update custom claims (immediate token propagation)
        current_claims = firebase_auth.get_user(request.targetUid).custom_claims or {}
        current_claims["role"] = request.role
        firebase_auth.set_custom_user_claims(request.targetUid, current_claims)

        # Update Firestore profile
        db.collection("users").document(request.targetUid).update({"role": request.role})

        logger.info(f"Role updated: uid={request.targetUid} -> role={request.role} by {decoded_token['uid']}")
        return {"status": "success", "uid": request.targetUid, "role": request.role}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating role: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/users/create")
async def create_user_endpoint(request: CreateUserRequest, raw_req: Request):
    """Admin endpoint to create a new user and set custom claims securely."""
    auth_header = raw_req.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    
    token = auth_header.split("Bearer ")[1]
    try:
        from firebase_admin import auth as firebase_auth
        decoded_token = firebase_auth.verify_id_token(token)
        
        # Only Admins and SuperAdmins can create users
        if decoded_token.get("role") not in ["Admin", "SuperAdmin"]:
            raise HTTPException(status_code=403, detail="Forbidden, insufficient permissions")
            
        # Security: You can't create users outside your assigned org unless you are SuperAdmin
        if decoded_token.get("role") != "SuperAdmin" and decoded_token.get("organizationId") != request.organizationId:
            raise HTTPException(status_code=403, detail="Forbidden, cannot create users outside your organization")

        user_record = firebase_auth.create_user(
            email=request.email,
            password=request.password,
            display_name=request.name
        )
        
        firebase_auth.set_custom_user_claims(user_record.uid, {
            "role": request.role,
            "organizationId": request.organizationId
        })
        
        db.collection("users").document(user_record.uid).set({
            "email": request.email,
            "name": request.name,
            "role": request.role,
            "organizationId": request.organizationId,
            "createdAt": firestore.SERVER_TIMESTAMP
        })
        
        logger.info(f"User {request.email} created successfully with role {request.role}")
        return {"status": "success", "uid": user_record.uid}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating user: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

class DeleteUserRequest(BaseModel):
    targetUid: str


@app.delete("/api/v1/users/delete")
async def delete_user(request: DeleteUserRequest, raw_req: Request):
    """Admin endpoint to delete a user from Firebase Auth and Firestore."""
    auth_header = raw_req.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = auth_header.split("Bearer ")[1]
    try:
        from firebase_admin import auth as firebase_auth

        decoded_token = firebase_auth.verify_id_token(token)
        caller_role = decoded_token.get("role", "")

        if caller_role not in ["Admin", "SuperAdmin"]:
            raise HTTPException(status_code=403, detail="Forbidden, insufficient permissions")

        # Fetch target user to enforce cross-org and self-delete protections
        target_doc = db.collection("users").document(request.targetUid).get()
        if not target_doc.exists:
            raise HTTPException(status_code=404, detail="User not found")

        target_data = target_doc.to_dict()
        target_role = target_data.get("role", "")
        target_org = target_data.get("organizationId")
        caller_org = decoded_token.get("organizationId")

        # Prevent cross-org deletion (except SuperAdmin)
        if caller_role != "SuperAdmin" and target_org != caller_org:
            raise HTTPException(status_code=403, detail="Cannot delete users outside your organization")

        # Admins cannot delete other Admins or SuperAdmins
        if caller_role == "Admin" and target_role in ["Admin", "SuperAdmin"]:
            raise HTTPException(status_code=403, detail="Admins cannot delete Admin or SuperAdmin users")

        # Prevent self-deletion
        if request.targetUid == decoded_token.get("uid"):
            raise HTTPException(status_code=400, detail="Cannot delete your own account")

        # Delete from Firebase Auth
        firebase_auth.delete_user(request.targetUid)

        # Delete Firestore profile
        db.collection("users").document(request.targetUid).delete()

        logger.info(
            f"User deleted: uid={request.targetUid} (role={target_role}) "
            f"by {decoded_token['uid']} (role={caller_role})"
        )
        return {"status": "success", "uid": request.targetUid}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting user: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class SeedRAERulesRequest(BaseModel):
    organizationId: str


@app.post("/api/v1/seed-rae-rules")
async def seed_rae_rules_endpoint(request: SeedRAERulesRequest, raw_req: Request):
    """SuperAdmin endpoint: populate an org with the canonical RAE rules corpus."""
    auth_header = raw_req.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = auth_header.split("Bearer ")[1]
    try:
        from firebase_admin import auth as firebase_auth

        decoded_token = firebase_auth.verify_id_token(token)
        if decoded_token.get("role") != "SuperAdmin":
            raise HTTPException(status_code=403, detail="Only SuperAdmins can seed RAE rules")

        # Import the RAE corpus from the pure data module (no Firebase side-effects)
        from rae_rules_corpus import RAE_RULES  # noqa: PLC0415

        org_ref = db.collection("organizations").document(request.organizationId)

        # Check which rules already exist to avoid duplicates
        existing_snap = org_ref.collection("rules").stream()
        existing_ids = {doc.id for doc in existing_snap}

        batch = db.batch()
        inserted = 0
        skipped = 0

        for i, rule in enumerate(RAE_RULES):
            rule_id = f"rae_{i:03d}"
            if rule_id in existing_ids:
                skipped += 1
                continue

            rule_doc = {
                **rule,
                "status": "active",
                "source": rule.get("source", "RAE"),
                "createdAt": firestore.SERVER_TIMESTAMP,
            }
            batch.set(org_ref.collection("rules").document(rule_id), rule_doc)

            # Index in ChromaDB if available
            if vector_store:
                try:
                    vector_store.add_editorial_rule(
                        request.organizationId,
                        rule_id,
                        f"{rule['name']}: {rule['description']}",
                    )
                except Exception as ve:
                    logger.warning(f"ChromaDB indexing failed for {rule_id}: {ve}")

            inserted += 1

        batch.commit()

        logger.info(
            f"seed-rae-rules: org={request.organizationId} "
            f"inserted={inserted} skipped={skipped} "
            f"by uid={decoded_token['uid']}"
        )
        return {
            "status": "success",
            "organizationId": request.organizationId,
            "inserted": inserted,
            "skipped": skipped,
            "total": len(RAE_RULES),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error seeding RAE rules: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── Language detection helpers ───────────────────────────────────────────────

_SPANISH_PATTERN = re.compile(
    r"[ñáéíóúüÁÉÍÓÚÜ]|"
    r"\b(de|el|la|los|las|en|que|con|por|para|como|del|una|sin|este|esta|se|su|sus|al|"
    r"pero|más|no|es|son|fue|han|hay|un|su|ya|lo|le|si|yo|mi|te|me)\b",
    re.IGNORECASE,
)
_ENGLISH_PATTERN = re.compile(
    r"\b(the|and|or|with|for|from|text|using|when|should|must|will|are|is|be|that|this|which|"
    r"have|has|been|their|can|may|format|list|header|italic|bold|margin|spacing|font|style|"
    r"rule|item|use|used|applied|correction|spelling|capitalization|punctuation|alignment|"
    r"inclusion|placement|numbering|formatting|usage|dialogue|paragraph|footnote|quotation|"
    r"consistency|choice|structure|flow|marks|page|title|chapter|content)\b",
    re.IGNORECASE,
)


def _is_english_text(text: str) -> bool:
    if not text:
        return False
    return bool(_ENGLISH_PATTERN.search(text)) and not bool(_SPANISH_PATTERN.search(text))


class TranslateRulesRequest(BaseModel):
    organizationId: str


@app.post("/api/v1/translate-rules")
async def translate_rules_endpoint(request: TranslateRulesRequest, raw_req: Request):
    """SuperAdmin endpoint: detect English rules in an org and translate them to Spanish.
    Uses the Gemini client already configured in this worker — no extra credentials needed.
    """
    auth_header = raw_req.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = auth_header.split("Bearer ")[1]
    try:
        from firebase_admin import auth as firebase_auth

        decoded_token = firebase_auth.verify_id_token(token)
        if decoded_token.get("role") != "SuperAdmin":
            raise HTTPException(status_code=403, detail="Solo SuperAdmins pueden traducir normas")

        org_ref = db.collection("organizations").document(request.organizationId)

        # 1. Collect English rules from both collections
        english_rules = []
        for col_name in ("rules", "pendingRules"):
            snap = org_ref.collection(col_name).stream()
            for doc_snap in snap:
                data = doc_snap.to_dict()
                name = data.get("name") or data.get("rule") or ""
                desc = data.get("description") or ""
                if _is_english_text(f"{name} {desc}"):
                    if (data.get("source") or "").startswith("RAE"):
                        continue  # never touch RAE rules
                    english_rules.append({
                        "ref": doc_snap.reference,
                        "name": name,
                        "description": desc,
                    })

        if not english_rules:
            return {"status": "ok", "translated": 0, "message": "No se encontraron normas en inglés."}

        logger.info(f"translate-rules: {len(english_rules)} English rules found in org={request.organizationId}")

        # 2. Translate in batches of 10 using the configured Gemini client
        BATCH_SIZE = 10
        schema = {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "nombre": {"type": "STRING"},
                    "descripcion": {"type": "STRING"},
                },
                "required": ["nombre", "descripcion"],
            },
        }

        translated_count = 0
        for i in range(0, len(english_rules), BATCH_SIZE):
            batch_rules = english_rules[i:i + BATCH_SIZE]
            list_text = "\n".join(
                f'{j+1}. Nombre: "{r["name"]}" | Descripción: "{r["description"][:200]}"'
                for j, r in enumerate(batch_rules)
            )
            prompt = (
                "Eres un editor experto en lengua española. "
                "Traduce al español cada una de las siguientes normas editoriales.\n"
                "Para cada una devuelve:\n"
                "- \"nombre\": nombre breve de la norma en español (máx. 8 palabras)\n"
                "- \"descripcion\": explicación práctica en español (1-2 frases)\n\n"
                "IMPORTANTE: Toda la respuesta en español. No uses inglés en ningún campo.\n\n"
                f"{list_text}"
            )

            if client:
                try:
                    response = client.models.generate_content(
                        model=settings.LLM_MODEL,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=schema,
                            temperature=0.2,
                        ),
                    )
                    translated = json.loads(response.text)
                except Exception as e:
                    logger.warning(f"Gemini translation error batch {i}: {e}")
                    translated = [{"nombre": r["name"], "descripcion": r["description"]} for r in batch_rules]
            else:
                translated = [{"nombre": r["name"], "descripcion": r["description"]} for r in batch_rules]

            # 3. Write translated names back to Firestore
            firestore_batch = db.batch()
            for j, rule in enumerate(batch_rules):
                t = translated[j] if j < len(translated) else {"nombre": rule["name"], "descripcion": rule["description"]}
                firestore_batch.update(rule["ref"], {
                    "name": t["nombre"],
                    "rule": t["nombre"],
                    "description": t["descripcion"],
                })
                translated_count += 1
            firestore_batch.commit()

        logger.info(f"translate-rules: translated {translated_count} rules for org={request.organizationId}")
        return {
            "status": "success",
            "organizationId": request.organizationId,
            "translated": translated_count,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error translating rules: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
