"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  Scale, CheckCircle2, XCircle, FilePlus2, Lightbulb,
  BookOpen, CheckCheck,
} from "lucide-react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, writeBatch } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Category = "style" | "grammar" | "format" | "typography" | "all";

type Criterion = {
  id: string;
  name?: string;
  rule?: string;
  description: string;
  category?: Category;
  status: "active" | "pending";
  source?: string;
};

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  style:      { label: "Estilo",      color: "#a855f7" },
  grammar:    { label: "Gramática",   color: "#10b981" },
  format:     { label: "Formato",     color: "#f59e0b" },
  typography: { label: "Tipografía",  color: "#06b6d4" },
};

function CategoryBadge({ category }: { category?: string }) {
  const cat = CATEGORY_LABELS[category ?? ""] ?? { label: category ?? "General", color: "var(--text-muted)" };
  return (
    <span style={{
      fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
      padding: "0.2rem 0.6rem", borderRadius: "99px",
      backgroundColor: `${cat.color}18`, color: cat.color, border: `1px solid ${cat.color}30`,
      flexShrink: 0,
    }}>
      {cat.label}
    </span>
  );
}

export default function CriteriaPage() {
  const { role, organizationId } = useAuth();
  const [activeRules, setActiveRules] = useState<Criterion[]>([]);
  const [pendingRules, setPendingRules] = useState<Criterion[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [correctedFile, setCorrectedFile] = useState<File | null>(null);

  const [pendingFilter, setPendingFilter] = useState<Category>("all");
  const [activeFilter, setActiveFilter] = useState<Category>("all");
  const [approvingAll, setApprovingAll] = useState(false);

  const canManage = role === "SuperAdmin" || role === "Admin" || role === "Responsable_Editorial";

  useEffect(() => {
    if (!organizationId) return;

    const pendingRef = collection(db, "organizations", organizationId, "pendingRules");
    const unsubPending = onSnapshot(pendingRef, (snap) => {
      setPendingRules(snap.docs.map(d => ({ id: d.id, ...d.data() } as Criterion)));
    });

    const activeRef = collection(db, "organizations", organizationId, "rules");
    const unsubActive = onSnapshot(activeRef, (snap) => {
      setActiveRules(snap.docs.map(d => ({ id: d.id, ...d.data() } as Criterion)));
    });

    return () => { unsubPending(); unsubActive(); };
  }, [organizationId]);

  const filteredPending = useMemo(() =>
    pendingFilter === "all" ? pendingRules : pendingRules.filter(r => r.category === pendingFilter),
    [pendingRules, pendingFilter]
  );

  const filteredActive = useMemo(() =>
    activeFilter === "all" ? activeRules : activeRules.filter(r => r.category === activeFilter),
    [activeRules, activeFilter]
  );

  const getRuleName = (rule: Criterion) => rule.name ?? rule.rule ?? "Regla sin nombre";

  const handleAction = async (rule: Criterion, action: "approved" | "rejected") => {
    if (!organizationId) return;
    try {
      if (action === "approved") {
        await setDoc(doc(db, "organizations", organizationId, "rules", rule.id), {
          name: getRuleName(rule),
          rule: getRuleName(rule),
          description: rule.description,
          category: rule.category ?? "style",
          source: rule.source ?? null,
          status: "active",
        });
      }
      await deleteDoc(doc(db, "organizations", organizationId, "pendingRules", rule.id));
    } catch (error) {
      console.error("Error updating rule:", error);
      alert("Error al actualizar la regla.");
    }
  };

  const handleApproveAll = async () => {
    if (!organizationId || filteredPending.length === 0) return;
    setApprovingAll(true);
    try {
      const batch = writeBatch(db);
      for (const rule of filteredPending) {
        const ruleRef = doc(db, "organizations", organizationId, "rules", rule.id);
        batch.set(ruleRef, {
          name: getRuleName(rule), rule: getRuleName(rule),
          description: rule.description, category: rule.category ?? "style",
          source: rule.source ?? null, status: "active",
        });
        batch.delete(doc(db, "organizations", organizationId, "pendingRules", rule.id));
      }
      await batch.commit();
    } catch (err) {
      console.error(err);
      alert("Error en aprobación masiva.");
    } finally {
      setApprovingAll(false);
    }
  };

  const handleExtraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!originalFile || !correctedFile || !organizationId) {
      alert("Sube el manuscrito original y el corregido.");
      return;
    }
    setIsExtracting(true);
    try {
      const origRef = ref(storage, `organizations/${organizationId}/uploads/original_${Date.now()}.docx`);
      await uploadBytes(origRef, originalFile);
      const originalUrl = await getDownloadURL(origRef);

      const corrRef = ref(storage, `organizations/${organizationId}/uploads/corrected_${Date.now()}.docx`);
      await uploadBytes(corrRef, correctedFile);
      const correctedUrl = await getDownloadURL(corrRef);

      const response = await fetch(`${API_URL}/api/v1/extract-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, originalFileUrl: originalUrl, correctedFileUrl: correctedUrl }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "API extraction failed");
      }

      setIsModalOpen(false);
      setOriginalFile(null);
      setCorrectedFile(null);
    } catch (error) {
      console.error(error);
      alert("Error deduciendo normas: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsExtracting(false);
    }
  };

  const categoryTabs = (
    current: Category,
    setter: (c: Category) => void,
    rules: Criterion[]
  ) => {
    const counts: Record<string, number> = { all: rules.length };
    for (const r of rules) counts[r.category ?? "style"] = (counts[r.category ?? "style"] ?? 0) + 1;

    return (
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        {(["all", "style", "grammar", "format", "typography"] as Category[]).map(cat => (
          <button
            key={cat}
            onClick={() => setter(cat)}
            style={{
              padding: "0.3rem 0.875rem", borderRadius: "99px", fontSize: "0.8125rem", fontWeight: 600,
              cursor: "pointer", border: "1px solid",
              borderColor: current === cat ? "var(--primary)" : "var(--border-color)",
              backgroundColor: current === cat ? "var(--primary)" : "transparent",
              color: current === cat ? "white" : "var(--text-muted)",
              display: "flex", alignItems: "center", gap: "0.375rem",
            }}
          >
            {cat === "all" ? "Todas" : CATEGORY_LABELS[cat]?.label}
            <span style={{
              fontSize: "0.7rem", minWidth: "18px", textAlign: "center",
              backgroundColor: current === cat ? "rgba(255,255,255,0.25)" : "var(--primary-light)",
              borderRadius: "99px", padding: "0 0.375rem",
              color: current === cat ? "white" : "var(--primary)",
            }}>
              {counts[cat] ?? 0}
            </span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "1100px", margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1>Criterios Editoriales</h1>
          <p>
            Gestiona las normas gramaticales, ortotipográficas y de estilo de{" "}
            {role === "SuperAdmin" ? "las organizaciones" : "tu editorial"}.
          </p>
        </div>
        {canManage && (
          <button className="btn" style={{ padding: "0.75rem 1.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }} onClick={() => setIsModalOpen(true)}>
            <FilePlus2 size={16} /> Deducir Nuevas Normas
          </button>
        )}
      </div>

      {/* PENDING RULES */}
      {pendingRules.length > 0 && (
        <div style={{ marginBottom: "3rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Lightbulb size={20} style={{ color: "var(--warning)" }} />
              Normas pendientes de aprobación
              <span style={{ fontSize: "0.8125rem", fontWeight: 600, backgroundColor: "rgba(245,158,11,0.12)", color: "var(--warning)", padding: "0.125rem 0.625rem", borderRadius: "99px" }}>
                {pendingRules.length}
              </span>
            </h2>
            {canManage && filteredPending.length > 0 && (
              <button
                className="btn btn-secondary"
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem" }}
                onClick={handleApproveAll}
                disabled={approvingAll}
              >
                <CheckCheck size={15} />
                {approvingAll ? "Aprobando..." : `Aprobar todas (${filteredPending.length})`}
              </button>
            )}
          </div>

          {categoryTabs(pendingFilter, setPendingFilter, pendingRules)}

          <div style={{ display: "grid", gap: "0.875rem" }}>
            {filteredPending.map(rule => (
              <div key={rule.id} className="card fade-in" style={{ padding: "1.25rem 1.5rem", borderLeft: "3px solid var(--warning)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
                    <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)" }}>{getRuleName(rule)}</h3>
                    <CategoryBadge category={rule.category} />
                  </div>
                  {rule.source && (
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", flexShrink: 0, fontStyle: "italic" }}>
                      {rule.source.replace(" Manuscrito.docx", "")}
                    </span>
                  )}
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", lineHeight: 1.6, marginBottom: "1rem" }}>
                  {rule.description}
                </p>
                {canManage && (
                  <div style={{ display: "flex", gap: "0.625rem", justifyContent: "flex-end" }}>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: "0.4rem 1rem", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.375rem" }}
                      onClick={() => handleAction(rule, "rejected")}
                    >
                      <XCircle size={13} /> Rechazar
                    </button>
                    <button
                      className="btn"
                      style={{ padding: "0.4rem 1rem", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.375rem" }}
                      onClick={() => handleAction(rule, "approved")}
                    >
                      <CheckCircle2 size={13} /> Aprobar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ACTIVE RULES */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <BookOpen size={20} style={{ color: "var(--primary)" }} />
            Manual de Estilo Activo
            <span style={{ fontSize: "0.8125rem", fontWeight: 600, backgroundColor: "var(--primary-light)", color: "var(--primary)", padding: "0.125rem 0.625rem", borderRadius: "99px" }}>
              {activeRules.length}
            </span>
          </h2>
        </div>

        {activeRules.length > 0 && categoryTabs(activeFilter, setActiveFilter, activeRules)}

        {filteredActive.length === 0 ? (
          <div className="card-static" style={{ padding: "3rem", textAlign: "center" }}>
            <Scale size={36} style={{ color: "var(--text-muted)", opacity: 0.4, marginBottom: "1rem" }} />
            <p style={{ color: "var(--text-muted)" }}>
              {activeRules.length === 0
                ? "No hay normas configuradas. Aprueba las pendientes para activarlas."
                : "No hay normas en esta categoría."}
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
            {filteredActive.map(rule => (
              <div key={rule.id} className="card-static" style={{ padding: "1.25rem 1.5rem" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <Scale size={14} style={{ color: "var(--primary)", flexShrink: 0 }} />
                    <h3 style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)" }}>{getRuleName(rule)}</h3>
                  </div>
                  <CategoryBadge category={rule.category} />
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.8375rem", lineHeight: 1.6 }}>
                  {rule.description}
                </p>
                {rule.source && (
                  <p style={{ marginTop: "0.625rem", fontSize: "0.7rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                    Fuente: {rule.source.replace(" Manuscrito.docx", "")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* EXTRACTION MODAL */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="card fade-in modal-content" style={{ maxWidth: "600px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)" }}>Deducción de Normas</h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1.25rem" }}>✕</button>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>
              Sube el manuscrito original y su versión corregida. El motor IA detectará los patrones editoriales y extraerá las normas subyacentes.
            </p>

            <form onSubmit={handleExtraction}>
              <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
                {[
                  { label: "Manuscrito Original (.docx)", file: originalFile, setter: setOriginalFile },
                  { label: "Versión Corregida (.docx)", file: correctedFile, setter: setCorrectedFile },
                ].map(({ label, file, setter }) => (
                  <div key={label} style={{ flex: 1 }}>
                    <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 600, color: "var(--text-main)", fontSize: "0.8125rem" }}>{label}</label>
                    <label className="card-static" style={{
                      cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center",
                      height: "90px", borderStyle: "dashed",
                      backgroundColor: file ? "rgba(99,102,241,0.05)" : "var(--bg-color)",
                      borderColor: file ? "var(--primary)" : "var(--border-color)",
                    }}>
                      <input type="file" accept=".docx" style={{ display: "none" }} onChange={e => setter(e.target.files?.[0] ?? null)} />
                      <span style={{ color: file ? "var(--primary)" : "var(--text-muted)", fontSize: "0.75rem", textAlign: "center", padding: "0.75rem" }}>
                        {file ? file.name : "Seleccionar archivo"}
                      </span>
                    </label>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setIsModalOpen(false)}>Cancelar</button>
                <button type="submit" className="btn" style={{ flex: 1 }} disabled={isExtracting || !originalFile || !correctedFile}>
                  {isExtracting ? "Analizando..." : "Extraer Normas"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
