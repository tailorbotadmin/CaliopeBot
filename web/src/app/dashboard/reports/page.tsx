"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  computeOrgKPIs, getOrganizations, getOrgCorrections,
  OrgKPIs, Organization, CorrectionRecord,
} from "@/lib/firestore";
import { db } from "@/lib/firebase";
import { collection, getDocs, doc, getDoc, query, orderBy } from "firebase/firestore";
import {
  BarChart3, TrendingUp, UserCheck, AlertTriangle,
  CheckCircle2, XCircle, RefreshCw, Building2,
  FileText, BookOpen, ChevronDown, Clock, Layers,
  Tag, Zap, Target, PieChart, Activity,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Suggestion {
  id: string;
  status: "pending" | "accepted" | "rejected";
  sourceRule?: string;
  riskLevel?: "low" | "medium" | "high";
  justification?: string;
  originalText?: string;
  correctedText?: string;
  reglaAplicada?: string;
}

interface Chunk {
  id: string;
  order: number;
  status: string;
  text?: string;
  suggestions?: Suggestion[];
}

interface BookMeta {
  id: string;
  title: string;
  authorId?: string;
  authorName?: string;
  assignedEditorId?: string;
  assignedEditorName?: string;
  status: string;
  createdAt?: { toDate: () => Date };
  voiceProfile?: {
    resumen?: string;
    rasgos_clave?: string[];
    instrucciones_agentes?: string;
  };
  totalChunks?: number;
  processedChunks?: number;
}

interface ManuscriptAnalytics {
  book: BookMeta;
  chunks: Chunk[];
  totalSuggestions: number;
  accepted: number;
  rejected: number;
  pending: number;
  acceptRate: number;
  rejectRate: number;
  bySource: { name: string; count: number; color: string }[];
  byRisk: { label: string; count: number; color: string }[];
  topRules: { rule: string; count: number }[];
  byChunk: { label: string; accepted: number; rejected: number; pending: number }[];
  editorialDensity: number; // suggestions per 1000 chars
}

type WeekBucket = { label: string; accepted: number; rejected: number };

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

function groupByWeek(records: CorrectionRecord[]): WeekBucket[] {
  const map = new Map<string, WeekBucket>();
  for (const r of records) {
    if (!r.createdAt) continue;
    const d = r.createdAt.toDate();
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const week = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
    const label = `S${week < 10 ? "0" + week : week}`;
    if (!map.has(label)) map.set(label, { label, accepted: 0, rejected: 0 });
    const b = map.get(label)!;
    if (r.status === "accepted") b.accepted++;
    else if (r.status === "rejected") b.rejected++;
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8).map(e => e[1]);
}

function computeManuscriptAnalytics(book: BookMeta, chunks: Chunk[]): ManuscriptAnalytics {
  const allSuggestions: Suggestion[] = chunks.flatMap(c => c.suggestions ?? []);
  const total = allSuggestions.length;
  const accepted = allSuggestions.filter(s => s.status === "accepted").length;
  const rejected = allSuggestions.filter(s => s.status === "rejected").length;
  const pending = allSuggestions.filter(s => s.status === "pending").length;

  // By source
  const sourceMap: Record<string, number> = {};
  for (const s of allSuggestions) {
    const src = s.sourceRule?.startsWith("lt_") || s.sourceRule?.startsWith("RAE:")
      ? "LanguageTool (RAE)"
      : s.sourceRule === "AI_Arbiter"
        ? "Árbitro Editorial"
        : s.id?.startsWith("corrector_")
          ? "Corrector AI"
          : s.id?.startsWith("lt_")
            ? "LanguageTool (RAE)"
            : "Corrector AI";
    sourceMap[src] = (sourceMap[src] ?? 0) + 1;
  }
  const sourceColors: Record<string, string> = {
    "LanguageTool (RAE)": "#06b6d4",
    "Árbitro Editorial": "#a855f7",
    "Corrector AI": "#6366f1",
  };
  const bySource = Object.entries(sourceMap).map(([name, count]) => ({
    name, count, color: sourceColors[name] ?? "#6366f1",
  })).sort((a, b) => b.count - a.count);

  // By risk
  const riskMap = { low: 0, medium: 0, high: 0 };
  for (const s of allSuggestions) {
    const r = s.riskLevel ?? "medium";
    riskMap[r as keyof typeof riskMap]++;
  }
  const byRisk = [
    { label: "Bajo riesgo", count: riskMap.low, color: "#10b981" },
    { label: "Riesgo medio", count: riskMap.medium, color: "#f59e0b" },
    { label: "Alto riesgo", count: riskMap.high, color: "#ef4444" },
  ];

  // Top rules
  const ruleMap: Record<string, number> = {};
  for (const s of allSuggestions) {
    const rule = s.reglaAplicada || s.sourceRule || "Sin clasificar";
    if (rule && rule !== "AI_Arbiter" && !rule.startsWith("RAE:")) {
      ruleMap[rule] = (ruleMap[rule] ?? 0) + 1;
    }
  }
  const topRules = Object.entries(ruleMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([rule, count]) => ({ rule, count }));

  // By chunk
  const byChunk = chunks.map((c, i) => {
    const s = c.suggestions ?? [];
    return {
      label: `#${i + 1}`,
      accepted: s.filter(x => x.status === "accepted").length,
      rejected: s.filter(x => x.status === "rejected").length,
      pending: s.filter(x => x.status === "pending").length,
    };
  });

  // Editorial density (suggestions per 1000 chars of text)
  const totalChars = chunks.reduce((acc, c) => acc + (c.text?.length ?? 0), 0);
  const editorialDensity = totalChars > 0 ? Math.round((total / totalChars) * 1000 * 10) / 10 : 0;

  return {
    book, chunks, totalSuggestions: total, accepted, rejected, pending,
    acceptRate: total > 0 ? Math.round((accepted / total) * 100) : 0,
    rejectRate: total > 0 ? Math.round((rejected / total) * 100) : 0,
    bySource, byRisk, topRules, byChunk, editorialDensity,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini chart components
// ─────────────────────────────────────────────────────────────────────────────

function DonutChart({ accepted, rejected, pending, size = 100 }: {
  accepted: number; rejected: number; pending: number; size?: number;
}) {
  const total = accepted + rejected + pending || 1;
  const r = (size / 2) - 10;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  const segments = [
    { val: accepted, color: "#10b981" },
    { val: rejected, color: "#ef4444" },
    { val: pending, color: "#6366f1" },
  ];

  let offset = 0;
  const arcs = segments.map(seg => {
    const pct = seg.val / total;
    const dash = pct * circ;
    const arc = { dasharray: `${dash} ${circ - dash}`, offset: circ * (1 - offset), ...seg };
    offset += pct;
    return arc;
  });

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border-color)" strokeWidth={12} />
      {arcs.map((a, i) => a.val > 0 && (
        <circle
          key={i} cx={cx} cy={cy} r={r}
          fill="none"
          stroke={a.color}
          strokeWidth={12}
          strokeDasharray={a.dasharray}
          strokeDashoffset={a.offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      ))}
    </svg>
  );
}

function HorizBar({ items, maxCount }: { items: { label: string; count: number; color: string }[]; maxCount: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {items.filter(i => i.count > 0).map(it => (
        <div key={it.label}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.2rem" }}>
            <span style={{ color: "var(--text-main)", fontWeight: 600 }}>{it.label}</span>
            <span style={{ color: "var(--text-muted)" }}>{it.count}</span>
          </div>
          <div style={{ height: "6px", borderRadius: "99px", backgroundColor: "var(--border-color)", overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${Math.round((it.count / maxCount) * 100)}%`,
              backgroundColor: it.color,
              borderRadius: "99px",
              transition: "width 0.6s ease",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChunkTimeline({ byChunk }: { byChunk: { label: string; accepted: number; rejected: number; pending: number }[] }) {
  const maxVal = Math.max(...byChunk.map(c => c.accepted + c.rejected + c.pending), 1);
  const H = 80;
  const W = Math.max(24, Math.min(36, Math.floor(800 / (byChunk.length || 1))));
  const totalW = byChunk.length * (W + 2) + 4;

  if (byChunk.length === 0) return <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>Sin segmentos</div>;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width="100%" viewBox={`0 0 ${totalW} ${H + 20}`} style={{ minWidth: `${Math.min(totalW, 600)}px` }}>
        {byChunk.map((c, i) => {
          const x = 2 + i * (W + 2);
          const accH = Math.round((c.accepted / maxVal) * H);
          const rejH = Math.round((c.rejected / maxVal) * H);
          const penH = Math.round((c.pending / maxVal) * H);
          return (
            <g key={i}>
              {penH > 0 && <rect x={x} y={H - penH} width={W - 2} height={penH} rx={2} fill="rgba(99,102,241,0.3)" />}
              {rejH > 0 && <rect x={x} y={H - accH - rejH} width={W - 2} height={rejH} rx={2} fill="rgba(239,68,68,0.6)" />}
              {accH > 0 && <rect x={x} y={H - accH} width={W - 2} height={accH} rx={2} fill="#10b981" />}
            </g>
          );
        })}
        <line x1={0} y1={H} x2={totalW} y2={H} stroke="var(--border-color)" strokeWidth={1} />
      </svg>
      <div style={{ display: "flex", gap: "1rem", fontSize: "0.7rem", marginTop: "0.5rem", color: "var(--text-muted)" }}>
        {[["#10b981", "Aceptadas"], ["rgba(239,68,68,0.7)", "Rechazadas"], ["rgba(99,102,241,0.5)", "Pendientes"]].map(([c, l]) => (
          <span key={l} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: c, display: "inline-block" }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function AcceptBar({ rate }: { rate: number }) {
  const color = rate >= 75 ? "var(--success)" : rate >= 50 ? "var(--warning)" : "var(--danger)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "flex-end" }}>
      <div style={{ width: "72px", height: "5px", borderRadius: "3px", backgroundColor: "var(--border-color)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${rate}%`, backgroundColor: color, transition: "width 0.6s ease" }} />
      </div>
      <span style={{ fontWeight: 700, color, minWidth: "32px", textAlign: "right", fontSize: "0.8125rem" }}>{rate}%</span>
    </div>
  );
}

function TemporalBarChart({ buckets }: { buckets: WeekBucket[] }) {
  if (buckets.length < 2) return (
    <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.875rem" }}>
      Se necesitan datos de al menos 2 semanas para mostrar la evolución temporal.
    </div>
  );
  const maxVal = Math.max(...buckets.map(b => b.accepted + b.rejected), 1);
  const W = 60; const H = 120; const GAP = 8;
  const totalW = buckets.length * (W + GAP) + GAP;
  return (
    <svg width="100%" viewBox={`0 0 ${totalW} ${H + 28}`} style={{ overflow: "visible" }}>
      {buckets.map((b, i) => {
        const x = GAP + i * (W + GAP);
        const acceptH = Math.round((b.accepted / maxVal) * H);
        const rejectH = Math.round((b.rejected / maxVal) * H);
        return (
          <g key={b.label}>
            {rejectH > 0 && <rect x={x + 2} y={H - rejectH} width={W - 4} height={rejectH} rx={3} fill="rgba(239,68,68,0.2)" />}
            {acceptH > 0 && <rect x={x + 2} y={H - acceptH} width={W - 4} height={acceptH} rx={3} fill="var(--success)" opacity={0.85} />}
            <text x={x + W / 2} y={H + 16} textAnchor="middle" fontSize={9} fill="var(--text-muted)">{b.label}</text>
            {b.accepted + b.rejected > 0 && (
              <text x={x + W / 2} y={H - Math.max(acceptH, rejectH) - 4} textAnchor="middle" fontSize={9} fill="var(--text-main)" fontWeight={600}>
                {b.accepted + b.rejected}
              </text>
            )}
          </g>
        );
      })}
      <line x1={0} y1={H} x2={totalW} y2={H} stroke="var(--border-color)" strokeWidth={1} />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, icon: Icon, color, textColor }: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color: string; textColor: string;
}) {
  return (
    <div className="card-static" style={{ padding: "1.125rem 1.25rem", display: "flex", alignItems: "center", gap: "0.875rem" }}>
      <div style={{ width: "40px", height: "40px", borderRadius: "var(--radius-lg)", backgroundColor: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={18} strokeWidth={1.75} style={{ color: textColor }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "1.375rem", fontWeight: 700, color: textColor, lineHeight: 1.2 }}>{value}</div>
        <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>{label}</div>
        {sub && <div style={{ fontSize: "0.65rem", color: textColor, marginTop: "0.15rem", fontWeight: 600 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { role, organizationId } = useAuth();
  const [activeTab, setActiveTab] = useState<"global" | "editores" | "manuscrito">("global");

  // Org / global state
  const [kpis, setKpis] = useState<OrgKPIs | null>(null);
  const [loadingGlobal, setLoadingGlobal] = useState(false);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [weekBuckets, setWeekBuckets] = useState<WeekBucket[]>([]);

  // Per-manuscript state
  const [books, setBooks] = useState<BookMeta[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string>("");
  const [msAnalytics, setMsAnalytics] = useState<ManuscriptAnalytics | null>(null);
  const [loadingMs, setLoadingMs] = useState(false);

  // Per-editor state
  const [selectedEditorId, setSelectedEditorId] = useState<string>("");

  const isSuperAdmin = role === "SuperAdmin";
  const isAdmin = role === "SuperAdmin" || role === "Responsable_Editorial";

  // Fetch global KPIs
  const fetchGlobal = useCallback(async (orgId: string) => {
    if (!orgId) return;
    setLoadingGlobal(true);
    try {
      const [data, records] = await Promise.all([computeOrgKPIs(orgId), getOrgCorrections(orgId)]);
      setKpis(data);
      setWeekBuckets(groupByWeek(records));
    } catch (err) {
      console.error("Error fetching KPIs:", err);
    } finally {
      setLoadingGlobal(false);
    }
  }, []);

  // Fetch books list
  const fetchBooks = useCallback(async (orgId: string) => {
    if (!orgId) return;
    const snap = await getDocs(collection(db, "organizations", orgId, "books"));
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as BookMeta))
      .sort((a, b) => (b.createdAt?.toDate?.()?.getTime() ?? 0) - (a.createdAt?.toDate?.()?.getTime() ?? 0));
    setBooks(list);
    if (list.length > 0 && !selectedBookId) setSelectedBookId(list[0].id);
  }, [selectedBookId]);

  // Fetch per-manuscript analytics
  const fetchManuscript = useCallback(async (orgId: string, bookId: string) => {
    if (!orgId || !bookId) return;
    setLoadingMs(true);
    try {
      const bookDoc = await getDoc(doc(db, "organizations", orgId, "books", bookId));
      const book = { id: bookDoc.id, ...bookDoc.data() } as BookMeta;

      const chunksSnap = await getDocs(
        query(collection(db, "organizations", orgId, "books", bookId, "chunks"), orderBy("order", "asc"))
      );
      const chunks = chunksSnap.docs.map(d => ({ id: d.id, ...d.data() } as Chunk));
      setMsAnalytics(computeManuscriptAnalytics(book, chunks));
    } catch (err) {
      console.error("Error fetching manuscript analytics:", err);
    } finally {
      setLoadingMs(false);
    }
  }, []);

  // Init
  useEffect(() => {
    async function init() {
      let orgId = organizationId ?? "";
      if (isSuperAdmin) {
        const orgList = await getOrganizations();
        setOrgs(orgList);
        if (orgList.length > 0) orgId = orgList[0].id;
      }
      if (orgId) {
        setSelectedOrgId(orgId);
        await Promise.all([fetchGlobal(orgId), fetchBooks(orgId)]);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, organizationId]);

  // Load manuscript when selection changes
  useEffect(() => {
    if (selectedOrgId && selectedBookId) fetchManuscript(selectedOrgId, selectedBookId);
  }, [selectedOrgId, selectedBookId, fetchManuscript]);

  const handleOrgChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedOrgId(id);
    setSelectedBookId("");
    setMsAnalytics(null);
    await Promise.all([fetchGlobal(id), fetchBooks(id)]);
  };

  const ms = msAnalytics;

  const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    draft: { label: "En proceso", color: "#f59e0b" },
    processing: { label: "En proceso", color: "#f59e0b" },
    review_editor: { label: "En revisión", color: "#6366f1" },
    review_author: { label: "Revisión autor", color: "#06b6d4" },
    approved: { label: "Aprobado", color: "#10b981" },
    error: { label: "Error", color: "#ef4444" },
  };

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "1200px", margin: "0 auto" }}>

      {/* ── Header ── */}
      <div className="page-header" style={{ marginBottom: "1.75rem" }}>
        <div>
          <h1>Analítica Editorial</h1>
          <p>KPIs de eficiencia y efectividad del pipeline de corrección IA.</p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          {isSuperAdmin && orgs.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Building2 size={14} style={{ color: "var(--text-muted)" }} />
              <select className="input" value={selectedOrgId} onChange={handleOrgChange} style={{ maxWidth: "220px", marginBottom: 0 }}>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          <button className="btn btn-secondary" onClick={() => { fetchGlobal(selectedOrgId); fetchBooks(selectedOrgId); }} title="Actualizar">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "2rem", borderBottom: "1px solid var(--border-color)", paddingBottom: 0 }}>
        {([
          { id: "global",      label: "Vista Global",     icon: BarChart3 },
          { id: "editores",    label: "Editores",         icon: UserCheck },
          { id: "manuscrito", label: "Por Manuscrito",   icon: BookOpen },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: "flex", alignItems: "center", gap: "0.375rem",
              padding: "0.625rem 1.125rem",
              fontSize: "0.875rem", fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? "var(--primary)" : "var(--text-muted)",
              background: "none", border: "none", cursor: "pointer",
              transition: "color 0.15s",
              borderBottomStyle: "solid" as const,
              borderBottomWidth: "2px",
              borderBottomColor: activeTab === tab.id ? "var(--primary)" : "transparent",
              marginBottom: "-1px",
            }}
          >
            <tab.icon size={15} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB: EDITORES                                                     */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "editores" && (() => {
        const editors = kpis?.editors ?? [];
        const maxReviewed = Math.max(...editors.map(e => e.totalReviewed), 1);

        // Books for the selected editor
        const editorBooks = selectedEditorId
          ? books.filter(b => b.assignedEditorId === selectedEditorId)
          : [];

        const selectedEditor = editors.find(e => e.editorId === selectedEditorId);

        return (
          <>
            {/* ── 1. Productivity Overview ── */}
            <div className="card-static" style={{ padding: 0, overflow: "hidden", marginBottom: "1.5rem" }}>
              <div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)" }}>
                  Productividad del equipo editorial
                </h2>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{editors.length} editor{editors.length !== 1 ? "es" : ""}</span>
              </div>

              {editors.length === 0 ? (
                <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                  Aún no hay correcciones revisadas. Una vez los editores acepten o rechacen sugerencias aparecerán aquí.
                </div>
              ) : (
                <>
                  {/* Editor bar chart */}
                  <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border-color)" }}>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.875rem" }}>
                      Correcciones revisadas por editor
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      {editors.map(e => {
                        const accColor = e.acceptRate >= 75 ? "#10b981" : e.acceptRate >= 50 ? "#f59e0b" : "#ef4444";
                        return (
                          <div key={e.editorId}
                            style={{ cursor: "pointer" }}
                            onClick={() => setSelectedEditorId(e.editorId === selectedEditorId ? "" : e.editorId)}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.2rem" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <div style={{
                                  width: "6px", height: "6px", borderRadius: "50%",
                                  backgroundColor: e.editorId === selectedEditorId ? "var(--primary)" : "var(--border-color)",
                                  transition: "background 0.2s",
                                }} />
                                <span style={{ fontSize: "0.8125rem", fontWeight: e.editorId === selectedEditorId ? 700 : 500, color: "var(--text-main)" }}>
                                  {e.editorName}
                                </span>
                                <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{e.editorEmail}</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", fontSize: "0.78rem" }}>
                                <span style={{ color: "var(--text-muted)" }}>{e.totalReviewed} revisadas</span>
                                <span style={{ color: "#10b981", fontWeight: 700 }}>{e.accepted} ✓</span>
                                <span style={{ color: "#ef4444" }}>{e.rejected} ✗</span>
                                <span style={{ fontWeight: 700, color: accColor, minWidth: "36px", textAlign: "right" }}>{e.acceptRate}%</span>
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: "2px", height: "8px", borderRadius: "4px", overflow: "hidden", backgroundColor: "var(--border-color)" }}>
                              <div style={{
                                width: `${Math.round((e.accepted / maxReviewed) * 100)}%`,
                                backgroundColor: "#10b981",
                                transition: "width 0.6s ease",
                              }} />
                              <div style={{
                                width: `${Math.round((e.rejected / maxReviewed) * 100)}%`,
                                backgroundColor: "rgba(239,68,68,0.6)",
                                transition: "width 0.6s ease",
                              }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.875rem", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}><span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#10b981", display: "inline-block" }} /> Aceptadas</span>
                      <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}><span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "rgba(239,68,68,0.6)", display: "inline-block" }} /> Rechazadas</span>
                      <span style={{ color: "var(--primary)", marginLeft: "auto" }}>Haz clic en un editor para ver su detalle →</span>
                    </div>
                  </div>

                  {/* Summary table */}
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                        {["Editor", "Revisadas", "Aceptadas", "Rechazadas", "Tasa", "Regla top"].map(h => (
                          <th key={h} style={{ padding: "0.6rem 1.25rem", textAlign: h === "Editor" || h === "Regla top" ? "left" : "right", fontWeight: 600, color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {editors.map(e => (
                        <tr
                          key={e.editorId}
                          style={{ borderBottom: "1px solid var(--border-color)", cursor: "pointer", backgroundColor: e.editorId === selectedEditorId ? "rgba(99,102,241,0.05)" : "transparent" }}
                          onClick={() => setSelectedEditorId(e.editorId === selectedEditorId ? "" : e.editorId)}
                        >
                          <td style={{ padding: "0.7rem 1.25rem" }}>
                            <div style={{ fontWeight: 600, color: "var(--text-main)" }}>{e.editorName}</div>
                          </td>
                          <td style={{ padding: "0.7rem 1.25rem", textAlign: "right", fontWeight: 600 }}>{e.totalReviewed}</td>
                          <td style={{ padding: "0.7rem 1.25rem", textAlign: "right", color: "#10b981", fontWeight: 600 }}>{e.accepted}</td>
                          <td style={{ padding: "0.7rem 1.25rem", textAlign: "right", color: "#ef4444", fontWeight: 600 }}>{e.rejected}</td>
                          <td style={{ padding: "0.7rem 1.25rem" }}><AcceptBar rate={e.acceptRate} /></td>
                          <td style={{ padding: "0.7rem 1.25rem" }}>
                            <span style={{ padding: "0.15rem 0.5rem", backgroundColor: "var(--primary-light)", color: "var(--primary)", borderRadius: "99px", fontSize: "0.7rem", fontWeight: 600, maxWidth: "160px", display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {e.topRule.startsWith("RAE:") ? e.topRule.replace("RAE:", "") : e.topRule}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>

            {/* ── 2. Per-editor drill-down ── */}
            {selectedEditorId && selectedEditor && (
              <div style={{ marginBottom: "1.5rem" }}>
                {/* Editor header */}
                <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
                  <div style={{ width: "44px", height: "44px", borderRadius: "50%", backgroundColor: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <UserCheck size={20} style={{ color: "var(--primary)" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: "1.0625rem", fontWeight: 700, color: "var(--text-main)" }}>{selectedEditor.editorName}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{selectedEditor.editorEmail}</div>
                  </div>
                  <button
                    onClick={() => setSelectedEditorId("")}
                    style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.8rem" }}
                  >
                    ✕ Cerrar detalle
                  </button>
                </div>

                {/* Editor KPI strip */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.875rem", marginBottom: "1.25rem" }}>
                  {[
                    { label: "Revisadas", value: String(selectedEditor.totalReviewed), color: "#6366f1" },
                    { label: "Aceptadas", value: String(selectedEditor.accepted), color: "#10b981" },
                    { label: "Rechazadas", value: String(selectedEditor.rejected), color: "#ef4444" },
                    { label: "Tasa aceptación", value: `${selectedEditor.acceptRate}%`, color: selectedEditor.acceptRate >= 75 ? "#10b981" : selectedEditor.acceptRate >= 50 ? "#f59e0b" : "#ef4444" },
                  ].map(s => (
                    <div key={s.label} className="card-static" style={{ padding: "0.875rem 1rem", textAlign: "center" }}>
                      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Manuscripts assigned to this editor */}
                <div className="card-static" style={{ overflow: "hidden" }}>
                  <div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid var(--border-color)" }}>
                    <h3 style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--text-main)" }}>
                      Manuscritos asignados — {editorBooks.length === 0 ? "ninguno" : `${editorBooks.length}`}
                    </h3>
                  </div>
                  {editorBooks.length === 0 ? (
                    <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                      No hay manuscritos asignados a este editor aún.
                    </div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                          {["Manuscrito", "Autor", "Estado", "Fecha"].map(h => (
                            <th key={h} style={{ padding: "0.6rem 1.25rem", textAlign: "left", fontWeight: 600, color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {editorBooks.map(b => {
                          const STATUS_LABELS: Record<string, { label: string; color: string }> = {
                            draft: { label: "En proceso", color: "#f59e0b" },
                            processing: { label: "En proceso", color: "#f59e0b" },
                            review_editor: { label: "En revisión", color: "#6366f1" },
                            review_author: { label: "Rev. autor", color: "#06b6d4" },
                            approved: { label: "Aprobado", color: "#10b981" },
                            error: { label: "Error", color: "#ef4444" },
                          };
                          const st = STATUS_LABELS[b.status] ?? { label: b.status, color: "var(--text-muted)" };
                          return (
                            <tr key={b.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                              <td style={{ padding: "0.7rem 1.25rem", fontWeight: 600, color: "var(--text-main)" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                  <FileText size={12} style={{ color: "var(--primary)", flexShrink: 0 }} />
                                  {b.title}
                                </div>
                              </td>
                              <td style={{ padding: "0.7rem 1.25rem", color: "var(--text-muted)", fontSize: "0.78rem" }}>
                                {b.authorName ?? "—"}
                              </td>
                              <td style={{ padding: "0.7rem 1.25rem" }}>
                                <span style={{ padding: "0.15rem 0.5rem", backgroundColor: `${st.color}22`, color: st.color, borderRadius: "99px", fontSize: "0.7rem", fontWeight: 700 }}>
                                  {st.label}
                                </span>
                              </td>
                              <td style={{ padding: "0.7rem 1.25rem", color: "var(--text-muted)", fontSize: "0.78rem" }}>
                                {b.createdAt?.toDate?.()?.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) ?? "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB: POR MANUSCRITO                                               */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "manuscrito" && (
        <>
          {/* Manuscript selector */}
          <div className="card-static" style={{ padding: "0.875rem 1.25rem", marginBottom: "1.75rem", display: "flex", alignItems: "center", gap: "1rem" }}>
            <FileText size={16} style={{ color: "var(--primary)", flexShrink: 0 }} />
            <select
              className="input"
              value={selectedBookId}
              onChange={e => setSelectedBookId(e.target.value)}
              style={{ flex: 1, maxWidth: "480px", marginBottom: 0, fontWeight: 600 }}
            >
              <option value="">— Seleccionar manuscrito —</option>
              {books.map(b => (
                <option key={b.id} value={b.id}>{b.title} {b.authorName ? `(${b.authorName})` : ""}</option>
              ))}
            </select>
            {ms && (
              <span style={{
                fontSize: "0.7rem", fontWeight: 700, padding: "0.2rem 0.6rem", borderRadius: "99px",
                backgroundColor: `${STATUS_LABELS[ms.book.status]?.color ?? "var(--text-muted)"}22`,
                color: STATUS_LABELS[ms.book.status]?.color ?? "var(--text-muted)",
              }}>
                {STATUS_LABELS[ms.book.status]?.label ?? ms.book.status}
              </span>
            )}
          </div>

          {loadingMs ? (
            <div style={{ padding: "4rem", textAlign: "center", color: "var(--text-muted)" }}>Calculando métricas del manuscrito…</div>
          ) : !ms ? (
            <div style={{ padding: "4rem", textAlign: "center", color: "var(--text-muted)" }}>
              {books.length === 0 ? "No hay manuscritos en esta editorial." : "Selecciona un manuscrito para ver su analítica."}
            </div>
          ) : (
            <>
              {/* ── Book meta strip ── */}
              <div className="card-static" style={{ padding: "1rem 1.5rem", marginBottom: "1.5rem", display: "flex", gap: "2rem", flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Autor</div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)" }}>{ms.book.authorName ?? "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Editor asignado</div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600, color: ms.book.assignedEditorName ? "#6366f1" : "var(--text-muted)" }}>{ms.book.assignedEditorName ?? "Sin asignar"}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Segmentos</div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)" }}>
                    {ms.book.processedChunks ?? "—"} / {ms.book.totalChunks ?? ms.chunks.length} procesados
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Fecha subida</div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)" }}>
                    {ms.book.createdAt?.toDate?.()?.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) ?? "—"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Densidad editorial</div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)" }}>{ms.editorialDensity} sug/1000c</div>
                </div>
              </div>

              {/* ── KPI Cards ── */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "1rem", marginBottom: "1.75rem" }}>
                <KPICard label="Total sugerencias" value={String(ms.totalSuggestions)} icon={Target} color="rgba(99,102,241,0.1)" textColor="#6366f1" />
                <KPICard label="Tasa aceptación" value={`${ms.acceptRate}%`} sub={`${ms.accepted} aceptadas`} icon={CheckCircle2} color="rgba(16,185,129,0.1)" textColor="#10b981" />
                <KPICard label="Tasa rechazo" value={`${ms.rejectRate}%`} sub={`${ms.rejected} rechazadas`} icon={XCircle} color="rgba(239,68,68,0.1)" textColor="#ef4444" />
                <KPICard label="Pendientes de revisión" value={String(ms.pending)} icon={Clock} color="rgba(245,158,11,0.1)" textColor="#f59e0b" />
                <KPICard label="Sugerencias/segmento" value={ms.chunks.length > 0 ? (ms.totalSuggestions / ms.chunks.length).toFixed(1) : "0"} icon={Layers} color="rgba(6,182,212,0.1)" textColor="#06b6d4" />
                <KPICard label="Reglas aplicadas" value={String(ms.topRules.length)} icon={Tag} color="rgba(168,85,247,0.1)" textColor="#a855f7" />
              </div>

              {/* ── Main analysis grid ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>

                {/* Donut */}
                <div className="card-static" style={{ padding: "1.25rem" }}>
                  <h3 style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                    <PieChart size={14} style={{ color: "var(--primary)" }} /> Estado sugerencias
                  </h3>
                  <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
                    <DonutChart accepted={ms.accepted} rejected={ms.rejected} pending={ms.pending} size={96} />
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.78rem" }}>
                      {[
                        { c: "#10b981", l: "Aceptadas", v: ms.accepted },
                        { c: "#ef4444", l: "Rechazadas", v: ms.rejected },
                        { c: "#6366f1", l: "Pendientes", v: ms.pending },
                      ].map(({ c, l, v }) => (
                        <div key={l} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: c, display: "inline-block", flexShrink: 0 }} />
                          <span style={{ color: "var(--text-muted)" }}>{l}</span>
                          <span style={{ fontWeight: 700, color: "var(--text-main)", marginLeft: "auto" }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* By source */}
                <div className="card-static" style={{ padding: "1.25rem" }}>
                  <h3 style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                    <Zap size={14} style={{ color: "var(--primary)" }} /> Por fuente de detección
                  </h3>
                  {ms.bySource.length === 0 ? (
                    <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Sin datos</div>
                  ) : (
                    <HorizBar items={ms.bySource.map(s => ({ label: s.name, count: s.count, color: s.color }))} maxCount={Math.max(...ms.bySource.map(s => s.count), 1)} />
                  )}
                </div>

                {/* By risk */}
                <div className="card-static" style={{ padding: "1.25rem" }}>
                  <h3 style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                    <AlertTriangle size={14} style={{ color: "var(--primary)" }} /> Por nivel de riesgo
                  </h3>
                  <HorizBar items={ms.byRisk} maxCount={Math.max(...ms.byRisk.map(r => r.count), 1)} />
                  <div style={{ marginTop: "1rem", padding: "0.625rem", backgroundColor: "rgba(99,102,241,0.06)", borderRadius: "var(--radius)", fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    <strong style={{ color: "var(--text-main)" }}>Riesgo alto</strong> = el agente detectó que la corrección puede alterar la voz del autor o es cuestionable.
                  </div>
                </div>
              </div>

              {/* ── Top rules + Voice profile ── */}
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
                {/* Top rules */}
                <div className="card-static" style={{ padding: "1.25rem" }}>
                  <h3 style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                    <Tag size={14} style={{ color: "var(--primary)" }} /> Top reglas editoriales aplicadas
                  </h3>
                  {ms.topRules.length === 0 ? (
                    <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>No hay reglas identificadas aún.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      {ms.topRules.map((r, i) => (
                        <div key={r.rule} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                          <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--text-muted)", width: "16px", textAlign: "right" }}>#{i + 1}</span>
                          <span style={{ padding: "0.2rem 0.6rem", backgroundColor: "var(--primary-light)", color: "var(--primary)", borderRadius: "99px", fontSize: "0.72rem", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.rule.length > 48 ? r.rule.slice(0, 48) + "…" : r.rule}
                          </span>
                          <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-main)", flexShrink: 0 }}>{r.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Voice profile */}
                <div className="card-static" style={{ padding: "1.25rem" }}>
                  <h3 style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                    <Activity size={14} style={{ color: "var(--primary)" }} /> Voz del autor (perfil IA)
                  </h3>
                  {!ms.book.voiceProfile ? (
                    <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                      El Voice Profile se genera al procesar el manuscrito con el pipeline V2.
                    </div>
                  ) : (
                    <>
                      {ms.book.voiceProfile.resumen && (
                        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.55, marginBottom: "0.875rem" }}>
                          {ms.book.voiceProfile.resumen}
                        </p>
                      )}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                        {(ms.book.voiceProfile.rasgos_clave ?? []).map(r => (
                          <span key={r} style={{ padding: "0.2rem 0.55rem", backgroundColor: "rgba(168,85,247,0.1)", color: "#a855f7", borderRadius: "99px", fontSize: "0.7rem", fontWeight: 600 }}>
                            {r.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* ── Chunk timeline ── */}
              <div className="card-static" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
                <h3 style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                  <TrendingUp size={14} style={{ color: "var(--primary)" }} /> Distribución de correcciones por segmento
                </h3>
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
                  Cada barra = un segmento del manuscrito. Permite detectar secciones con mayor densidad de errores.
                </p>
                <ChunkTimeline byChunk={ms.byChunk} />
              </div>

              {/* ── Per-chunk table (top 10 most problematic) ── */}
              {ms.byChunk.some(c => c.accepted + c.rejected + c.pending > 0) && (
                <div className="card-static" style={{ overflow: "hidden", marginBottom: "1.5rem" }}>
                  <div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid var(--border-color)" }}>
                    <h3 style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--text-main)" }}>
                      Top segmentos por volumen de correcciones
                    </h3>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                        {["Seg.", "Total", "Aceptadas", "Rechazadas", "Pendientes", "Tasa aceptación"].map(h => (
                          <th key={h} style={{ padding: "0.6rem 1.25rem", textAlign: h === "Seg." ? "left" : "right", fontWeight: 600, color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ms.byChunk
                        .map((c, i) => ({ ...c, total: c.accepted + c.rejected + c.pending, i }))
                        .filter(c => c.total > 0)
                        .sort((a, b) => b.total - a.total)
                        .slice(0, 10)
                        .map(c => (
                          <tr key={c.i} style={{ borderBottom: "1px solid var(--border-color)" }}>
                            <td style={{ padding: "0.6rem 1.25rem", fontWeight: 600, color: "var(--text-main)" }}>Seg. {c.i + 1}</td>
                            <td style={{ padding: "0.6rem 1.25rem", textAlign: "right", fontWeight: 700 }}>{c.total}</td>
                            <td style={{ padding: "0.6rem 1.25rem", textAlign: "right", color: "#10b981", fontWeight: 600 }}>{c.accepted}</td>
                            <td style={{ padding: "0.6rem 1.25rem", textAlign: "right", color: "#ef4444", fontWeight: 600 }}>{c.rejected}</td>
                            <td style={{ padding: "0.6rem 1.25rem", textAlign: "right", color: "#f59e0b" }}>{c.pending}</td>
                            <td style={{ padding: "0.6rem 1.25rem" }}>
                              <AcceptBar rate={c.total > 0 ? Math.round((c.accepted / c.total) * 100) : 0} />
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB: GLOBAL                                                        */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "global" && (
        <>
          {loadingGlobal ? (
            <div style={{ padding: "4rem", textAlign: "center", color: "var(--text-muted)" }}>Calculando métricas…</div>
          ) : !kpis ? (
            <div style={{ padding: "4rem", textAlign: "center", color: "var(--text-muted)" }}>Sin datos disponibles.</div>
          ) : (
            <>
              {/* Global KPI Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
                {[
                  { label: "Correcciones Totales", value: String(kpis.totalCorrections), icon: BarChart3, color: "var(--primary-light)", textColor: "var(--primary)" },
                  { label: "Tasa de Aceptación Global", value: `${kpis.globalAcceptRate}%`, icon: TrendingUp, color: "rgba(16,185,129,0.1)", textColor: "var(--success)" },
                  { label: "Editores Activos", value: String(kpis.activeEditors), icon: UserCheck, color: "rgba(59,130,246,0.1)", textColor: "#3b82f6" },
                  { label: "Regla Más Frecuente", value: kpis.topRule === "—" ? "Sin datos" : (kpis.topRule.length > 18 ? kpis.topRule.slice(0, 18) + "…" : kpis.topRule), icon: AlertTriangle, color: "rgba(245,158,11,0.1)", textColor: "var(--warning)" },
                ].map(s => (
                  <KPICard key={s.label} {...s} />
                ))}
              </div>

              {/* Summary cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "2rem" }}>
                <div className="card-static" style={{ padding: "1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
                  <CheckCircle2 size={28} style={{ color: "var(--success)", flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{kpis.totalAccepted}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Correcciones aceptadas</div>
                  </div>
                </div>
                <div className="card-static" style={{ padding: "1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
                  <XCircle size={28} style={{ color: "var(--danger)", flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{kpis.totalRejected}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Correcciones rechazadas</div>
                  </div>
                </div>
              </div>

              {/* Weekly chart */}
              <div className="card-static" style={{ marginBottom: "2rem", padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "1.25rem 1.75rem", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 style={{ fontSize: "1rem", fontWeight: 700 }}>Evolución Semanal</h2>
                  <div style={{ display: "flex", gap: "1rem", fontSize: "0.75rem" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}><span style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: "var(--success)", display: "inline-block" }} /> Aceptadas</span>
                    <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}><span style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: "rgba(239,68,68,0.3)", display: "inline-block" }} /> Rechazadas</span>
                  </div>
                </div>
                <div style={{ padding: "1.5rem 2rem" }}><TemporalBarChart buckets={weekBuckets} /></div>
              </div>

              {/* Editor performance table */}
              <div className="card-static" style={{ overflow: "hidden" }}>
                <div style={{ padding: "1.25rem 1.75rem", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h2 style={{ fontSize: "1rem", fontWeight: 700 }}>Rendimiento por Editor</h2>
                  <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>{kpis.editors.length} editores</span>
                </div>
                {kpis.editors.length === 0 ? (
                  <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                    Aún no hay correcciones revisadas.
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                        {["Editor", "Revisadas", "Aceptadas", "Tasa aceptación", "Regla más aplicada"].map(h => (
                          <th key={h} style={{ padding: "0.75rem 1.25rem", textAlign: h === "Editor" || h === "Regla más aplicada" ? "left" : "right", fontWeight: 600, color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {kpis.editors.map(e => (
                        <tr key={e.editorId} style={{ borderBottom: "1px solid var(--border-color)" }}>
                          <td style={{ padding: "0.875rem 1.25rem" }}>
                            <div style={{ fontWeight: 600, color: "var(--text-main)" }}>{e.editorName}</div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{e.editorEmail}</div>
                          </td>
                          <td style={{ padding: "0.875rem 1.25rem", textAlign: "right", fontWeight: 600 }}>{e.totalReviewed}</td>
                          <td style={{ padding: "0.875rem 1.25rem", textAlign: "right", color: "var(--success)", fontWeight: 600 }}>{e.accepted}</td>
                          <td style={{ padding: "0.875rem 1.25rem" }}><AcceptBar rate={e.acceptRate} /></td>
                          <td style={{ padding: "0.875rem 1.25rem" }}>
                            <span style={{ padding: "0.2rem 0.625rem", backgroundColor: "var(--primary-light)", color: "var(--primary)", borderRadius: "var(--radius-full)", fontSize: "0.75rem", fontWeight: 600, maxWidth: "160px", display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {e.topRule.startsWith("RAE:") ? e.topRule.replace("RAE:", "") : e.topRule}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </>
      )}

      {!isAdmin && (
        <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
          Acceso restringido a Responsables Editoriales.
        </div>
      )}
    </div>
  );
}
