"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  Scale, CheckCircle2, XCircle, FilePlus2, Lightbulb,
  BookOpen, CheckCheck, PenLine, Trash2, Plus, Download, X,
} from "lucide-react";
import {
  collection, onSnapshot, doc, setDoc, deleteDoc,
  writeBatch, updateDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { saveAs } from "file-saver";

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

const CATEGORIES_LIST = ["style", "grammar", "format", "typography"] as const;

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

type RuleFormData = { name: string; description: string; category: string };
const EMPTY_FORM: RuleFormData = { name: "", description: "", category: "style" };

export default function CriteriaPage() {
  const { role, organizationId } = useAuth();
  const [activeRules, setActiveRules] = useState<Criterion[]>([]);
  const [pendingRules, setPendingRules] = useState<Criterion[]>([]);

  // Filters
  const [pendingFilter, setPendingFilter] = useState<Category>("all");
  const [activeFilter, setActiveFilter] = useState<Category>("all");
  const [approvingAll, setApprovingAll] = useState(false);

  // Extraction modal
  const [isExtractModalOpen, setIsExtractModalOpen] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [correctedFile, setCorrectedFile] = useState<File | null>(null);

  // Manual rule modal (create / edit)
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Criterion | null>(null); // null = create mode
  const [ruleForm, setRuleForm] = useState<RuleFormData>(EMPTY_FORM);
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [ruleError, setRuleError] = useState("");

  // Export
  const [isExporting, setIsExporting] = useState(false);

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

  // ---- Approve pending rule ----
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
        batch.set(doc(db, "organizations", organizationId, "rules", rule.id), {
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

  // ---- Extraction by IA ----
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

      setIsExtractModalOpen(false);
      setOriginalFile(null);
      setCorrectedFile(null);
    } catch (error) {
      alert("Error deduciendo normas: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsExtracting(false);
    }
  };

  // ---- Manual rule CRUD ----
  const openCreateModal = () => {
    setEditingRule(null);
    setRuleForm(EMPTY_FORM);
    setRuleError("");
    setIsRuleModalOpen(true);
  };

  const openEditModal = (rule: Criterion) => {
    setEditingRule(rule);
    setRuleForm({
      name: getRuleName(rule),
      description: rule.description,
      category: rule.category ?? "style",
    });
    setRuleError("");
    setIsRuleModalOpen(true);
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setRuleError("");
    if (!ruleForm.name.trim() || !ruleForm.description.trim()) {
      setRuleError("El nombre y la descripción son obligatorios.");
      return;
    }
    if (!organizationId) return;
    setIsSavingRule(true);
    try {
      const ruleData = {
        name: ruleForm.name.trim(),
        rule: ruleForm.name.trim(),
        description: ruleForm.description.trim(),
        category: ruleForm.category,
        status: "active" as const,
        source: "Manual",
      };

      if (editingRule) {
        // Edit existing
        await updateDoc(doc(db, "organizations", organizationId, "rules", editingRule.id), ruleData);
      } else {
        // Create new with auto-id
        const newRef = doc(collection(db, "organizations", organizationId, "rules"));
        await setDoc(newRef, ruleData);
      }
      setIsRuleModalOpen(false);
    } catch (err) {
      setRuleError("Error al guardar: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSavingRule(false);
    }
  };

  const handleDeleteRule = async (rule: Criterion) => {
    if (!confirm(`¿Eliminar la regla "${getRuleName(rule)}"? Esta acción no se puede deshacer.`)) return;
    if (!organizationId) return;
    try {
      await deleteDoc(doc(db, "organizations", organizationId, "rules", rule.id));
    } catch (err) {
      alert("Error al eliminar: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // ---- Export manual as .docx ----
  const handleExportManual = async () => {
    if (activeRules.length === 0) {
      alert("No hay reglas activas para exportar.");
      return;
    }
    setIsExporting(true);
    try {
      const children: Paragraph[] = [
        new Paragraph({
          text: "Manual de Estilo Editorial",
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 300 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `${activeRules.length} criterios activos`, color: "888888", italics: true })],
          spacing: { after: 600 },
        }),
      ];

      // Group by category
      const grouped: Record<string, Criterion[]> = {};
      for (const rule of activeRules) {
        const cat = rule.category ?? "style";
        grouped[cat] = grouped[cat] ?? [];
        grouped[cat].push(rule);
      }

      for (const [cat, rules] of Object.entries(grouped)) {
        const catLabel = CATEGORY_LABELS[cat]?.label ?? cat;
        children.push(
          new Paragraph({
            text: catLabel,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 400, after: 200 },
          })
        );
        for (const rule of rules) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: `• ${getRuleName(rule)}: `, bold: true }),
                new TextRun(rule.description),
              ],
              spacing: { after: 160 },
            })
          );
        }
      }

      const wordDoc = new Document({ sections: [{ properties: {}, children }] });
      const blob = await Packer.toBlob(wordDoc);
      saveAs(blob, "Manual_de_Estilo.docx");
    } catch (err) {
      alert("Error exportando: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsExporting(false);
    }
  };

  // ---- Category tabs widget ----
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
          <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap", alignItems: "center" }}>
            <button
              className="btn btn-secondary"
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}
              onClick={handleExportManual}
              disabled={isExporting || activeRules.length === 0}
            >
              <Download size={15} /> {isExporting ? "Exportando..." : "Exportar Manual"}
            </button>
            <button
              className="btn btn-secondary"
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}
              onClick={() => setIsExtractModalOpen(true)}
            >
              <FilePlus2 size={15} /> Deducir con IA
            </button>
            <button
              className="btn"
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              onClick={openCreateModal}
            >
              <Plus size={16} /> Nueva Regla Manual
            </button>
          </div>
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
                    <button className="btn btn-secondary" style={{ padding: "0.4rem 1rem", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.375rem" }} onClick={() => handleAction(rule, "rejected")}>
                      <XCircle size={13} /> Rechazar
                    </button>
                    <button className="btn" style={{ padding: "0.4rem 1rem", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.375rem" }} onClick={() => handleAction(rule, "approved")}>
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
                ? "No hay normas configuradas. Crea una manualmente o aprueba las pendientes."
                : "No hay normas en esta categoría."}
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
            {filteredActive.map(rule => (
              <div key={rule.id} className="card-static" style={{ padding: "1.25rem 1.5rem", position: "relative" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", flex: 1 }}>
                    <Scale size={14} style={{ color: "var(--primary)", flexShrink: 0 }} />
                    <h3 style={{ fontSize: "0.9375rem", fontWeight: 700, color: "var(--text-main)" }}>{getRuleName(rule)}</h3>
                  </div>
                  <CategoryBadge category={rule.category} />
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.8375rem", lineHeight: 1.6, marginBottom: rule.source ? "0.5rem" : "0" }}>
                  {rule.description}
                </p>
                {rule.source && (
                  <p style={{ marginTop: "0.5rem", fontSize: "0.7rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                    Fuente: {rule.source.replace(" Manuscrito.docx", "")}
                  </p>
                )}
                {canManage && (
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.875rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-color)" }}>
                    <button
                      className="btn btn-secondary"
                      style={{ flex: 1, padding: "0.35rem 0.5rem", fontSize: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem" }}
                      onClick={() => openEditModal(rule)}
                    >
                      <PenLine size={12} /> Editar
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ flex: 1, padding: "0.35rem 0.5rem", fontSize: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem", borderColor: "rgba(239,68,68,0.3)", color: "var(--danger)" }}
                      onClick={() => handleDeleteRule(rule)}
                    >
                      <Trash2 size={12} /> Eliminar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MODAL: Nueva/Editar Regla Manual */}
      {isRuleModalOpen && (
        <div className="modal-overlay">
          <div className="card fade-in modal-content" style={{ maxWidth: "520px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Scale size={20} style={{ color: "var(--primary)" }} />
                {editingRule ? "Editar Regla" : "Nueva Regla Manual"}
              </h2>
              <button onClick={() => setIsRuleModalOpen(false)} className="btn-ghost" style={{ padding: "0.25rem" }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveRule}>
              <div style={{ display: "grid", gap: "1rem", marginBottom: "1.5rem" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "0.375rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>
                    Nombre de la regla
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={ruleForm.name}
                    onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Ej. Uso de comillas latinas"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.375rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>
                    Descripción / explicación
                  </label>
                  <textarea
                    className="input"
                    value={ruleForm.description}
                    onChange={e => setRuleForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Ej. Usar comillas latinas (« ») en lugar de anglosajones (&quot; &quot;). Las comillas simples se reservan para citas dentro de citas."
                    required
                    rows={4}
                    style={{ resize: "vertical", fontFamily: "inherit" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", marginBottom: "0.375rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)" }}>
                    Categoría
                  </label>
                  <select
                    className="input"
                    value={ruleForm.category}
                    onChange={e => setRuleForm(f => ({ ...f, category: e.target.value }))}
                  >
                    {CATEGORIES_LIST.map(c => (
                      <option key={c} value={c}>{CATEGORY_LABELS[c]?.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {ruleError && (
                <div style={{ color: "var(--danger)", fontSize: "0.875rem", marginBottom: "1rem", padding: "0.625rem 0.875rem", backgroundColor: "rgba(239,68,68,0.08)", borderRadius: "var(--radius-md)" }}>
                  {ruleError}
                </div>
              )}

              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setIsRuleModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn" style={{ flex: 1 }} disabled={isSavingRule}>
                  {isSavingRule ? "Guardando..." : editingRule ? "Guardar Cambios" : "Añadir Regla"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Extracción IA */}
      {isExtractModalOpen && (
        <div className="modal-overlay">
          <div className="card fade-in modal-content" style={{ maxWidth: "600px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text-main)" }}>Deducción de Normas con IA</h2>
              <button onClick={() => setIsExtractModalOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1.25rem" }}>✕</button>
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
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setIsExtractModalOpen(false)}>Cancelar</button>
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
