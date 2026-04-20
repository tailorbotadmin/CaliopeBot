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
  style?: string;
  page?: number;  // explicit page from ingestion (if available)
  suggestions?: Suggestion[];
};

// ── Colour helpers ─────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<CorrectionStatus, { bg: string; border: string; text: string }> = {
  pending:  { bg: "rgba(239,68,68,0.13)",   border: "#ef4444", text: "#dc2626" },
  rejected: { bg: "rgba(107,114,128,0.08)", border: "#9ca3af", text: "#6b7280" },
  accepted: { bg: "rgba(16,185,129,0.12)",  border: "#10b981", text: "#059669" },
  edited:   { bg: "rgba(249,115,22,0.13)",  border: "#f97316", text: "#ea580c" },
};

const CATEGORIES = [
  "Todos",
  // Linguistic corrections
  "Tildes", "Gramática", "Puntuación", "Extranjerismos", "Ortografía", "Léxico", "Tipografía",
  // Editorial quality (from CoherenceAgent)
  "Coherencia", "Verificación", "Sensibilidad",
];

// Category display config for editorial categories
const CATEGORY_META: Record<string, { color: string; icon: string }> = {
  Coherencia:   { color: "#8b5cf6", icon: "🧩" },
  Verificación: { color: "#f59e0b", icon: "⚠️" },
  Sensibilidad: { color: "#ef4444", icon: "🚨" },
};


// ── Chapter / section detection (2-level: main chapter + subcapítulo) ─────────────
/** Returns 0=plain, 1=main chapter, 2=subcapítulo */
function detectChapterLevel(chunk: Chunk): 0 | 1 | 2 {
  const style = (chunk.style ?? "").toLowerCase();
  // Explicit docx heading styles
  if (
    style === "heading 1" || style.match(/t[íì]tulo\s*1/i) ||
    style === "title" || style === "chapter"
  ) return 1;
  if (
    style === "heading 2" || style === "heading 3" ||
    style.match(/t[íì]tulo\s*[23]/i) || style === "section"
  ) return 2;
  // Any other heading style → level 1
  if (style.includes("heading") || style.includes("título") || style.includes("titulo")) return 1;

  const text = chunk.text.trim();
  // Level 1: "1 Título", "2. Otro Título" (single number, short)
  if (text.length <= 120 && /^\d+[\s\.]+[A-ZÁÉÍÓÚÑÜ]/u.test(text) && !/^\d+\.\d/.test(text)) return 1;
  // Level 2: "1.1 Subtítulo", "1.1. Sub", "a) Apartado"
  if (text.length <= 100 && (/^\d+\.\d+[\s\.]/.test(text) || /^[a-z\u00e1\u00e9\u00ed\u00f3\u00fa]\)\s+[A-Z]/u.test(text))) return 2;
  return 0;
}

