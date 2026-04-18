"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  collection, query, orderBy, onSnapshot,
  doc, setDoc, addDoc, serverTimestamp, getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { updateBookStatus, notifyResponsables } from "@/lib/firestore";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { saveAs } from "file-saver";
import {
  ArrowLeft, Download, CheckCircle2, XCircle, Clock,
  Loader2, PanelLeftClose, PanelLeftOpen, BookOpen,
  ChevronDown, ChevronUp,
} from "lucide-react";
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

// Detect chapter headings (Capítulo N, CAPÍTULO, Chapter, Parte, etc.)
function detectChapter(text: string): string | null {
  const trimmed = text.trim().slice(0, 200);
  const patterns = [
    /^(cap[íi]tulo\s+\w+[\s\-–:]*[^\n]*)/im,
    /^(parte\s+\w+[\s\-–:]*[^\n]*)/im,
    /^(chapter\s+\w+[\s\-–:]*[^\n]*)/im,
    /^(prólogo|prolog|epílogo|epilog|introducción|introduction|conclusión|conclusion|anexo|apéndice)[^\n]*/im,
    /^([IVXivx]{1,6}\.\s+[^\n]{3,60}$)/m,
  ];
  for (const p of patterns) {
    const m = trimmed.match(p);
    if (m) return m[0].slice(0, 60).replace(/\s+/g, " ").trim();
  }
  return null;
}

