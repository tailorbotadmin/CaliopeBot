"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  collection, query, orderBy, onSnapshot,
  doc, setDoc, addDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { updateBookStatus, notifyResponsables } from "@/lib/firestore";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { saveAs } from "file-saver";
import {
  ArrowLeft, Download, Loader2,
  PanelRightClose, PanelRightOpen, CheckCircle2, XCircle,
} from "lucide-react";
import "./editor.css";

// ── Types ─────────────────────────────────────────────────────────────────────
type CorrectionStatus = "pending" | "accepted" | "rejected" | "edited";

type Suggestion = {
  id: string;
  originalText: string;
  correctedText: string;
  justification: string;
  status: CorrectionStatus;
  riskLevel: "low" | "medium" | "high";
  category?: string;
  sourceRule?: string;
  reglaAplicada?: string;
  editorJustification?: string; // justification added by human editor when editing
};

type Chunk = {
  id: string;
  text: string;
  order: number;
  status: string;
  suggestions?: Suggestion[];
};

// ── Colour helpers ─────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<CorrectionStatus, { bg: string; border: string; text: string }> = {
  pending:  { bg: "rgba(239,68,68,0.13)",   border: "#ef4444", text: "#dc2626" },
  rejected: { bg: "rgba(239,68,68,0.08)",   border: "#f87171", text: "#ef4444" },
  accepted: { bg: "rgba(16,185,129,0.12)",  border: "#10b981", text: "#059669" },
  edited:   { bg: "rgba(249,115,22,0.13)",  border: "#f97316", text: "#ea580c" },
};

const CATEGORIES = ["Todos", "Tildes", "Gramática", "Puntuación", "Extranjerismos", "Ortografía", "Léxico", "Tipografía"];

// ── AnnotatedText ─────────────────────────────────────────────────────────────
// Renders a chunk's text with inline highlighted correction spans.
type Segment = { text: string; type: "plain" } | { text: string; type: "correction"; sugg: Suggestion; globalIdx: number };

function buildSegments(text: string, suggestions: Suggestion[], globalOffset: number): Segment[] {
  let segments: Segment[] = [{ text, type: "plain" }];
  suggestions.forEach((sugg, localIdx) => {
    const globalIdx = globalOffset + localIdx;
    const next: Segment[] = [];
    for (const seg of segments) {
      if (seg.type !== "plain") { next.push(seg); continue; }
      const pos = seg.text.indexOf(sugg.originalText);
      if (pos === -1) { next.push(seg); continue; }
      if (pos > 0) next.push({ text: seg.text.slice(0, pos), type: "plain" });
      next.push({ text: sugg.originalText, type: "correction", sugg, globalIdx });
      const after = seg.text.slice(pos + sugg.originalText.length);
      if (after) next.push({ text: after, type: "plain" });
    }
    segments = next;
  });
  return segments;
}

function AnnotatedText({
  chunk, suggestions, globalOffset, selectedId, onSelect, showAnnotations,
}: {
  chunk: Chunk; suggestions: Suggestion[]; globalOffset: number;
  selectedId: string | null; onSelect: (id: string) => void; showAnnotations: boolean;
}) {
  const segments = useMemo(
    () => buildSegments(chunk.text || "", suggestions, globalOffset),
    [chunk.text, suggestions, globalOffset]
  );

  if (!showAnnotations || suggestions.length === 0) {
    return <span>{chunk.text}</span>;
  }

  return (
    <span>
      {segments.map((seg, i) => {
        if (seg.type === "plain") return <span key={i}>{seg.text}</span>;
        const col = STATUS_COLOR[seg.sugg.status];
        const isSelected = selectedId === seg.sugg.id;
        return (
          <mark
            key={i}
            id={`mark-${seg.sugg.id}`}
            onClick={() => onSelect(seg.sugg.id)}
            title={`#${seg.globalIdx + 1} ${seg.sugg.category ?? ""}: ${seg.sugg.correctedText}`}
            style={{
              backgroundColor: isSelected ? col.border + "33" : col.bg,
              borderBottom: `2px solid ${col.border}`,
              borderRadius: "2px",
              cursor: "pointer",
              padding: "0 1px",
              transition: "background 0.15s",
              position: "relative",
            }}
          >
            {seg.text}
            <sup style={{
              fontSize: "0.6rem", fontWeight: 800,
              backgroundColor: col.border, color: "#fff",
              borderRadius: "99px", padding: "0 3px",
              marginLeft: "1px", verticalAlign: "super",
              lineHeight: 1.2,
            }}>
              {seg.globalIdx + 1}
            </sup>
          </mark>
        );
      })}
    </span>
  );
}

