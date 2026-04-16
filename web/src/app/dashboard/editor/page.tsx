"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { collection, query, orderBy, onSnapshot, doc, setDoc, getDoc, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { updateBookStatus, notifyResponsables } from "@/lib/firestore";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { saveAs } from "file-saver";
import { ChevronLeft, ChevronRight, ArrowLeft, Download, CheckCircle2, XCircle, Clock } from "lucide-react";
import "./editor.css";

type Suggestion = {
  id: string;
  originalText: string;
  correctedText: string;
  justification: string;
  status: "pending" | "accepted" | "rejected" | "edited";
  riskLevel: "low" | "medium" | "high";
  sourceRule?: string;
};

type Chunk = {
  id: string;
  text: string;
  order: number;
  status: string;
  suggestions?: Suggestion[];
};

export default function EditorPage() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("bookId");
  const { organizationId, user, role } = useAuth();
  const router = useRouter();

  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [bookStatus, setBookStatus] = useState<string>("processing");
  const [bookTitle, setBookTitle] = useState<string>("");
  const [processedCount, setProcessedCount] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);

  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);
  const [editingSuggestion, setEditingSuggestion] = useState<string | null>(null);
  const [customEdit, setCustomEdit] = useState("");
  const [jumpInput, setJumpInput] = useState("");

  const suggestions: Suggestion[] = useMemo(() => {
    if (chunks.length === 0) return [];
    return (chunks[currentChunkIndex]?.suggestions ?? []) as Suggestion[];
  }, [chunks, currentChunkIndex]);

  const setSuggestions = (newSuggestions: Suggestion[]) => {
    const newChunks = [...chunks];
    if (newChunks[currentChunkIndex]) {
      newChunks[currentChunkIndex] = { ...newChunks[currentChunkIndex], suggestions: newSuggestions };
      setChunks(newChunks);
    }
  };

  // Global progress across all chunks
  const globalProgress = useMemo(() => {
    let total = 0, resolved = 0;
    chunks.forEach(c => {
      (c.suggestions ?? []).forEach((s: Suggestion) => {
        total++;
        if (s.status !== "pending") resolved++;
      });
    });
    return { total, resolved, pct: total > 0 ? Math.round((resolved / total) * 100) : 0 };
  }, [chunks]);

  // ── Real-time book listener ───────────────────────────────────────
  useEffect(() => {
    if (!organizationId || !bookId) return;
    const bookRef = doc(db, "organizations", organizationId, "books", bookId);
    const unsub = onSnapshot(bookRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setBookStatus(data.status ?? "processing");
        setBookTitle(data.title ?? "");
        setTotalChunks(data.totalChunks ?? 0);
        setProcessedCount(data.processedChunks ?? 0);
      }
    });
    return unsub;
  }, [organizationId, bookId]);

  // ── Real-time chunks listener ─────────────────────────────────────
  // Updates chunk list live as the worker commits each batch.
  useEffect(() => {
    if (!organizationId || !bookId) return;
    const q = query(
      collection(db, "organizations", organizationId, "books", bookId, "chunks"),
      orderBy("order", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() } as Chunk));
      setChunks(fetched);
    }, (err) => {
      console.error("Error listening to chunks:", err);
    });
    return unsub;
  }, [organizationId, bookId]);


  const handleNextPhase = async () => {
    if (!bookId || !organizationId) return;
    let nextStatus = "review_author";
    if (role === "Editor") nextStatus = "review_author";
    else if (role === "Autor") nextStatus = "review_responsable";
    else if (role === "Responsable_Editorial" || role === "SuperAdmin") nextStatus = "approved";

    try {
      await updateBookStatus(organizationId, bookId, nextStatus);
      // Notify Responsables if Editor or Autor finishes their phase
      if ((role === "Editor" || role === "Autor") && organizationId) {
        try {
          const bookTitleEl = document.querySelector("h1");
          const bookTitle = bookTitleEl?.textContent ?? bookId ?? "";
          await notifyResponsables(organizationId, {
            type: "correction_done",
            title: role === "Editor" ? "Corrección completada" : "Revisión de autor completada",
            message: role === "Editor"
              ? `El editor ha completado las correcciones del manuscrito y está listo para revisión del autor.`
              : `El autor ha revisado el manuscrito y está listo para aprobación final.`,
            bookId: bookId ?? "",
            bookTitle: bookTitle,
            organizationId: organizationId,
            read: false,
          });
        } catch { /* non-critical */ }
      }
      router.push("/dashboard/books");
    } catch (e) {
      console.error("Error avanzando fase", e);
    }
  };

  const handleDownloadDocx = async () => {
    if (chunks.length === 0) return;
    const docChildren = chunks.map(chunk => {
      let computed = chunk.text || "";
      if (chunk.suggestions) {
        chunk.suggestions.forEach((s: Suggestion) => {
          if (s.status !== "rejected") {
            computed = computed.replace(s.originalText, s.correctedText);
          }
        });
      }
      return new Paragraph({ children: [new TextRun(computed)], spacing: { after: 200 } });
    });

    const wordDoc = new Document({ sections: [{ properties: {}, children: docChildren }] });
    const blob = await Packer.toBlob(wordDoc);
    saveAs(blob, `${bookTitle || "Manuscrito"}_Corregido.docx`);
  };

  const handleAction = async (id: string, action: "accepted" | "rejected") => {
    const newSuggestions = suggestions.map(s => s.id === id ? { ...s, status: action } : s);
    setSuggestions(newSuggestions);
    await saveChunkLocally(newSuggestions);

    const actedSug = newSuggestions.find(s => s.id === id);

    // Write CorrectionRecord → feeds computeOrgKPIs in Reports
    if (organizationId && user && actedSug) {
      try {
        await addDoc(collection(db, "corrections"), {
          bookId: bookId ?? null,
          organizationId,
          editorId: user.uid,
          editorEmail: user.email ?? null,
          editorName: user.displayName ?? user.email ?? null,
          status: action,
          sourceRule: actedSug.sourceRule ?? null,
          originalText: actedSug.originalText,
          correctedText: actedSug.correctedText,
          createdAt: serverTimestamp(),
        });
      } catch (e) { console.error("Could not write correction record", e); }
    }

    // Trigger RAG self-learning only for accepted suggestions
    if (action === "accepted" && organizationId && user && actedSug) {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
        await fetch(`${apiUrl}/api/v1/learn-correction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: organizationId,
            authorId: user.uid,
            role,
            originalText: actedSug.originalText,
            correctedText: actedSug.correctedText,
            justification: actedSug.justification,
          }),
        });
      } catch (e) { console.error("Could not trigger learn-correction", e); }
    }
  };

  const saveEdit = async (id: string) => {
    if (!customEdit.trim()) return;
    const newSuggestions = suggestions.map(s =>
      s.id === id ? { ...s, status: "edited" as const, correctedText: customEdit } : s
    );
    setSuggestions(newSuggestions);
    setEditingSuggestion(null);
    await saveChunkLocally(newSuggestions);
  };

  const saveChunkLocally = async (newSuggestions: Suggestion[]) => {
    if (!organizationId || !bookId || chunks.length === 0) return;
    const currentChunk = chunks[currentChunkIndex];
    try {
      await setDoc(
        doc(db, "organizations", organizationId, "books", bookId, "chunks", currentChunk.id),
        { ...currentChunk, suggestions: newSuggestions },
        { merge: true }
      );
    } catch (e) { console.error("Error saving chunk:", e); }
  };

  const handleJump = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(jumpInput, 10);
    if (!isNaN(n) && n >= 1 && n <= chunks.length) {
      setCurrentChunkIndex(n - 1);
      setJumpInput("");
    }
  };

  const canManageSuggestions = () => {
    if (!role) return false;
    if (["SuperAdmin", "Responsable_Editorial", "Editor"].includes(role)) return true;
    if (["Autor"].includes(role)) {
      return ["review_author", "review_responsable", "approved"].includes(bookStatus);
    }
    return false;
  };

  if (!bookId) return <div style={{ padding: "2rem" }}>No se ha seleccionado ningún libro.</div>;

  // Count processed chunks
  const processedChunks = chunks.filter(c => c.status === "processed").length;
  const isStillProcessing = bookStatus === "processing";
  const hasReadyChunks = processedChunks > 0;

  // Only block with the full spinner if no chunks are ready yet
  if (isStillProcessing && !hasReadyChunks) {
    const pct = totalChunks > 0 ? Math.round((processedCount / totalChunks) * 100) : 0;
    return (
      <div className="editor-container fade-in" style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: "4rem 2rem", maxWidth: "480px" }}>
          <div className="processing-spinner" style={{ marginBottom: "1.5rem" }}>
            <div className="spinner-ring" />
          </div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "0.5rem" }}>
            Los agentes están analizando el manuscrito
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>
            <strong style={{ color: "var(--primary)" }}>{bookTitle || "El manuscrito"}</strong> está siendo procesado.
            La edición se desbloqueará en cuanto el primer segmento esté listo.
          </p>
          {totalChunks > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.375rem" }}>
                <span>Segmentos analizados</span>
                <span>{processedCount} / {totalChunks}</span>
              </div>
              <div style={{ height: "6px", borderRadius: "99px", backgroundColor: "var(--border-color)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, backgroundColor: "var(--primary)", borderRadius: "99px", transition: "width 0.5s ease" }} />
              </div>
            </div>
          )}
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.375rem" }}>
            <div className="pulse-dot" /> El análisis se actualiza en tiempo real...
          </div>
          <button
            className="btn btn-secondary"
            style={{ marginTop: "2rem" }}
            onClick={() => router.push("/dashboard/books")}
          >
            <ArrowLeft size={14} style={{ marginRight: "0.375rem" }} /> Volver a la biblioteca
          </button>
        </div>
      </div>
    );
  }

  if (chunks.length === 0) {
    return (
      <div className="editor-container" style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: "4rem", color: "var(--text-muted)" }}>
          Este manuscrito no tiene segmentos de texto disponibles.
          <br />
          <button className="btn btn-secondary" style={{ marginTop: "1.5rem" }} onClick={() => router.push("/dashboard/books")}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  const currentChunk = chunks[currentChunkIndex];

  let computedCorrectedText = currentChunk.text || "";
  suggestions.forEach(s => {
    if (s.status !== "rejected") {
      computedCorrectedText = computedCorrectedText.replace(s.originalText, s.correctedText);
    }
  });

  const pendingSuggestions = suggestions.filter(s => s.status === "pending");
  const resolvedSuggestions = suggestions.filter(s => s.status !== "pending");

  return (
    <div className="editor-container fade-in">
      {/* ── Non-blocking analysis progress banner ───────────────────── */}
      {isStillProcessing && hasReadyChunks && (
        <div style={{
          backgroundColor: "rgba(99,102,241,0.08)",
          borderBottom: "1px solid rgba(99,102,241,0.2)",
          padding: "0.5rem 1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          fontSize: "0.8125rem",
          color: "var(--text-muted)",
        }}>
          <div className="pulse-dot" style={{ flexShrink: 0 }} />
          <span>
            Analizando{totalChunks > 0 ? `: ${processedChunks} / ${totalChunks} segmentos listos` : "…"}
          </span>
          {totalChunks > 0 && (
            <div style={{ flex: 1, maxWidth: "200px", height: "4px", backgroundColor: "var(--border-color)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round((processedChunks / totalChunks) * 100)}%`, backgroundColor: "var(--primary)", borderRadius: "2px", transition: "width 0.5s ease" }} />
            </div>
          )}
          <span style={{ marginLeft: "auto", color: "#6366f1", fontWeight: 600 }}>
            Los segmentos listos ya están disponibles para editar
          </span>
        </div>
      )}
      <header className="editor-header">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.25rem" }}>
            <button
              className="btn-ghost"
              style={{ padding: "0.25rem 0.5rem", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.25rem", color: "var(--text-muted)" }}
              onClick={() => router.push("/dashboard/books")}
            >
              <ArrowLeft size={14} /> Biblioteca
            </button>
            <span style={{ color: "var(--border-color)" }}>/</span>
            <h1 className="editor-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {bookTitle || "Manuscrito"} — Segmento {currentChunkIndex + 1}/{chunks.length}
            </h1>
          </div>

          {/* Progress bar */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ flex: 1, maxWidth: "280px", height: "4px", backgroundColor: "var(--border-color)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${globalProgress.pct}%`, backgroundColor: globalProgress.pct === 100 ? "var(--success)" : "var(--primary)", transition: "width 0.4s ease", borderRadius: "2px" }} />
            </div>
            <span className="editor-stats">
              {globalProgress.resolved}/{globalProgress.total} sugerencias resueltas · {globalProgress.pct}%
            </span>
          </div>
        </div>

        <div className="editor-actions" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
          {/* Jump to segment */}
          <form onSubmit={handleJump} style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Ir a:</span>
            <input
              type="number"
              className="input"
              value={jumpInput}
              onChange={e => setJumpInput(e.target.value)}
              placeholder={String(currentChunkIndex + 1)}
              min={1}
              max={chunks.length}
              style={{ width: "64px", padding: "0.3rem 0.5rem", fontSize: "0.8125rem", marginBottom: 0, textAlign: "center" }}
            />
            <button type="submit" className="btn btn-secondary" style={{ padding: "0.3rem 0.5rem", fontSize: "0.75rem" }}>→</button>
          </form>

          <button className="btn btn-secondary" onClick={() => setCurrentChunkIndex(Math.max(0, currentChunkIndex - 1))} disabled={currentChunkIndex === 0} style={{ padding: "0.4rem 0.6rem" }}>
            <ChevronLeft size={16} />
          </button>
          <button className="btn btn-secondary" onClick={() => setCurrentChunkIndex(Math.min(chunks.length - 1, currentChunkIndex + 1))} disabled={currentChunkIndex === chunks.length - 1} style={{ padding: "0.4rem 0.6rem" }}>
            <ChevronRight size={16} />
          </button>

          {canManageSuggestions() && (
            <button className="btn" style={{ whiteSpace: "nowrap" }} onClick={handleNextPhase}>
              Cerrar Fase ✓
            </button>
          )}
          <button
            className="btn"
            style={{ backgroundColor: "var(--success)", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "0.375rem" }}
            onClick={handleDownloadDocx}
          >
            <Download size={14} /> .docx
          </button>
        </div>
      </header>

      {/* Editor Main Views */}
      {currentChunk.status === "processing" ? (
        <div style={{ textAlign: "center", padding: "4rem", color: "var(--text-muted)", flex: 1 }}>
          Este fragmento aún está siendo procesado por IA...
        </div>
      ) : (
        <div className="pane-wrapper">
          <div className="text-pane">
            <div className="pane-header">Texto Original (Autor)</div>
            <div className="pane-content original-text">{currentChunk.text}</div>
          </div>
          <div className="text-pane">
            <div className="pane-header" style={{ color: "var(--primary)" }}>Texto Corregido (IA) — Preview</div>
            <div className="pane-content corrected-text">{computedCorrectedText}</div>
          </div>
        </div>
      )}

      {/* Suggestions Panel — redesigned with sections */}
      <div className="suggestions-panel">
        {/* Pending suggestions */}
        {pendingSuggestions.length > 0 && (
          <div style={{ marginBottom: "1.25rem" }}>
            <div className="suggestions-section-header">
              <Clock size={13} style={{ color: "var(--warning)" }} />
              <span>Pendientes</span>
              <span className="suggestions-count pending-count">{pendingSuggestions.length}</span>
            </div>
            <div className="suggestions-grid">
              {pendingSuggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  selected={selectedSuggestion === suggestion.id}
                  editing={editingSuggestion === suggestion.id}
                  customEdit={customEdit}
                  canManage={canManageSuggestions()}
                  onSelect={() => setSelectedSuggestion(suggestion.id)}
                  onAccept={() => handleAction(suggestion.id, "accepted")}
                  onReject={() => handleAction(suggestion.id, "rejected")}
                  onStartEdit={() => { setCustomEdit(suggestion.correctedText); setEditingSuggestion(suggestion.id); }}
                  onSaveEdit={() => saveEdit(suggestion.id)}
                  onCancelEdit={() => setEditingSuggestion(null)}
                  onCustomEditChange={setCustomEdit}
                />
              ))}
            </div>
          </div>
        )}

        {/* Resolved suggestions */}
        {resolvedSuggestions.length > 0 && (
          <div>
            <div className="suggestions-section-header" style={{ opacity: 0.7 }}>
              <CheckCircle2 size={13} style={{ color: "var(--success)" }} />
              <span>Resueltas</span>
              <span className="suggestions-count resolved-count">{resolvedSuggestions.length}</span>
            </div>
            <div className="suggestions-grid">
              {resolvedSuggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  selected={false}
                  editing={false}
                  customEdit=""
                  canManage={false}
                  onSelect={() => {}}
                  onAccept={() => {}}
                  onReject={() => {}}
                  onStartEdit={() => {}}
                  onSaveEdit={() => {}}
                  onCancelEdit={() => {}}
                  onCustomEditChange={() => {}}
                  resolved
                />
              ))}
            </div>
          </div>
        )}

        {suggestions.length === 0 && (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>
            <CheckCircle2 size={28} style={{ marginBottom: "0.5rem", opacity: 0.4 }} />
            <p>No hay correcciones para este segmento.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Extracted SuggestionCard component ----
type SuggestionCardProps = {
  suggestion: Suggestion;
  selected: boolean;
  editing: boolean;
  customEdit: string;
  canManage: boolean;
  onSelect: () => void;
  onAccept: () => void;
  onReject: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onCustomEditChange: (val: string) => void;
  resolved?: boolean;
};

function SuggestionCard({
  suggestion, selected, editing, customEdit, canManage,
  onSelect, onAccept, onReject, onStartEdit, onSaveEdit, onCancelEdit, onCustomEditChange,
  resolved,
}: SuggestionCardProps) {
  const statusLabel: Record<string, string> = {
    pending: "Pendiente", accepted: "Aceptado", rejected: "Rechazado", edited: "Editado",
  };
  return (
    <div
      className={`suggestion-card ${selected ? "active" : ""} ${resolved ? "resolved" : ""}`}
      onClick={onSelect}
    >
      <div className="suggestion-header">
        <span className={`risk-badge risk-${suggestion.riskLevel || "low"}`}>
          {suggestion.riskLevel === "low" ? "Bajo" : suggestion.riskLevel === "medium" ? "Medio" : "Alto"}
        </span>
        <span className={`status-badge status-${suggestion.status || "pending"}`} style={{ fontSize: "0.625rem" }}>
          {statusLabel[suggestion.status] ?? "Pendiente"}
        </span>
      </div>

      <div className="diff-view">
        <div className="diff-original"><del>{suggestion.originalText}</del></div>
        <div className="diff-arrow">→</div>
        <div className="diff-corrected">{suggestion.correctedText}</div>
      </div>

      <p className="suggestion-justification">{suggestion.justification}</p>

      {!resolved && suggestion.status === "pending" && (
        <div className="suggestion-actions">
          {!canManage ? (
            <div style={{ width: "100%", fontSize: "0.8125rem", color: "var(--text-muted)", fontStyle: "italic" }}>
              Pendiente de revisión.
            </div>
          ) : editing ? (
            <div style={{ width: "100%", marginTop: "0.25rem" }}>
              <input
                type="text"
                value={customEdit}
                onChange={e => onCustomEditChange(e.target.value)}
                className="input"
                autoFocus
                style={{ marginBottom: "0.5rem" }}
              />
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button className="btn" style={{ flex: 1, padding: "0.25rem" }} onClick={e => { e.stopPropagation(); onSaveEdit(); }}>Guardar</button>
                <button className="btn btn-secondary" style={{ flex: 1, padding: "0.25rem" }} onClick={e => { e.stopPropagation(); onCancelEdit(); }}>Cancelar</button>
              </div>
            </div>
          ) : (
            <>
              <button className="btn-action accept" onClick={e => { e.stopPropagation(); onAccept(); }}>✓ Aceptar</button>
              <button className="btn-action edit" onClick={e => { e.stopPropagation(); onStartEdit(); }}>✎ Editar</button>
              <button className="btn-action reject" onClick={e => { e.stopPropagation(); onReject(); }}>✕ Rechazar</button>
            </>
          )}
        </div>
      )}

      {resolved && (
        <div style={{ paddingTop: "0.5rem", borderTop: "1px dashed var(--border-color)", display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem" }}>
          {suggestion.status === "accepted" || suggestion.status === "edited"
            ? <><CheckCircle2 size={12} style={{ color: "var(--success)" }} /><span style={{ color: "var(--success)" }}>Aceptada</span></>
            : <><XCircle size={12} style={{ color: "var(--danger)" }} /><span style={{ color: "var(--danger)" }}>Rechazada</span></>}
        </div>
      )}
    </div>
  );
}