export default function EditorPage() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("bookId");
  const { organizationId, user, role } = useAuth();
  const router = useRouter();

  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [resolvedOrgId, setResolvedOrgId] = useState<string | null>(null);
  const [bookStatus, setBookStatus] = useState<string>("processing");
  const [bookTitle, setBookTitle] = useState<string>("");
  const [processedCount, setProcessedCount] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [chunkLoadError, setChunkLoadError] = useState<string | null>(null);
  const [retryingFromEditor, setRetryingFromEditor] = useState(false);

  // UI state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [focusedChunkId, setFocusedChunkId] = useState<string | null>(null);
  const [editingMap, setEditingMap] = useState<Record<string, string>>({}); // chunkId → editing suggestionId
  const [customEditMap, setCustomEditMap] = useState<Record<string, string>>(); // chunkId+sugId → value

  // Chapter index
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [chapterIndexOpen, setChapterIndexOpen] = useState(false);

  const chunkRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ── Resolve orgId for SuperAdmin ─────────────────────────────────────
  useEffect(() => {
    if (!bookId) return;
    if (organizationId) { setResolvedOrgId(organizationId); return; }
    (async () => {
      try {
        const orgsSnap = await getDocs(collection(db, "organizations"));
        for (const orgDoc of orgsSnap.docs) {
          const { getDoc } = await import("firebase/firestore");
          const bookSnap = await getDoc(doc(db, "organizations", orgDoc.id, "books", bookId));
          if (bookSnap.exists()) { setResolvedOrgId(orgDoc.id); return; }
        }
        setChunkLoadError("No se encontró el libro en ninguna organización.");
      } catch (e) {
        setChunkLoadError("Error buscando el libro: " + (e instanceof Error ? e.message : String(e)));
      }
    })();
  }, [bookId, organizationId]);

  const effectiveOrgId = resolvedOrgId;

  // ── Real-time book listener ───────────────────────────────────────────
  useEffect(() => {
    if (!effectiveOrgId || !bookId) return;
    const unsub = onSnapshot(doc(db, "organizations", effectiveOrgId, "books", bookId), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setBookStatus(d.status ?? "processing");
        setBookTitle(d.title ?? "");
        setTotalChunks(d.totalChunks ?? 0);
        setProcessedCount(d.processedChunks ?? 0);
      }
    });
    return unsub;
  }, [effectiveOrgId, bookId]);

  // ── Real-time chunks listener — ALL chunks, progressive ──────────────
  useEffect(() => {
    if (!effectiveOrgId || !bookId) return;
    const q = query(
      collection(db, "organizations", effectiveOrgId, "books", bookId, "chunks"),
      orderBy("order", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() } as Chunk));
      setChunks(fetched);
      setChunkLoadError(null);
    }, (err) => {
      setChunkLoadError(`Error al cargar segmentos: ${err.message}`);
    });
    return unsub;
  }, [effectiveOrgId, bookId]);

  // ── Sidebar toggle (syncs with CSS class on body) ────────────────────
  useEffect(() => {
    const sidebar = document.querySelector(".sidebar") as HTMLElement | null;
    if (sidebar) {
      sidebar.style.width = sidebarCollapsed ? "0" : "";
      sidebar.style.overflow = sidebarCollapsed ? "hidden" : "";
      sidebar.style.padding = sidebarCollapsed ? "0" : "";
      sidebar.style.minWidth = sidebarCollapsed ? "0" : "";
    }
  }, [sidebarCollapsed]);

  // Chapter index derived from chunks
  const chapters = useMemo(() => {
    const result: { chunkId: string; label: string; order: number }[] = [];
    chunks.forEach(c => {
      const label = detectChapter(c.text);
      if (label) result.push({ chunkId: c.id, label, order: c.order });
    });
    return result;
  }, [chunks]);

  // Filtered chunks by chapter
  const visibleChunks = useMemo(() => {
    if (!selectedChapter) return chunks;
    const idx = chapters.findIndex(ch => ch.chunkId === selectedChapter);
    if (idx < 0) return chunks;
    const nextIdx = chapters[idx + 1];
    const startOrder = chapters[idx].order;
    const endOrder = nextIdx ? nextIdx.order : Infinity;
    return chunks.filter(c => c.order >= startOrder && c.order < endOrder);
  }, [chunks, selectedChapter, chapters]);

  // Global progress
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

  const canManage = useCallback(() => {
    if (!role) return false;
    if (["SuperAdmin", "Responsable_Editorial", "Editor"].includes(role)) return true;
    if (role === "Autor") return ["review_author", "review_responsable", "approved"].includes(bookStatus);
    return false;
  }, [role, bookStatus]);

  const scrollToChunk = (chunkId: string) => {
    chunkRefs.current[chunkId]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFocusedChunkId(chunkId);
  };

  // ── Save suggestion change to Firestore ──────────────────────────────
  const saveSuggestions = useCallback(async (chunk: Chunk, newSuggestions: Suggestion[]) => {
    if (!effectiveOrgId || !bookId) return;
    const updated = { ...chunk, suggestions: newSuggestions };
    setChunks(prev => prev.map(c => c.id === chunk.id ? updated : c));
    try {
      await setDoc(
        doc(db, "organizations", effectiveOrgId, "books", bookId, "chunks", chunk.id),
        { suggestions: newSuggestions },
        { merge: true }
      );
    } catch (e) { console.error("Error saving suggestions:", e); }

    // RAG learn + correction record for accepted suggestions
    if (user && effectiveOrgId) {
      const accepted = newSuggestions.filter(s => s.status === "accepted" || s.status === "edited");
      for (const s of accepted) {
        try {
          await addDoc(collection(db, "corrections"), {
            bookId, organizationId: effectiveOrgId,
            editorId: user.uid, editorEmail: user.email ?? null,
            editorName: user.displayName ?? user.email ?? null,
            status: s.status, sourceRule: s.sourceRule ?? null,
            originalText: s.originalText, correctedText: s.correctedText,
            createdAt: serverTimestamp(),
          });
        } catch { /* non-critical */ }
      }
    }
  }, [effectiveOrgId, bookId, user]);

  const handleAction = async (chunk: Chunk, suggId: string, action: "accepted" | "rejected") => {
    const newSugs = (chunk.suggestions ?? []).map(s => s.id === suggId ? { ...s, status: action } : s);
    await saveSuggestions(chunk, newSugs);
  };

  const handleSaveEdit = async (chunk: Chunk, suggId: string) => {
    const key = `${chunk.id}::${suggId}`;
    const newText = customEditMap?.[key] ?? "";
    if (!newText.trim()) return;
    const newSugs = (chunk.suggestions ?? []).map(s =>
      s.id === suggId ? { ...s, status: "edited" as const, correctedText: newText } : s
    );
    await saveSuggestions(chunk, newSugs);
    setEditingMap(prev => { const n = { ...prev }; delete n[chunk.id]; return n; });
  };

  // ── Retry ──────────────────────────────────────────────────────────
  const handleEditorRetry = async () => {
    if (!effectiveOrgId || !bookId || !user) return;
    setRetryingFromEditor(true);
    try {
      const token = await user.getIdToken();
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const res = await fetch(`${apiUrl}/api/v1/retry-book`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ organizationId: effectiveOrgId, bookId, authorId: user.uid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && data?.detail?.startsWith("no_chunks:")) {
        alert("El manuscrito no tiene segmentos. Vuelve a la lista y usa el botón ↺.");
      }
    } catch {
      alert("No se pudo conectar con el servidor de análisis.");
    } finally {
      setRetryingFromEditor(false);
    }
  };

  // ── Next phase ─────────────────────────────────────────────────────
  const handleNextPhase = async () => {
    if (!bookId || !effectiveOrgId) return;
    let nextStatus = "review_author";
    if (role === "Autor") nextStatus = "review_responsable";
    else if (role === "Responsable_Editorial" || role === "SuperAdmin") nextStatus = "approved";
    try {
      await updateBookStatus(effectiveOrgId, bookId, nextStatus);
      if ((role === "Editor" || role === "Autor") && effectiveOrgId) {
        await notifyResponsables(effectiveOrgId, {
          type: "correction_done",
          title: role === "Editor" ? "Corrección completada" : "Revisión de autor completada",
          message: role === "Editor"
            ? "El editor ha completado las correcciones del manuscrito."
            : "El autor ha revisado el manuscrito y está listo para aprobación final.",
          bookId: bookId ?? "",
          bookTitle,
          organizationId: effectiveOrgId,
          read: false,
        }).catch(() => {});
      }
      router.push("/dashboard/books");
    } catch (e) { console.error("Error avanzando fase", e); }
  };

  // ── Download ───────────────────────────────────────────────────────
  const handleDownload = async () => {
    const children = chunks.map(chunk => {
      let text = chunk.text || "";
      (chunk.suggestions ?? []).forEach((s: Suggestion) => {
        if (s.status !== "rejected") text = text.replace(s.originalText, s.correctedText);
      });
      return new Paragraph({ children: [new TextRun({ text, size: 24, font: "Times New Roman" })], spacing: { after: 200 } });
    });
    const blob = await Packer.toBlob(new Document({ sections: [{ properties: {}, children }] }));
    saveAs(blob, `${bookTitle || "Manuscrito"}_Corregido.docx`);
  };

  // ── Loading / error states ─────────────────────────────────────────
  if (!bookId) return <div style={{ padding: "2rem" }}>No se ha seleccionado ningún libro.</div>;

  const isProcessing = bookStatus === "processing";

  // ── RENDER ──────────────────────────────────────────────────────────
  return (
    <div className="editor-container fade-in" style={{ flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* ── HEADER ── */}
      <header className="editor-header" style={{ flexShrink: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0, flex: 1 }}>
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarCollapsed(v => !v)}
            className="btn-ghost"
            title={sidebarCollapsed ? "Mostrar barra lateral" : "Ocultar barra lateral"}
            style={{ padding: "0.35rem", display: "flex", alignItems: "center", color: "var(--text-muted)", flexShrink: 0 }}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>

          <button
            className="btn-ghost"
            style={{ padding: "0.25rem 0.5rem", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.25rem", color: "var(--text-muted)", flexShrink: 0 }}
            onClick={() => router.push("/dashboard/books")}
          >
            <ArrowLeft size={14} /> Biblioteca
          </button>

          <span style={{ color: "var(--border-color)" }}>/</span>

          {/* Analysis progress bar */}
          {totalChunks > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "0.75rem", flexShrink: 0 }}>
              <div style={{ width: "120px", height: "4px", backgroundColor: "var(--border-color)", borderRadius: "2px", overflow: "hidden" }} title="Análisis IA">
                <div style={{ height: "100%", width: `${Math.round((processedCount / totalChunks) * 100)}%`, backgroundColor: processedCount === totalChunks ? "var(--success)" : "#6366f1", transition: "width 0.4s ease", borderRadius: "2px" }} />
              </div>
              <span className="editor-stats" style={{ whiteSpace: "nowrap", color: processedCount === totalChunks ? "var(--success)" : "var(--text-muted)" }}>
                Análisis {Math.round((processedCount / totalChunks) * 100)}%
              </span>
            </div>
          )}
          {/* Correction review progress bar */}
          {globalProgress.total > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
              <div style={{ width: "120px", height: "4px", backgroundColor: "var(--border-color)", borderRadius: "2px", overflow: "hidden" }} title="Correcciones revisadas">
                <div style={{ height: "100%", width: `${globalProgress.pct}%`, backgroundColor: globalProgress.pct === 100 ? "var(--success)" : "#f59e0b", transition: "width 0.4s ease", borderRadius: "2px" }} />
              </div>
              <span className="editor-stats" style={{ whiteSpace: "nowrap", color: globalProgress.pct === 100 ? "var(--success)" : "var(--text-muted)" }}>
                Revisión {globalProgress.pct}%
              </span>
            </div>
          )}

          <h1 className="editor-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "320px" }}>
            {bookTitle || "Manuscrito"}
          </h1>
        </div>

        <div className="editor-actions" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
          {isProcessing && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0, fontSize: "0.8rem", color: "var(--primary)" }}>
              <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
              <span>Analizando… {totalChunks > 0 ? Math.round((processedCount / totalChunks) * 100) : 0}%</span>
            </div>
          )}
          {canManage() && (
            <button className="btn" style={{ whiteSpace: "nowrap" }} onClick={handleNextPhase}>
              Cerrar Fase ✓
            </button>
          )}
          <button
            className="btn"
            style={{ backgroundColor: "var(--success)", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "0.375rem" }}
            onClick={handleDownload}
            disabled={chunks.length === 0}
          >
            <Download size={14} /> .docx
          </button>
        </div>
      </header>

      {/* ── ANALYSIS BANNER ── */}
      {isProcessing && (
        <div style={{
          backgroundColor: "rgba(99,102,241,0.08)", borderBottom: "1px solid rgba(99,102,241,0.2)",
          padding: "0.4rem 1.5rem", display: "flex", alignItems: "center", gap: "0.75rem",
          fontSize: "0.8rem", color: "var(--text-muted)", flexShrink: 0,
        }}>
          <div className="pulse-dot" style={{ flexShrink: 0 }} />
          <span>Análisis IA en curso — <strong>{totalChunks > 0 ? Math.round((processedCount / totalChunks) * 100) : 0}% completado</strong>. El texto aparece a medida que se analiza.</span>
          <span style={{ marginLeft: "auto", color: "#6366f1", fontWeight: 600 }}>Puedes empezar a revisar</span>
        </div>
      )}

      {chunkLoadError && (
        <div style={{ padding: "1rem 1.5rem", backgroundColor: "rgba(239,68,68,0.08)", borderBottom: "1px solid rgba(239,68,68,0.2)", color: "#ef4444", fontSize: "0.8rem" }}>
          ⚠️ {chunkLoadError}
        </div>
      )}

      {/* ── BODY: document scroll + chapter index ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── SCROLLABLE DOCUMENT ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* Empty state while waiting for first chunk */}
          {chunks.length === 0 && (
            <div style={{ textAlign: "center", padding: "4rem 2rem", color: "var(--text-muted)" }}>
              {isProcessing ? (
                <>
                  <div className="processing-spinner" style={{ marginBottom: "1.25rem" }}><div className="spinner-ring" /></div>
                  <p>El análisis está en curso, los segmentos aparecerán aquí automáticamente…</p>
                  <button className="btn btn-secondary" style={{ marginTop: "1.5rem" }} onClick={handleEditorRetry} disabled={retryingFromEditor}>
                    {retryingFromEditor ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : "↺"} Reintentar si está bloqueado
                  </button>
                </>
              ) : (
                <p>Este manuscrito no tiene segmentos disponibles.</p>
              )}
            </div>
          )}

          {/* All chunks rendered as scrollable sections */}
          {visibleChunks.map((chunk) => {
            const chapterLabel = detectChapter(chunk.text);
            const isPending = chunk.status === "pending";
            const suggestions = (chunk.suggestions ?? []) as Suggestion[];
            const pendingSugs = suggestions.filter(s => s.status === "pending");
            const resolvedSugs = suggestions.filter(s => s.status !== "pending");
            const isFocused = focusedChunkId === chunk.id;

            let correctedText = chunk.text || "";
            suggestions.forEach(s => {
              if (s.status !== "rejected") correctedText = correctedText.replace(s.originalText, s.correctedText);
            });

            return (
              <div
                key={chunk.id}
                ref={el => { chunkRefs.current[chunk.id] = el; }}
                onClick={() => setFocusedChunkId(chunk.id)}
                style={{
                  borderRadius: "var(--radius-lg)",
                  border: isFocused ? "2px solid var(--primary)" : "1px solid var(--border-color)",
                  overflow: "hidden",
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                  boxShadow: isFocused ? "0 0 0 3px rgba(99,102,241,0.1)" : undefined,
                }}
              >
                {/* Chapter heading */}
                {chapterLabel && (
                  <div style={{
                    padding: "0.5rem 1rem",
                    backgroundColor: "rgba(99,102,241,0.06)",
                    borderBottom: "1px solid var(--border-color)",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    color: "var(--primary)",
                    letterSpacing: "0.04em",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                  }}>
                    <BookOpen size={12} /> {chapterLabel}
                  </div>
                )}

                {/* Chunk header */}
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "0.4rem 1rem", backgroundColor: "var(--card-bg)",
                  borderBottom: "1px solid var(--border-color)", fontSize: "0.7rem", color: "var(--text-muted)",
                }}>
                  <span>Segmento {chunk.order + 1}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    {isPending ? (
                      <><Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Analizando…</>
                    ) : suggestions.length === 0 ? (
                      <><CheckCircle2 size={11} style={{ color: "var(--success)" }} /> Sin correcciones</>
                    ) : (
                      <>
                        {pendingSugs.length > 0 && <span style={{ color: "#f59e0b", fontWeight: 700 }}>{pendingSugs.length} pendientes</span>}
                        {resolvedSugs.length > 0 && <span style={{ color: "var(--success)" }}>{resolvedSugs.length} resueltas</span>}
                      </>
                    )}
                  </span>
                </div>

                {/* Text panes */}
                {!isPending ? (
                  <div className="pane-wrapper" style={{ minHeight: "unset" }}>
                    <div className="text-pane">
                      <div className="pane-header">Texto Original</div>
                      <div className="pane-content original-text" style={{ maxHeight: "220px", overflowY: "auto" }}>{chunk.text}</div>
                    </div>
                    <div className="text-pane">
                      <div className="pane-header" style={{ color: "var(--primary)" }}>Texto Corregido — Preview</div>
                      <div className="pane-content corrected-text" style={{ maxHeight: "220px", overflowY: "auto" }}>{correctedText}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: "1rem 1.5rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    {chunk.text?.slice(0, 200)}…
                  </div>
                )}

                {/* Suggestions for this chunk */}
                {!isPending && suggestions.length > 0 && (
                  <div className="suggestions-panel" style={{ borderTop: "1px solid var(--border-color)", maxHeight: "320px", overflowY: "auto" }}>
                    {/* Pending */}
                    {pendingSugs.length > 0 && (
                      <>
                        <div className="suggestions-section-header">
                          <Clock size={12} style={{ color: "var(--warning)" }} />
                          <span>Pendientes</span>
                          <span className="suggestions-count pending-count">{pendingSugs.length}</span>
                        </div>
                        <div className="suggestions-grid">
                          {pendingSugs.map(s => {
                            const editKey = `${chunk.id}::${s.id}`;
                            const isEditing = editingMap[chunk.id] === s.id;
                            return (
                              <div key={s.id} className="suggestion-card active" onClick={e => e.stopPropagation()}>
                                <div className="suggestion-header">
                                  <span className={`risk-badge risk-${s.riskLevel || "low"}`}>
                                    {s.riskLevel === "low" ? "Bajo" : s.riskLevel === "medium" ? "Medio" : "Alto"}
                                  </span>
                                </div>
                                <div className="diff-view">
                                  <div className="diff-original"><del>{s.originalText}</del></div>
                                  <div className="diff-arrow">→</div>
                                  <div className="diff-corrected">{s.correctedText}</div>
                                </div>
                                <p className="suggestion-justification">{s.justification}</p>
                                {canManage() && (
                                  <div className="suggestion-actions">
                                    {isEditing ? (
                                      <div style={{ width: "100%" }}>
                                        <input
                                          type="text"
                                          className="input"
                                          value={customEditMap?.[editKey] ?? s.correctedText}
                                          onChange={e => setCustomEditMap(prev => ({ ...prev, [editKey]: e.target.value }))}
                                          autoFocus
                                          style={{ marginBottom: "0.4rem" }}
                                          onClick={ev => ev.stopPropagation()}
                                        />
                                        <div style={{ display: "flex", gap: "0.4rem" }}>
                                          <button className="btn" style={{ flex: 1, padding: "0.25rem" }} onClick={e => { e.stopPropagation(); handleSaveEdit(chunk, s.id); }}>Guardar</button>
                                          <button className="btn btn-secondary" style={{ flex: 1, padding: "0.25rem" }} onClick={e => { e.stopPropagation(); setEditingMap(prev => { const n = { ...prev }; delete n[chunk.id]; return n; }); }}>Cancelar</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        <button className="btn-action accept" onClick={e => { e.stopPropagation(); handleAction(chunk, s.id, "accepted"); }}>✓ Aceptar</button>
                                        <button className="btn-action edit" onClick={e => { e.stopPropagation(); setEditingMap(prev => ({ ...prev, [chunk.id]: s.id })); setCustomEditMap(prev => ({ ...prev, [editKey]: s.correctedText })); }}>✎ Editar</button>
                                        <button className="btn-action reject" onClick={e => { e.stopPropagation(); handleAction(chunk, s.id, "rejected"); }}>✕ Rechazar</button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {/* Resolved */}
                    {resolvedSugs.length > 0 && (
                      <>
                        <div className="suggestions-section-header" style={{ opacity: 0.7 }}>
                          <CheckCircle2 size={12} style={{ color: "var(--success)" }} />
                          <span>Resueltas</span>
                          <span className="suggestions-count resolved-count">{resolvedSugs.length}</span>
                        </div>
                        <div className="suggestions-grid">
                          {resolvedSugs.map(s => (
                            <div key={s.id} className="suggestion-card resolved">
                              <div className="diff-view">
                                <div className="diff-original"><del>{s.originalText}</del></div>
                                <div className="diff-arrow">→</div>
                                <div className="diff-corrected">{s.correctedText}</div>
                              </div>
                              <div style={{ paddingTop: "0.5rem", borderTop: "1px dashed var(--border-color)", display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.7rem" }}>
                                {s.status === "accepted" || s.status === "edited"
                                  ? <><CheckCircle2 size={11} style={{ color: "var(--success)" }} /><span style={{ color: "var(--success)" }}>Aceptada</span></>
                                  : <><XCircle size={11} style={{ color: "var(--danger)" }} /><span style={{ color: "var(--danger)" }}>Rechazada</span></>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Trailing space */}
          <div style={{ height: "4rem" }} />
        </div>

        {/* ── CHAPTER INDEX (right panel) ── */}
        {chapters.length > 0 && (
          <div style={{
            width: "220px",
            flexShrink: 0,
            borderLeft: "1px solid var(--border-color)",
            overflowY: "auto",
            backgroundColor: "var(--card-bg)",
            display: "flex",
            flexDirection: "column",
          }}>
            <div
              style={{
                padding: "0.75rem 1rem",
                borderBottom: "1px solid var(--border-color)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: "0.75rem",
                color: "var(--text-muted)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
              onClick={() => setChapterIndexOpen(v => !v)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <BookOpen size={13} /> Índice
              </div>
              {chapterIndexOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </div>

            {chapterIndexOpen && (
              <nav style={{ padding: "0.5rem 0", flex: 1 }}>
                <button
                  onClick={() => { setSelectedChapter(null); }}
                  style={{
                    width: "100%", textAlign: "left", padding: "0.4rem 1rem",
                    fontSize: "0.78rem", background: "none", border: "none", cursor: "pointer",
                    color: selectedChapter === null ? "var(--primary)" : "var(--text-muted)",
                    fontWeight: selectedChapter === null ? 700 : 400,
                    borderLeft: selectedChapter === null ? "3px solid var(--primary)" : "3px solid transparent",
                  }}
                >
                  Todo el manuscrito
                </button>
                {chapters.map(ch => (
                  <button
                    key={ch.chunkId}
                    onClick={() => { setSelectedChapter(ch.chunkId); scrollToChunk(ch.chunkId); }}
                    style={{
                      width: "100%", textAlign: "left", padding: "0.4rem 1rem",
                      fontSize: "0.78rem", background: "none", border: "none", cursor: "pointer",
                      color: selectedChapter === ch.chunkId ? "var(--primary)" : "var(--text-main)",
                      fontWeight: selectedChapter === ch.chunkId ? 700 : 400,
                      borderLeft: selectedChapter === ch.chunkId ? "3px solid var(--primary)" : "3px solid transparent",
                      lineHeight: 1.3,
                    }}
                  >
                    {ch.label}
                  </button>
                ))}
              </nav>
            )}

            {!chapterIndexOpen && (
              <div style={{ padding: "0.5rem 0.75rem", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                {chapters.length} capítulos detectados
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