// ── Main Editor Page ──────────────────────────────────────────────────────────
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
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [retryingFromEditor, setRetryingFromEditor] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editJustification, setEditJustification] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Todos");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true);

  const docPaneRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Resolve org for SuperAdmin ───────────────────────────────────────
  useEffect(() => {
    if (!bookId) return;
    if (organizationId) { setResolvedOrgId(organizationId); return; }
    (async () => {
      try {
        const { getDocs, collection: col, doc: docRef, getDoc } = await import("firebase/firestore");
        const orgsSnap = await getDocs(col(db, "organizations"));
        for (const orgDoc of orgsSnap.docs) {
          const snap = await getDoc(docRef(db, "organizations", orgDoc.id, "books", bookId));
          if (snap.exists()) { setResolvedOrgId(orgDoc.id); return; }
        }
        setChunkLoadError("No se encontró el libro en ninguna organización.");
      } catch (e) {
        setChunkLoadError("Error buscando el libro: " + (e instanceof Error ? e.message : String(e)));
      }
    })();
  }, [bookId, organizationId]);

  const effectiveOrgId = resolvedOrgId;

  // ── Book listener ────────────────────────────────────────────────────
  useEffect(() => {
    if (!effectiveOrgId || !bookId) return;
    return onSnapshot(doc(db, "organizations", effectiveOrgId, "books", bookId), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setBookStatus(d.status ?? "processing");
        setBookTitle(d.title ?? "");
        setTotalChunks(d.totalChunks ?? 0);
        setProcessedCount(d.processedChunks ?? 0);
      }
    });
  }, [effectiveOrgId, bookId]);

  // ── Chunks listener ──────────────────────────────────────────────────
  useEffect(() => {
    if (!effectiveOrgId || !bookId) return;
    const q = query(
      collection(db, "organizations", effectiveOrgId, "books", bookId, "chunks"),
      orderBy("order", "asc")
    );
    return onSnapshot(q, (snap) => {
      setChunks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Chunk)));
      setChunkLoadError(null);
    }, (err) => {
      setChunkLoadError(`Error al cargar: ${err.message}`);
    });
  }, [effectiveOrgId, bookId]);

  // ── Timeout ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (chunks.length > 0) { setLoadingTimedOut(false); return; }
    if (bookStatus !== "processing") return;
    const t = setTimeout(() => setLoadingTimedOut(true), 30_000);
    return () => clearTimeout(t);
  }, [chunks.length, bookStatus]);

  // ── All suggestions flat list ────────────────────────────────────────
  const allSuggestions = useMemo(() => {
    const list: (Suggestion & { chunkId: string; chunkOrder: number })[] = [];
    chunks.forEach(chunk => {
      (chunk.suggestions ?? []).forEach(s => {
        list.push({ ...s, chunkId: chunk.id, chunkOrder: chunk.order });
      });
    });
    return list;
  }, [chunks]);

  const filteredSuggestions = useMemo(() =>
    categoryFilter === "Todos"
      ? allSuggestions
      : allSuggestions.filter(s => s.category === categoryFilter),
    [allSuggestions, categoryFilter]
  );

  // Global progress
  const analysisPct = totalChunks > 0 ? Math.round((processedCount / totalChunks) * 100) : 0;
  const reviewPct = allSuggestions.length > 0
    ? Math.round((allSuggestions.filter(s => s.status !== "pending").length / allSuggestions.length) * 100)
    : 0;

  // ── Build per-chunk global offset map ────────────────────────────────
  const chunkGlobalOffset = useMemo(() => {
    const map: Record<string, number> = {};
    let offset = 0;
    chunks.forEach(chunk => {
      map[chunk.id] = offset;
      offset += (chunk.suggestions ?? []).length;
    });
    return map;
  }, [chunks]);

  // ── Scroll to correction in doc ──────────────────────────────────────
  const scrollToCorrection = useCallback((id: string) => {
    const el = document.getElementById(`mark-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const handleSelectCorrection = useCallback((id: string) => {
    setSelectedId(id);
    scrollToCorrection(id);
    setEditingId(null);
  }, [scrollToCorrection]);

  // ── Save suggestion change to Firestore ─────────────────────────────
  const saveSuggestion = async (chunkId: string, newSuggestions: Suggestion[]) => {
    if (!effectiveOrgId || !bookId) return;
    const chunk = chunks.find(c => c.id === chunkId);
    if (!chunk) return;

    // Optimistic update: apply locally immediately so reviewPct updates instantly
    setChunks(prev => prev.map(c =>
      c.id === chunkId ? { ...c, suggestions: newSuggestions } : c
    ));

    try {
      await setDoc(
        doc(db, "organizations", effectiveOrgId, "books", bookId, "chunks", chunkId),
        { ...chunk, suggestions: newSuggestions },
        { merge: true }
      );
    } catch (e) {
      console.error("Error saving:", e);
      // Rollback optimistic update on failure
      setChunks(prev => prev.map(c =>
        c.id === chunkId ? { ...c, suggestions: chunk.suggestions } : c
      ));
    }
  };

  const updateSuggestionInChunk = async (
    suggId: string,
    patch: Partial<Suggestion>
  ) => {
    const sug = allSuggestions.find(s => s.id === suggId);
    if (!sug) return;
    const chunk = chunks.find(c => c.id === sug.chunkId);
    if (!chunk) return;
    const newSuggestions = (chunk.suggestions ?? []).map(s =>
      s.id === suggId ? { ...s, ...patch } : s
    );
    await saveSuggestion(sug.chunkId, newSuggestions);

    // Write correction record
    if (organizationId && user && patch.status) {
      try {
        await addDoc(collection(db, "corrections"), {
          bookId, organizationId,
          editorId: user.uid, editorEmail: user.email ?? null,
          editorName: user.displayName ?? user.email ?? null,
          status: patch.status, sourceRule: sug.reglaAplicada ?? null,
          originalText: sug.originalText, correctedText: patch.correctedText ?? sug.correctedText,
          createdAt: serverTimestamp(),
        });
      } catch { /* non-critical */ }
    }
  };

  const handleAccept = async (id: string) => {
    await updateSuggestionInChunk(id, { status: "accepted" });
    setSelectedId(null);
  };

  const handleReject = async (id: string) => {
    await updateSuggestionInChunk(id, { status: "rejected" });
    setSelectedId(null);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editText.trim()) return;
    await updateSuggestionInChunk(id, {
      status: "edited",
      correctedText: editText,
      editorJustification: editJustification.trim() || undefined,
    });
    setEditingId(null);
    setSelectedId(null);
  };

  // ── Next phase ──────────────────────────────────────────────────────
  const handleNextPhase = async () => {
    if (!bookId || !effectiveOrgId) return;
    let nextStatus = "review_author";
    if (role === "Autor") nextStatus = "review_responsable";
    else if (role === "Responsable_Editorial" || role === "SuperAdmin") nextStatus = "approved";
    try {
      await updateBookStatus(effectiveOrgId, bookId, nextStatus);
      await notifyResponsables(effectiveOrgId, {
        type: "correction_done",
        title: "Corrección completada",
        message: "El editor ha completado las correcciones del manuscrito.",
        bookId: bookId ?? "", bookTitle, organizationId: effectiveOrgId, read: false,
      }).catch(() => {});
      router.push("/dashboard/books");
    } catch (e) { console.error(e); }
  };

  // ── Download ─────────────────────────────────────────────────────────
  const handleDownload = async () => {
    const docChildren = chunks.map(chunk => {
      let text = chunk.text || "";
      (chunk.suggestions ?? []).forEach(s => {
        if (s.status !== "rejected") text = text.replace(s.originalText, s.correctedText);
      });
      return new Paragraph({ children: [new TextRun(text)], spacing: { after: 200 } });
    });
    const blob = await Packer.toBlob(new Document({ sections: [{ properties: {}, children: docChildren }] }));
    saveAs(blob, `${bookTitle || "Manuscrito"}_Corregido.docx`);
  };

  // ── Retry ─────────────────────────────────────────────────────────────
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
      const data = await res.json();
      if (res.ok) setLoadingTimedOut(false);
      else alert(`Error: ${data?.detail ?? res.statusText}`);
    } catch { alert("No se pudo conectar con el servidor."); }
    finally { setRetryingFromEditor(false); }
  };

  const canManage = () => {
    if (!role) return false;
    if (["SuperAdmin", "Responsable_Editorial", "Editor"].includes(role)) return true;
    if (role === "Autor") return ["review_author", "review_responsable", "approved"].includes(bookStatus);
    return false;
  };

  // ── Selected correction detail ────────────────────────────────────────
  const selectedSugg = selectedId ? allSuggestions.find(s => s.id === selectedId) ?? null : null;

  if (!bookId) return <div style={{ padding: "2rem" }}>No se ha seleccionado ningún libro.</div>;

  const isAnalyzing = bookStatus === "processing";

  // ── Empty / loading state ─────────────────────────────────────────────
  if (chunks.length === 0) {
    const isBlocked = loadingTimedOut || chunkLoadError;
    return (
      <div className="editor-container" style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: "4rem 2rem", color: "var(--text-muted)", maxWidth: "480px" }}>
          {chunkLoadError ? (
            <>
              <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⚠️</div>
              <p style={{ color: "#ef4444", fontWeight: 600, marginBottom: "0.5rem" }}>Error de permisos o conexión</p>
              <p style={{ fontSize: "0.8rem", marginBottom: "1.5rem" }}>{chunkLoadError}</p>
            </>
          ) : isAnalyzing && !isBlocked ? (
            <>
              <div className="processing-spinner" style={{ marginBottom: "1.5rem" }}><div className="spinner-ring" /></div>
              <p style={{ marginBottom: "0.5rem" }}>Preparando el manuscrito…</p>
              {totalChunks > 0 && <p style={{ color: "var(--primary)", fontWeight: 600 }}>Análisis {analysisPct}% completado</p>}
            </>
          ) : isAnalyzing && isBlocked ? (
            <>
              <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🔄</div>
              <p style={{ fontWeight: 700, color: "var(--text-main)", marginBottom: "0.5rem" }}>El análisis parece bloqueado</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
                <button className="btn" onClick={handleEditorRetry} disabled={retryingFromEditor}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
                  {retryingFromEditor ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : "↺"}
                  Reintentar análisis
                </button>
                <button className="btn btn-secondary" onClick={() => router.push("/dashboard/books")}>Volver</button>
              </div>
            </>
          ) : <p>Este manuscrito no tiene texto disponible.</p>}
          {!isBlocked && !chunkLoadError && (
            <button className="btn btn-secondary" style={{ marginTop: "1.5rem" }} onClick={() => router.push("/dashboard/books")}>Volver</button>
          )}
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="editor-container fade-in" style={{ flexDirection: "row", height: "100vh", overflow: "hidden" }}>

      {/* ════ LEFT: Document pane ════ */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        borderRight: "1px solid var(--border-color)", minWidth: 0, overflow: "hidden",
      }}>

        {/* Header */}
        <header className="editor-header">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
              <button className="btn-ghost" onClick={() => router.push("/dashboard/books")}
                style={{ padding: "0.25rem 0.5rem", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.25rem", color: "var(--text-muted)" }}>
                <ArrowLeft size={14} /> Biblioteca
              </button>
              <span style={{ color: "var(--border-color)" }}>/</span>
              <h1 className="editor-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {bookTitle || "Manuscrito"}
              </h1>
            </div>
            {/* Progress bars */}
            <div style={{ display: "flex", gap: "1.25rem", alignItems: "center" }}>
              {totalChunks > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <div style={{ width: "100px", height: "3px", backgroundColor: "var(--border-color)", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${analysisPct}%`, backgroundColor: analysisPct === 100 ? "var(--success)" : "var(--primary)", transition: "width 0.5s ease" }} />
                  </div>
                  <span className="editor-stats" style={{ color: analysisPct === 100 ? "var(--success)" : undefined }}>Análisis {analysisPct}%</span>
                </div>
              )}
              {allSuggestions.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <div style={{ width: "100px", height: "3px", backgroundColor: "var(--border-color)", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${reviewPct}%`, backgroundColor: reviewPct === 100 ? "var(--success)" : "#f59e0b", transition: "width 0.4s ease" }} />
                  </div>
                  <span className="editor-stats" style={{ color: reviewPct === 100 ? "var(--success)" : undefined }}>Revisión {reviewPct}%</span>
                </div>
              )}
              {isAnalyzing && <span style={{ fontSize: "0.75rem", color: "var(--primary)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> Analizando
              </span>}
            </div>
          </div>

          <div className="editor-actions">
            {/* Annotation toggle */}
            <button
              className="btn btn-secondary"
              onClick={() => setShowAnnotations(v => !v)}
              style={{ fontSize: "0.75rem", padding: "0.35rem 0.65rem" }}
            >
              {showAnnotations ? "Ocultar marcas" : "Mostrar marcas"}
            </button>
            {canManage() && (
              <button className="btn" style={{ whiteSpace: "nowrap" }} onClick={handleNextPhase}>
                Cerrar Fase ✓
              </button>
            )}
            <button className="btn" onClick={handleDownload}
              style={{ backgroundColor: "var(--success)", display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <Download size={14} /> .docx
            </button>
            {/* Panel toggle */}
            <button className="btn-ghost" onClick={() => setPanelCollapsed(v => !v)}
              style={{ padding: "0.35rem", display: "flex", alignItems: "center" }}
              title={panelCollapsed ? "Mostrar panel correcciones" : "Ocultar panel correcciones"}>
              {panelCollapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
            </button>
          </div>
        </header>

        {/* Analysis banner */}
        {isAnalyzing && (
          <div style={{
            backgroundColor: "rgba(99,102,241,0.08)", borderBottom: "1px solid rgba(99,102,241,0.2)",
            padding: "0.35rem 1.5rem", display: "flex", alignItems: "center", gap: "0.75rem",
            fontSize: "0.78rem", color: "var(--text-muted)", flexShrink: 0,
          }}>
            <div className="pulse-dot" />
            <span>Análisis en curso — <strong>{analysisPct}% completado</strong>. Las correcciones aparecen a medida que se detectan.</span>
          </div>
        )}

        {/* ── Document continuous view ── */}
        <div
          ref={docPaneRef}
          style={{
            flex: 1, overflowY: "auto", padding: "2.5rem 3rem",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: "1.0625rem", lineHeight: 1.9,
            color: "var(--text-main)", backgroundColor: "var(--bg-color)",
          }}
        >
          {chunks.map(chunk => {
            const chunkSuggs = (chunk.suggestions ?? []) as Suggestion[];
            const offset = chunkGlobalOffset[chunk.id] ?? 0;
            return (
              <p key={chunk.id} style={{ marginBottom: "1.5rem" }}>
                <AnnotatedText
                  chunk={chunk}
                  suggestions={chunkSuggs}
                  globalOffset={offset}
                  selectedId={selectedId}
                  onSelect={handleSelectCorrection}
                  showAnnotations={showAnnotations}
                />
              </p>
            );
          })}
        </div>
      </div>

      {/* ════ RIGHT: Corrections panel ════ */}
      {!panelCollapsed && (
        <div
          ref={panelRef}
          style={{
            width: "380px", flexShrink: 0, display: "flex", flexDirection: "column",
            backgroundColor: "var(--bg-surface)", borderLeft: "1px solid var(--border-color)",
            overflow: "hidden",
          }}
        >
          {/* Panel header + filters */}
          <div style={{ padding: "1rem 1.25rem 0.75rem", borderBottom: "1px solid var(--border-color)", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <span style={{ fontWeight: 700, fontSize: "0.875rem" }}>
                Correcciones
                <span style={{ marginLeft: "0.5rem", padding: "0.1rem 0.5rem", borderRadius: "99px", backgroundColor: "rgba(99,102,241,0.1)", color: "var(--primary)", fontSize: "0.7rem", fontWeight: 800 }}>
                  {allSuggestions.length}
                </span>
              </span>
              <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.7rem", fontWeight: 600 }}>
                <span style={{ color: STATUS_COLOR.accepted.text }}>{allSuggestions.filter(s => s.status === "accepted").length} ✓</span>
                <span style={{ color: STATUS_COLOR.edited.text }}>{allSuggestions.filter(s => s.status === "edited").length} ✎</span>
                <span style={{ color: STATUS_COLOR.rejected.text }}>{allSuggestions.filter(s => s.status === "rejected").length} ✕</span>
              </div>
            </div>
            {/* Category filters */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
              {CATEGORIES.map(cat => {
                const count = cat === "Todos"
                  ? allSuggestions.length
                  : allSuggestions.filter(s => s.category === cat).length;
                if (cat !== "Todos" && count === 0) return null;
                const isActive = categoryFilter === cat;
                return (
                  <button key={cat} onClick={() => setCategoryFilter(cat)}
                    style={{
                      padding: "0.2rem 0.6rem", borderRadius: "99px", border: "1px solid",
                      borderColor: isActive ? "var(--primary)" : "var(--border-color)",
                      backgroundColor: isActive ? "var(--primary)" : "transparent",
                      color: isActive ? "#fff" : "var(--text-muted)",
                      fontSize: "0.7rem", fontWeight: 600, cursor: "pointer",
                      transition: "all 0.15s",
                    }}>
                    {cat}{count > 0 && cat !== "Todos" ? ` (${count})` : ""}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Corrections list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem 0" }}>
            {filteredSuggestions.length === 0 && (
              <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                {isAnalyzing ? (
                  <>
                    <Loader2 size={24} style={{ marginBottom: "0.5rem", animation: "spin 1s linear infinite", color: "var(--primary)" }} />
                    <p>Analizando el documento…</p>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={24} style={{ marginBottom: "0.5rem", opacity: 0.4 }} />
                    <p>No hay correcciones{categoryFilter !== "Todos" ? ` de tipo "${categoryFilter}"` : ""}.</p>
                  </>
                )}
              </div>
            )}

            {filteredSuggestions.map((sugg, idx) => {
              const col = STATUS_COLOR[sugg.status];
              const isSelected = selectedId === sugg.id;
              const isEditing = editingId === sugg.id;
              const globalIdx = allSuggestions.findIndex(s => s.id === sugg.id);

              return (
                <div key={sugg.id}
                  style={{
                    margin: "0 0.75rem 0.5rem",
                    borderRadius: "var(--radius-md)",
                    border: `1px solid ${isSelected ? col.border : "var(--border-color)"}`,
                    backgroundColor: isSelected ? col.bg : "var(--bg-color)",
                    transition: "all 0.15s",
                    overflow: "hidden",
                  }}
                >
                  {/* Card header */}
                  <div
                    onClick={() => isSelected ? setSelectedId(null) : handleSelectCorrection(sugg.id)}
                    style={{
                      padding: "0.625rem 0.875rem",
                      cursor: "pointer",
                      display: "flex", alignItems: "flex-start", gap: "0.5rem",
                    }}
                  >
                    {/* Number badge */}
                    <span style={{
                      flexShrink: 0, width: "20px", height: "20px", borderRadius: "50%",
                      backgroundColor: col.border, color: "#fff",
                      fontSize: "0.65rem", fontWeight: 800,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      marginTop: "2px",
                    }}>
                      {globalIdx + 1}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                        <span style={{ fontSize: "0.65rem", fontWeight: 700, color: col.text, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          {sugg.category ?? "Ortografía"}
                        </span>
                        <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                          {sugg.status === "pending" ? "Pendiente" : sugg.status === "accepted" ? "✓ Aceptada" : sugg.status === "rejected" ? "✕ Rechazada" : "✎ Editada (pendiente)"}
                        </span>
                      </div>
                      {/* Diff */}
                      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap", fontFamily: "monospace", fontSize: "0.8rem" }}>
                        <span style={{ textDecoration: "line-through", color: STATUS_COLOR.pending.text, backgroundColor: "rgba(239,68,68,0.08)", padding: "0 4px", borderRadius: "3px" }}>
                          {sugg.originalText.length > 30 ? sugg.originalText.slice(0, 30) + "…" : sugg.originalText}
                        </span>
                        <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>→</span>
                        <span style={{ color: STATUS_COLOR.accepted.text, backgroundColor: "rgba(16,185,129,0.08)", padding: "0 4px", borderRadius: "3px" }}>
                          {sugg.correctedText.length > 30 ? sugg.correctedText.slice(0, 30) + "…" : sugg.correctedText}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isSelected && (
                    <div style={{ borderTop: "1px solid var(--border-color)", padding: "0.75rem 0.875rem", backgroundColor: "var(--bg-surface)" }}>
                      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontStyle: "italic", marginBottom: "0.75rem", lineHeight: 1.5 }}>
                        {sugg.justification}
                      </p>
                      {sugg.editorJustification && (
                        <p style={{ fontSize: "0.78rem", color: STATUS_COLOR.edited.text, marginBottom: "0.75rem", lineHeight: 1.5 }}>
                          ✎ Nota del editor: {sugg.editorJustification}
                        </p>
                      )}

                      {/* Edit form */}
                      {isEditing ? (
                        <div>
                          <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>
                            Corrección editada
                          </label>
                          <input
                            className="input"
                            style={{ marginBottom: "0.5rem", fontSize: "0.875rem" }}
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            autoFocus
                          />
                          <label style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>
                            Justificación del editor *
                          </label>
                          <textarea
                            className="input"
                            rows={2}
                            style={{ marginBottom: "0.75rem", fontSize: "0.8rem", resize: "vertical" }}
                            placeholder="Explica por qué realizas este cambio…"
                            value={editJustification}
                            onChange={e => setEditJustification(e.target.value)}
                          />
                          <div style={{ display: "flex", gap: "0.4rem" }}>
                            <button className="btn" style={{ flex: 1, padding: "0.35rem", fontSize: "0.78rem" }}
                              onClick={() => handleSaveEdit(sugg.id)}>
                              Guardar ✓
                            </button>
                            <button className="btn btn-secondary" style={{ flex: 1, padding: "0.35rem", fontSize: "0.78rem" }}
                              onClick={() => setEditingId(null)}>
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : canManage() && sugg.status === "pending" ? (
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          <button className="btn-action accept" onClick={() => handleAccept(sugg.id)} style={{ flex: 1, padding: "0.4rem", borderRadius: "var(--radius-sm)", border: `1px solid ${STATUS_COLOR.accepted.border}`, color: STATUS_COLOR.accepted.text, backgroundColor: "transparent", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600 }}>
                            ✓ Aceptar
                          </button>
                          <button
                            onClick={() => { setEditText(sugg.correctedText); setEditJustification(""); setEditingId(sugg.id); }}
                            style={{ flex: 1, padding: "0.4rem", borderRadius: "var(--radius-sm)", border: `1px solid ${STATUS_COLOR.edited.border}`, color: STATUS_COLOR.edited.text, backgroundColor: "transparent", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600 }}>
                            ✎ Editar
                          </button>
                          <button className="btn-action reject" onClick={() => handleReject(sugg.id)} style={{ flex: 1, padding: "0.4rem", borderRadius: "var(--radius-sm)", border: `1px solid ${STATUS_COLOR.rejected.border}`, color: STATUS_COLOR.rejected.text, backgroundColor: "transparent", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600 }}>
                            ✕ Rechazar
                          </button>
                        </div>
                      ) : sugg.status !== "pending" ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem" }}>
                          {sugg.status === "accepted"
                            ? <><CheckCircle2 size={13} style={{ color: STATUS_COLOR.accepted.text }} /><span style={{ color: STATUS_COLOR.accepted.text }}>Aceptada</span></>
                            : sugg.status === "rejected"
                            ? <><XCircle size={13} style={{ color: STATUS_COLOR.rejected.text }} /><span style={{ color: STATUS_COLOR.rejected.text }}>Rechazada</span></>
                            : <span style={{ color: STATUS_COLOR.edited.text }}>✎ Editada — pendiente de aprobación</span>}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid var(--border-color)", display: "flex", gap: "1rem", fontSize: "0.65rem", fontWeight: 600, flexShrink: 0 }}>
            <span style={{ color: STATUS_COLOR.pending.text }}>● Pendiente</span>
            <span style={{ color: STATUS_COLOR.accepted.text }}>● Aceptada</span>
            <span style={{ color: STATUS_COLOR.edited.text }}>● Editada</span>
            <span style={{ color: STATUS_COLOR.rejected.text }}>● Rechazada</span>
          </div>
        </div>
      )}
    </div>
  );
}