type ChapterGroup = { id: string; title: string; level: 1 | 2; chunkIds: Set<string> };

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
      // For accepted/edited: display the corrected text inline; original is preserved in Firestore
      const displayText = (sugg.status === "accepted" || sugg.status === "edited")
        ? sugg.correctedText
        : sugg.originalText;
      next.push({ text: displayText, type: "correction", sugg, globalIdx });
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
        const isRejected = seg.sugg.status === "rejected";
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
              textDecoration: isRejected ? "line-through" : "none",
              opacity: isRejected ? 0.6 : 1,
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
  const [collapsedChapters, setCollapsedChapters] = useState<Set<string>>(new Set());
  const [showEditorialPanel, setShowEditorialPanel] = useState(false);
  const [editorialAnalysis, setEditorialAnalysis] = useState<{
    tipo_texto?: string;
    registro?: string;
    audiencia_objetivo?: string;
    variedad_linguistica?: string;
    decisiones_autorales?: string[];
    riesgos_editoriales?: string[];
    rasgos_clave?: string[];
    coherence_issues?: number;
  } | null>(null);


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
        if (d.editorial_analysis) setEditorialAnalysis(d.editorial_analysis);

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

  // ── All suggestions flat list (filtered: only valid originalText matches) ──
  const allSuggestions = useMemo(() => {
    const list: (Suggestion & { chunkId: string; chunkOrder: number })[] = [];
    chunks.forEach(chunk => {
      (chunk.suggestions ?? []).forEach(s => {
        // Only skip if originalText is missing or is a no-op (same as correctedText).
        // The text-inclusion check ran server-side before persisting; re-running it here
        // falsely drops corrections when the same phrase appears multiple times in a chunk
        // or when there are subtle encoding differences between stored and live text.
        if (!s.originalText) return;
        if (s.originalText === s.correctedText) return;
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

  // ── Group chunks into chapter sections (2-level: capítulo + subcapítulo) ──
  const chapterGroups = useMemo((): ChapterGroup[] => {
    const groups: ChapterGroup[] = [];
    let currentL1: ChapterGroup | null = null;
    let currentContent: ChapterGroup | null = null; // where to attach plain chunks
    chunks.forEach(chunk => {
      const level = detectChapterLevel(chunk);
      if (level === 1) {
        currentL1 = { id: `ch1-${chunk.id}`, title: chunk.text.trim(), level: 1, chunkIds: new Set([chunk.id]) };
        groups.push(currentL1);
        currentContent = currentL1;
      } else if (level === 2) {
        const sub: ChapterGroup = { id: `ch2-${chunk.id}`, title: chunk.text.trim(), level: 2, chunkIds: new Set([chunk.id]) };
        groups.push(sub);
        currentContent = sub;
      } else {
        if (!currentContent) {
          currentContent = { id: "ch-preamble", title: "Documento", level: 1, chunkIds: new Set() };
          groups.push(currentContent);
          currentL1 = currentContent;
        }
        currentContent.chunkIds.add(chunk.id);
      }
    });
    return groups;
  }, [chunks]);

  const toggleChapter = useCallback((id: string) => {
    setCollapsedChapters(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const allCollapsed = chapterGroups.length > 0 && collapsedChapters.size === chapterGroups.length;
  const toggleAllChapters = useCallback(() => {
    setCollapsedChapters(prev =>
      prev.size === chapterGroups.length ? new Set() : new Set(chapterGroups.map(g => g.id))
    );
  }, [chapterGroups]);

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

  // ── Page numbers: use stored chunk.page when available, else estimate by word count ──
  const chunkPageNumbers = useMemo(() => {
    const map: Record<string, number> = {};
    let wordCount = 0;
    const WORDS_PER_PAGE = 300;
    chunks.forEach(chunk => {
      map[chunk.id] = (chunk.page != null)
        ? chunk.page
        : Math.floor(wordCount / WORDS_PER_PAGE) + 1;
      wordCount += chunk.text.split(/\s+/).filter(Boolean).length;
    });
    return map;
  }, [chunks]);

  const totalPages = useMemo(() => {
    const vals = Object.values(chunkPageNumbers);
    return vals.length > 0 ? Math.max(...vals) : 1;
  }, [chunkPageNumbers]);

  // ── Scroll to correction in doc ──────────────────────────────────────
  const scrollToCorrection = useCallback((id: string) => {
    const el = document.getElementById(`mark-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const handleSelectCorrection = useCallback((id: string) => {
    setSelectedId(id);
    scrollToCorrection(id);
    setEditingId(null);
    // Auto-expand the chapter that contains this correction (if it was collapsed)
    const sugg = allSuggestions.find(s => s.id === id);
    if (sugg) {
      const ownerChapter = chapterGroups.find(g => g.chunkIds.has(sugg.chunkId));
      if (ownerChapter) {
        setCollapsedChapters(prev => {
          if (!prev.has(ownerChapter.id)) return prev;
          const next = new Set(prev);
          next.delete(ownerChapter.id);
          return next;
        });
      }
    }
    // Scroll panel card into view (tiny delay to let the chapter expand first)
    setTimeout(() => {
      document.getElementById(`panel-card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }, [scrollToCorrection, allSuggestions, chapterGroups]);

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

  // ── Render one correction card (shared by flat and grouped views) ─────
  const renderCorrectionCard = (sugg: typeof allSuggestions[0]) => {
    const col = STATUS_COLOR[sugg.status];
    const isSelected = selectedId === sugg.id;
    const isEditing = editingId === sugg.id;
    const globalIdx = allSuggestions.findIndex(s => s.id === sugg.id);
    return (
      <div
        key={sugg.id}
        id={`panel-card-${sugg.id}`}
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
              {/* Editorial profile badges */}
              {editorialAnalysis?.tipo_texto && (
                <button
                  onClick={() => setShowEditorialPanel(v => !v)}
                  title="Análisis editorial — clic para ver detalles"
                  style={{
                    display: "flex", alignItems: "center", gap: "0.3rem",
                    background: "none", border: "1px solid var(--border-color)", borderRadius: "99px",
                    padding: "0.15rem 0.55rem", cursor: "pointer",
                    fontSize: "0.65rem", fontWeight: 700, color: "var(--text-muted)",
                    transition: "all 0.15s",
                  }}
                >
                  📋 {editorialAnalysis.tipo_texto?.replace(/-/g, " ")}
                  {editorialAnalysis.registro && (
                    <span style={{ color: "var(--primary)", borderLeft: "1px solid var(--border-color)", paddingLeft: "0.35rem" }}>
                      {editorialAnalysis.registro?.replace(/-/g, " ")}
                    </span>
                  )}
                  {(editorialAnalysis.riesgos_editoriales?.length ?? 0) > 0 && (
                    <span style={{ color: "#ef4444", marginLeft: "0.2rem" }}>⚠️</span>
                  )}
                </button>
              )}
            </div>
          </div>
          {/* ── Editorial Analysis Panel (collapsible) ── */}
          {showEditorialPanel && editorialAnalysis && (
            <div style={{
              padding: "0.85rem 1.5rem",
              backgroundColor: "rgba(99,102,241,0.04)",
              borderTop: "1px solid var(--border-color)",
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.75rem",
              fontSize: "0.72rem",
            }}>
              {/* Metadata row */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", gridColumn: "1 / -1" }}>
                {[
                  { label: "Tipo", value: editorialAnalysis.tipo_texto },
                  { label: "Registro", value: editorialAnalysis.registro },
                  { label: "Audiencia", value: editorialAnalysis.audiencia_objetivo },
                  { label: "Variedad", value: editorialAnalysis.variedad_linguistica },
                ].map(({ label, value }) => value ? (
                  <span key={label} style={{
                    padding: "0.2rem 0.55rem", borderRadius: "99px",
                    backgroundColor: "rgba(99,102,241,0.1)", color: "var(--primary)",
                    fontWeight: 700, fontSize: "0.65rem",
                  }}>
                    {label}: {value.replace(/-/g, " ")}
                  </span>
                ) : null)}
              </div>
              {/* Decisiones autorales */}
              {(editorialAnalysis.decisiones_autorales?.length ?? 0) > 0 && (
                <div>
                  <div style={{ fontWeight: 700, color: "#10b981", marginBottom: "0.3rem" }}>
                    ✅ Decisiones autorales (no corregir)
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "1.2em", color: "var(--text-muted)", lineHeight: 1.7 }}>
                    {editorialAnalysis.decisiones_autorales?.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </div>
              )}
              {/* Riesgos editoriales */}
              {(editorialAnalysis.riesgos_editoriales?.length ?? 0) > 0 && (
                <div>
                  <div style={{ fontWeight: 700, color: "#ef4444", marginBottom: "0.3rem" }}>
                    ⚠️ Riesgos editoriales
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "1.2em", color: "var(--text-muted)", lineHeight: 1.7 }}>
                    {editorialAnalysis.riesgos_editoriales?.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {/* Rasgos clave */}
              {(editorialAnalysis.rasgos_clave?.length ?? 0) > 0 && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontWeight: 700, color: "var(--text-muted)", marginBottom: "0.3rem" }}>Rasgos de estilo</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                    {editorialAnalysis.rasgos_clave?.map((r, i) => (
                      <span key={i} style={{
                        padding: "0.1rem 0.45rem", borderRadius: "4px",
                        backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-color)",
                        color: "var(--text-muted)", fontSize: "0.62rem", fontFamily: "monospace",
                      }}>{r}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="editor-actions">
            {/* Annotation toggle */}
            <button
              className="btn btn-secondary"
              onClick={() => setShowAnnotations(v => !v)}
              style={{ fontSize: "0.75rem", padding: "0.35rem 0.65rem" }}
            >
              {showAnnotations ? "Ocultar marcas" : "Mostrar marcas"}
            </button>
            {canManage() && (() => {
              const pendingCount = allSuggestions.filter(s => s.status === "pending").length;
              const allResolved = pendingCount === 0 && allSuggestions.length > 0;
              return (
                <button
                  className="btn"
                  style={{ whiteSpace: "nowrap", opacity: allResolved ? 1 : 0.45, cursor: allResolved ? "pointer" : "not-allowed" }}
                  onClick={allResolved ? handleNextPhase : undefined}
                  title={allResolved ? "Cerrar fase de revisión" : `Faltan ${pendingCount} correcciones por revisar`}
                >
                  Cerrar Fase ✓{!allResolved && ` (${pendingCount} pendientes)`}
                </button>
              );
            })()}
            <button className="btn" onClick={handleDownload}
              title="Descargar manuscrito corregido"
              style={{ backgroundColor: "var(--success)", display: "flex", alignItems: "center", gap: "0.375rem", flexShrink: 0 }}>
              <Download size={14} /> Descargar
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
          {chunks.map((chunk, i) => {
            const chunkSuggs = (chunk.suggestions ?? []) as Suggestion[];
            const offset = chunkGlobalOffset[chunk.id] ?? 0;
            const currentPage = chunkPageNumbers[chunk.id] ?? 1;
            const prevPage = i > 0 ? (chunkPageNumbers[chunks[i - 1].id] ?? 1) : 1;
            const showPageBreak = i > 0 && currentPage > prevPage;
            return (
              <>
                {showPageBreak && (
                  <div key={`pb-${chunk.id}`} style={{
                    margin: "2.5rem -3rem",
                    display: "flex", alignItems: "center", gap: "1rem",
                    color: "var(--text-muted)", fontSize: "0.7rem", fontWeight: 600,
                    letterSpacing: "0.08em", userSelect: "none",
                  }}>
                    <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-color)" }} />
                    <span style={{
                      padding: "0.2rem 0.8rem",
                      border: "1px solid var(--border-color)",
                      borderRadius: "99px",
                      backgroundColor: "var(--bg-surface)",
                      whiteSpace: "nowrap",
                    }}>
                      Página {currentPage}
                    </span>
                    <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-color)" }} />
                  </div>
                )}
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
              </>
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

            {/* Collapse-all toggle — only when chapters are detected */}
            {chapterGroups.length > 1 && filteredSuggestions.length > 0 && (
              <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 0.75rem 0.4rem", gap: "0.4rem" }}>
                <button
                  onClick={toggleAllChapters}
                  style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", letterSpacing: "0.03em", padding: "0.1rem 0.3rem", borderRadius: "4px" }}
                >
                  {allCollapsed ? "▶ Expandir todo" : "▼ Colapsar todo"}
                </button>
              </div>
            )}

            {/* Grouped by chapter (or flat if no chapters detected) */}
            {chapterGroups.length <= 1
              ? filteredSuggestions.map((sugg) => renderCorrectionCard(sugg))
              : chapterGroups.map(chapter => {
                  const chapterSuggs = filteredSuggestions.filter(s => chapter.chunkIds.has(s.chunkId));
                  if (chapterSuggs.length === 0) return null;
                  const isCollapsed = collapsedChapters.has(chapter.id);
                  const pendingInChapter = chapterSuggs.filter(s => s.status === "pending").length;
                  return (
                    <div key={chapter.id} style={{ marginBottom: "0.15rem" }}>
                      {/* Chapter / subcapítulo header */}
                      <div
                        onClick={() => toggleChapter(chapter.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: "0.4rem",
                          padding: chapter.level === 1 ? "0.45rem 0.75rem" : "0.3rem 0.75rem 0.3rem 1.5rem",
                          cursor: "pointer",
                          backgroundColor: chapter.level === 1 ? "var(--bg-surface)" : "transparent",
                          borderTop: chapter.level === 1 ? "1px solid var(--border-color)" : "none",
                          borderLeft: chapter.level === 2 ? "2px solid var(--border-color)" : "none",
                          borderBottom: isCollapsed ? "1px solid var(--border-color)" : "none",
                          userSelect: "none",
                        }}
                      >
                        <span style={{
                          fontSize: "0.55rem", color: "var(--text-muted)", flexShrink: 0,
                          display: "inline-block", transform: isCollapsed ? "rotate(-90deg)" : "rotate(0)",
                          transition: "transform 0.15s",
                        }}>▼</span>
                        <span style={{
                          flex: 1,
                          fontSize: chapter.level === 1 ? "0.7rem" : "0.65rem",
                          fontWeight: chapter.level === 1 ? 700 : 600,
                          color: chapter.level === 1 ? "var(--text-main)" : "var(--text-muted)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          fontStyle: chapter.level === 2 ? "italic" : "normal",
                        }}>
                          {chapter.title}
                        </span>
                        <span style={{
                          fontSize: "0.6rem", fontWeight: 700, flexShrink: 0,
                          color: chapter.level === 1 ? "var(--primary)" : "var(--text-muted)",
                          backgroundColor: chapter.level === 1 ? "rgba(99,102,241,0.1)" : "transparent",
                          borderRadius: "99px", padding: "0.05rem 0.4rem",
                        }}>
                          {pendingInChapter > 0 ? `${pendingInChapter} pend.` : `${chapterSuggs.length} ✓`}
                        </span>
                      </div>
                      {/* Corrections in this chapter */}
                      {!isCollapsed && chapterSuggs.map(sugg => renderCorrectionCard(sugg))}
                    </div>
                  );
                })
            }
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
