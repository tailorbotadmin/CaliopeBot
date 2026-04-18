"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { collection, query, orderBy, onSnapshot, doc, setDoc, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { updateBookStatus, notifyResponsables } from "@/lib/firestore";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { saveAs } from "file-saver";
import {
  ChevronLeft, ChevronRight, ArrowLeft, Download,
  CheckCircle2, XCircle, Clock, Loader2,
  PanelLeftClose, PanelLeftOpen,
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

export default function EditorPage() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("bookId");
  const { organizationId, user, role } = useAuth();
  const router = useRouter();

  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [resolvedOrgId, setResolvedOrgId] = useState<string | null>(null);
  const [bookStatus, setBookStatus] = useState<string>("processing");
  const [bookTitle, setBookTitle] = useState<string>("");
  const [processedCount, setProcessedCount] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [chunkLoadError, setChunkLoadError] = useState<string | null>(null);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [retryingFromEditor, setRetryingFromEditor] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);
  const [editingSuggestion, setEditingSuggestion] = useState<string | null>(null);
  const [customEdit, setCustomEdit] = useState("");
  const [jumpInput, setJumpInput] = useState("");

  const navStripRef = useRef<HTMLDivElement>(null);

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

  // Analysis progress %
  const analysisPct = totalChunks > 0 ? Math.round((processedCount / totalChunks) * 100) : 0;

  // ── Resolve orgId for SuperAdmin ─────────────────────────────────────
  useEffect(() => {
    if (!bookId) return;
    if (organizationId) { setResolvedOrgId(organizationId); return; }
    (async () => {
      try {
        const { getDocs, collection: col, doc: docRef, getDoc } = await import("firebase/firestore");
        const orgsSnap = await getDocs(col(db, "organizations"));
        for (const orgDoc of orgsSnap.docs) {
          const bookSnap = await getDoc(docRef(db, "organizations", orgDoc.id, "books", bookId));
          if (bookSnap.exists()) { setResolvedOrgId(orgDoc.id); return; }
        }
        setChunkLoadError("No se encontró el libro en ninguna organización.");
      } catch (e) {
        setChunkLoadError("Error buscando el libro: " + (e instanceof Error ? e.message : String(e)));
      }
    })();
  }, [bookId, organizationId]);

  const effectiveOrgId = resolvedOrgId;

  // ── Real-time book listener ───────────────────────────────────────
  useEffect(() => {
    if (!effectiveOrgId || !bookId) return;
    const unsub = onSnapshot(doc(db, "organizations", effectiveOrgId, "books", bookId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setBookStatus(data.status ?? "processing");
        setBookTitle(data.title ?? "");
        setTotalChunks(data.totalChunks ?? 0);
        setProcessedCount(data.processedChunks ?? 0);
      }
    });
    return unsub;
  }, [effectiveOrgId, bookId]);

  // ── Real-time chunks listener ─────────────────────────────────────
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

  // ── Timeout detection ─────────────────────────────────────────────
  useEffect(() => {
    if (chunks.length > 0) { setLoadingTimedOut(false); return; }
    if (bookStatus !== "processing") return;
    const t = setTimeout(() => setLoadingTimedOut(true), 30_000);
    return () => clearTimeout(t);
  }, [chunks.length, bookStatus]);

  // ── Sidebar toggle ────────────────────────────────────────────────
  useEffect(() => {
    const sidebar = document.querySelector(".sidebar") as HTMLElement | null;
    if (sidebar) {
      sidebar.style.width = sidebarCollapsed ? "0" : "";
      sidebar.style.overflow = sidebarCollapsed ? "hidden" : "";
      sidebar.style.padding = sidebarCollapsed ? "0" : "";
      sidebar.style.minWidth = sidebarCollapsed ? "0" : "";
    }
  }, [sidebarCollapsed]);

  // Scroll current chunk badge into view in nav strip
  useEffect(() => {
    if (!navStripRef.current) return;
    const active = navStripRef.current.querySelector(".chunk-badge.active") as HTMLElement | null;
    active?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [currentChunkIndex]);

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
      const data = await res.json();
      if (res.ok) {
        setLoadingTimedOut(false);
      } else if (data?.detail?.startsWith("no_chunks:")) {
        alert("El manuscrito no tiene segmentos registrados. Vuelve a la lista y usa el botón ↺.");
      } else {
        alert(`Error al reintentar: ${data?.detail ?? res.statusText}`);
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
  const handleDownloadDocx = async () => {
    if (chunks.length === 0) return;
    const docChildren = chunks.map(chunk => {
      let computed = chunk.text || "";
      (chunk.suggestions ?? []).forEach((s: Suggestion) => {
        if (s.status !== "rejected") computed = computed.replace(s.originalText, s.correctedText);
      });
      return new Paragraph({ children: [new TextRun(computed)], spacing: { after: 200 } });
    });
    const blob = await Packer.toBlob(new Document({ sections: [{ properties: {}, children: docChildren }] }));
    saveAs(blob, `${bookTitle || "Manuscrito"}_Corregido.docx`);
  };

  // ── Suggestion actions ─────────────────────────────────────────────
  const handleAction = async (id: string, action: "accepted" | "rejected") => {
    const newSuggestions = suggestions.map(s => s.id === id ? { ...s, status: action } : s);
    setSuggestions(newSuggestions);
    await saveChunkLocally(newSuggestions);
    const actedSug = newSuggestions.find(s => s.id === id);
    if (organizationId && user && actedSug) {
      try {
        await addDoc(collection(db, "corrections"), {
          bookId: bookId ?? null, organizationId,
          editorId: user.uid, editorEmail: user.email ?? null,
          editorName: user.displayName ?? user.email ?? null,
          status: action, sourceRule: actedSug.sourceRule ?? null,
          originalText: actedSug.originalText, correctedText: actedSug.correctedText,
          createdAt: serverTimestamp(),
        });
      } catch { /* non-critical */ }
    }
    if (action === "accepted" && organizationId && user && actedSug) {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
        await fetch(`${apiUrl}/api/v1/learn-correction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId: organizationId, authorId: user.uid, role,
            originalText: actedSug.originalText, correctedText: actedSug.correctedText,
            justification: actedSug.justification,
          }),
        });
      } catch { /* non-critical */ }
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
    if (!effectiveOrgId || !bookId || chunks.length === 0) return;
    const currentChunk = chunks[currentChunkIndex];
    try {
      await setDoc(
        doc(db, "organizations", effectiveOrgId, "books", bookId, "chunks", currentChunk.id),
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
    if (role === "Autor") return ["review_author", "review_responsable", "approved"].includes(bookStatus);
    return false;
  };

  if (!bookId) return <div style={{ padding: "2rem" }}>No se ha seleccionado ningún libro.</div>;

  const processedChunks = chunks.filter(c => c.status === "processed").length;
  const isStillProcessing = bookStatus === "processing";

  // ── Empty state ────────────────────────────────────────────────────
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
          ) : isStillProcessing && !isBlocked ? (
            <>
              <div className="processing-spinner" style={{ marginBottom: "1.5rem" }}><div className="spinner-ring" /></div>
              <p style={{ marginBottom: "0.5rem" }}>Preparando el manuscrito, por favor espera…</p>
              {totalChunks > 0 && (
                <p style={{ fontSize: "0.8rem", color: "var(--primary)", fontWeight: 600 }}>
                  Análisis {analysisPct}% completado
                </p>
              )}
            </>
          ) : isStillProcessing && isBlocked ? (
            <>
              <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🔄</div>
              <p style={{ fontWeight: 700, color: "var(--text-main)", marginBottom: "0.5rem" }}>El análisis parece bloqueado</p>
              <p style={{ fontSize: "0.8rem", marginBottom: "1.5rem" }}>
                Lleva más de 30 segundos sin cargar. El worker puede haber caído.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <button className="btn" onClick={handleEditorRetry} disabled={retryingFromEditor}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
                  {retryingFromEditor ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : "↺"}
                  Reintentar análisis
                </button>
                <button className="btn btn-secondary" onClick={() => router.push("/dashboard/books")}>
                  Volver a Manuscritos
                </button>
              </div>
            </>
          ) : (
            <p>Este manuscrito no tiene segmentos de texto disponibles.</p>
          )}
          {!isBlocked && !chunkLoadError && (
            <button className="btn btn-secondary" style={{ marginTop: "1.5rem" }} onClick={() => router.push("/dashboard/books")}>
              Volver
            </button>
          )}
        </div>
      </div>
    );
  }

  const currentChunk = chunks[currentChunkIndex];
  let computedCorrectedText = currentChunk.text || "";
  suggestions.forEach(s => {
    if (s.status !== "rejected") computedCorrectedText = computedCorrectedText.replace(s.originalText, s.correctedText);
  });
  const pendingSuggestions = suggestions.filter(s => s.status === "pending");
  const resolvedSuggestions = suggestions.filter(s => s.status !== "pending");

  return (
    <div className="editor-container fade-in">

      {/* ── Analysis progress banner ── */}
      {isStillProcessing && (
        <div style={{
          backgroundColor: "rgba(99,102,241,0.08)", borderBottom: "1px solid rgba(99,102,241,0.2)",
          padding: "0.5rem 1.5rem", display: "flex", alignItems: "center", gap: "0.75rem",
          fontSize: "0.8125rem", color: "var(--text-muted)",
        }}>
          <div className="pulse-dot" style={{ flexShrink: 0 }} />
          <span>Análisis IA en curso</span>
          {totalChunks > 0 && (
            <div style={{ flex: 1, maxWidth: "200px", height: "4px", backgroundColor: "var(--border-color)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${analysisPct}%`, backgroundColor: "var(--primary)", borderRadius: "2px", transition: "width 0.5s ease" }} />
            </div>
          )}
          <strong style={{ color: "var(--primary)" }}>{analysisPct}% completado</strong>
          <span style={{ marginLeft: "auto", color: "#6366f1", fontWeight: 600 }}>Puedes editar mientras tanto</span>
        </div>
      )}

      {/* ── Header ── */}
      <header className="editor-header">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarCollapsed(v => !v)}
              className="btn-ghost"
              title={sidebarCollapsed ? "Mostrar barra lateral" : "Ocultar barra lateral"}
              style={{ padding: "0.3rem", display: "flex", alignItems: "center", color: "var(--text-muted)", flexShrink: 0 }}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>

            <button
              className="btn-ghost"
              style={{ padding: "0.25rem 0.5rem", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.25rem", color: "var(--text-muted)" }}
              onClick={() => router.push("/dashboard/books")}
            >
              <ArrowLeft size={14} /> Biblioteca
            </button>
            <span style={{ color: "var(--border-color)" }}>/</span>
            <h1 className="editor-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {bookTitle || "Manuscrito"}
            </h1>
          </div>

          {/* Two progress bars — Analysis % + Review % */}
          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <div style={{ width: "120px", height: "4px", backgroundColor: "var(--border-color)", borderRadius: "2px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${analysisPct}%`, backgroundColor: analysisPct === 100 ? "var(--success)" : "var(--primary)", transition: "width 0.5s ease", borderRadius: "2px" }} />
              </div>
              <span className="editor-stats" style={{ color: analysisPct === 100 ? "var(--success)" : "var(--text-muted)" }}>
                Análisis {analysisPct}%
              </span>
            </div>
            {globalProgress.total > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div style={{ width: "120px", height: "4px", backgroundColor: "var(--border-color)", borderRadius: "2px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${globalProgress.pct}%`, backgroundColor: globalProgress.pct === 100 ? "var(--success)" : "#f59e0b", transition: "width 0.4s ease", borderRadius: "2px" }} />
                </div>
                <span className="editor-stats" style={{ color: globalProgress.pct === 100 ? "var(--success)" : "var(--text-muted)" }}>
                  Revisión {globalProgress.pct}%
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="editor-actions" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
          {/* Jump to segment */}
          <form onSubmit={handleJump} style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Ir a:</span>
            <input
              type="number" className="input" value={jumpInput}
              onChange={e => setJumpInput(e.target.value)}
              placeholder={String(currentChunkIndex + 1)}
              min={1} max={chunks.length}
              style={{ width: "56px", padding: "0.3rem 0.5rem", fontSize: "0.8125rem", marginBottom: 0, textAlign: "center" }}
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

      {/* ── Dual pane: Original | Corregido ── */}
      {currentChunk.status === "pending" ? (
        <div className="pane-wrapper">
          <div className="text-pane">
            <div className="pane-header">Texto Original (Autor)</div>
            <div className="pane-content original-text">{currentChunk.text}</div>
          </div>
          <div className="text-pane" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>
              <div className="pulse-dot" style={{ margin: "0 auto 0.75rem" }} />
              <p style={{ fontSize: "0.875rem" }}>Analizando este fragmento…</p>
              <p style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>Las sugerencias aparecerán automáticamente.</p>
            </div>
          </div>
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

      {/* ── Suggestions panel ── */}
      <div className="suggestions-panel">
        {pendingSuggestions.length > 0 && (
          <div style={{ marginBottom: "1.25rem" }}>
            <div className="suggestions-section-header">
              <Clock size={13} style={{ color: "var(--warning)" }} />
              <span>Pendientes</span>
              <span className="suggestions-count pending-count">{pendingSuggestions.length}</span>
            </div>
            <div className="suggestions-grid">
              {pendingSuggestions.map(s => (
                <SuggestionCard key={s.id} suggestion={s}
                  selected={selectedSuggestion === s.id} editing={editingSuggestion === s.id}
                  customEdit={customEdit} canManage={canManageSuggestions()}
                  onSelect={() => setSelectedSuggestion(s.id)}
                  onAccept={() => handleAction(s.id, "accepted")}
                  onReject={() => handleAction(s.id, "rejected")}
                  onStartEdit={() => { setCustomEdit(s.correctedText); setEditingSuggestion(s.id); }}
                  onSaveEdit={() => saveEdit(s.id)}
                  onCancelEdit={() => setEditingSuggestion(null)}
                  onCustomEditChange={setCustomEdit}
                />
              ))}
            </div>
          </div>
        )}

        {resolvedSuggestions.length > 0 && (
          <div>
            <div className="suggestions-section-header" style={{ opacity: 0.7 }}>
              <CheckCircle2 size={13} style={{ color: "var(--success)" }} />
              <span>Resueltas</span>
              <span className="suggestions-count resolved-count">{resolvedSuggestions.length}</span>
            </div>
            <div className="suggestions-grid">
              {resolvedSuggestions.map(s => (
                <SuggestionCard key={s.id} suggestion={s}
                  selected={false} editing={false} customEdit="" canManage={false}
                  onSelect={() => {}} onAccept={() => {}} onReject={() => {}}
                  onStartEdit={() => {}} onSaveEdit={() => {}} onCancelEdit={() => {}}
                  onCustomEditChange={() => {}} resolved
                />
              ))}
            </div>
          </div>
        )}

        {suggestions.length === 0 && (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>
            <CheckCircle2 size={28} style={{ marginBottom: "0.5rem", opacity: 0.4 }} />
            <p>No hay correcciones para este fragmento.</p>
          </div>
        )}
      </div>

      {/* ── Chapter / segment strip (bottom) — badge with correction count ── */}
      <div
        ref={navStripRef}
        style={{
          display: "flex", gap: "0.3rem", padding: "0.5rem 1rem",
          overflowX: "auto", borderTop: "1px solid var(--border-color)",
          backgroundColor: "var(--bg-surface)", flexShrink: 0,
          scrollbarWidth: "thin",
        }}
      >
        {chunks.map((chunk, idx) => {
          const pending = (chunk.suggestions ?? []).filter((s: Suggestion) => s.status === "pending").length;
          const total = (chunk.suggestions ?? []).length;
          const resolved = total - pending;
          const isActive = idx === currentChunkIndex;
          const isAnalyzing = chunk.status === "pending";

          return (
            <button
              key={chunk.id}
              className={`chunk-badge${isActive ? " active" : ""}`}
              onClick={() => setCurrentChunkIndex(idx)}
              title={`Fragmento ${idx + 1}${pending > 0 ? ` · ${pending} correcciones pendientes` : total > 0 ? " · Revisado" : ""}`}
              style={{
                position: "relative", flexShrink: 0,
                width: "36px", height: "36px",
                borderRadius: "var(--radius)",
                border: isActive ? "2px solid var(--primary)" : "1px solid var(--border-color)",
                backgroundColor: isActive ? "rgba(99,102,241,0.12)" : resolved === total && total > 0 ? "rgba(16,185,129,0.08)" : "var(--card-bg)",
                cursor: "pointer", fontSize: "0.7rem", fontWeight: 700,
                color: isActive ? "var(--primary)" : "var(--text-muted)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
              }}
            >
              {isAnalyzing ? (
                <Loader2 size={12} style={{ animation: "spin 1s linear infinite", opacity: 0.5 }} />
              ) : (
                idx + 1
              )}
              {/* Badge count */}
              {pending > 0 && (
                <span style={{
                  position: "absolute", top: "-5px", right: "-5px",
                  width: "16px", height: "16px", borderRadius: "50%",
                  backgroundColor: "#f59e0b", color: "#fff",
                  fontSize: "0.6rem", fontWeight: 800,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  lineHeight: 1,
                }}>
                  {pending > 9 ? "9+" : pending}
                </span>
              )}
              {pending === 0 && total > 0 && (
                <span style={{
                  position: "absolute", top: "-5px", right: "-5px",
                  width: "14px", height: "14px", borderRadius: "50%",
                  backgroundColor: "var(--success)", color: "#fff",
                  fontSize: "0.55rem",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── SuggestionCard ─────────────────────────────────────────────────────────
type SuggestionCardProps = {
  suggestion: Suggestion;
  selected: boolean; editing: boolean; customEdit: string; canManage: boolean;
  onSelect: () => void; onAccept: () => void; onReject: () => void;
  onStartEdit: () => void; onSaveEdit: () => void; onCancelEdit: () => void;
  onCustomEditChange: (val: string) => void;
  resolved?: boolean;
};

function SuggestionCard({
  suggestion, selected, editing, customEdit, canManage,
  onSelect, onAccept, onReject, onStartEdit, onSaveEdit, onCancelEdit, onCustomEditChange, resolved,
}: SuggestionCardProps) {
  const statusLabel: Record<string, string> = {
    pending: "Pendiente", accepted: "Aceptado", rejected: "Rechazado", edited: "Editado",
  };
  return (
    <div className={`suggestion-card ${selected ? "active" : ""} ${resolved ? "resolved" : ""}`} onClick={onSelect}>
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
              <input type="text" value={customEdit} onChange={e => onCustomEditChange(e.target.value)}
                className="input" autoFocus style={{ marginBottom: "0.5rem" }} />
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
