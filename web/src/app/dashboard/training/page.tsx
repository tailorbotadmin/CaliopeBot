"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { CheckCircle2, XCircle, Eye, FolderOpen, Download, Info } from "lucide-react";
import {
  getTrainingItemsByOrganization, updateTrainingItemStatus,
  TrainingItem, getOrganizations, Organization,
} from "@/lib/firestore";

export default function TrainingPage() {
  const { role, organizationId, user, loading } = useAuth();

  const [items, setItems] = useState<TrainingItem[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (role === "SuperAdmin") {
        const _orgs = await getOrganizations();
        setOrgs(_orgs);
        if (_orgs.length > 0) {
          const fetchedItems = await getTrainingItemsByOrganization(_orgs[0].id);
          setItems(fetchedItems);
          setSelectedOrgId(_orgs[0].id);
        }
      } else if (organizationId) {
        const fetchedItems = await getTrainingItemsByOrganization(organizationId);
        setItems(fetchedItems);
        setSelectedOrgId(organizationId);
      }
    } catch (err) {
      console.error("Error al cargar datos de entrenamiento", err);
    } finally {
      setIsLoading(false);
    }
  }, [role, organizationId]);

  useEffect(() => {
    if (!loading && user) fetchData();
  }, [loading, user, fetchData]);

  const handleOrgChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const orgId = e.target.value;
    setSelectedOrgId(orgId);
    if (orgId) {
      setIsLoading(true);
      const fetchedItems = await getTrainingItemsByOrganization(orgId);
      setItems(fetchedItems);
      setIsLoading(false);
    }
  };

  const handleAction = async (id: string, action: "approved" | "rejected") => {
    if (!id) return;
    try {
      setItems(prev => prev.map(item => item.id === id ? { ...item, status: action } : item));
      await updateTrainingItemStatus(id, action);
    } catch (err) {
      console.error("Error actualizando status", err);
      fetchData();
    }
  };

  const handleExportDataset = () => {
    const approved = items.filter(i => i.status === "approved");
    if (approved.length === 0) {
      alert("No hay muestras aprobadas para exportar.");
      return;
    }

    // Format as JSONL (compatible with prepare_dataset.py)
    const lines = approved.map(item =>
      JSON.stringify({
        prompt: `<original>${item.original}</original><corrected>`,
        completion: item.aiSuggestion,
        rule: item.rule ?? null,
      })
    );
    const blob = new Blob([lines.join("\n")], { type: "application/jsonl" });

    const today = new Date().toISOString().split("T")[0];
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dataset_editorial_${today}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const canManage = role === "SuperAdmin" || role === "Admin";

  const pending = items.filter(i => i.status === "pending").length;
  const approved = items.filter(i => i.status === "approved").length;
  const rejected = items.filter(i => i.status === "rejected").length;
  const total = items.length;
  const approvalRate = total > 0 ? Math.round((approved / total) * 100) : null;

  if (loading || isLoading) {
    return <div style={{ padding: "2.5rem", color: "var(--text-muted)" }}>Cargando datos de entrenamiento...</div>;
  }

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "1100px", margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1>Entrenamiento IA</h1>
          <p>Aprueba o rechaza muestras para mejorar el modelo específico de la organización.</p>
        </div>
        {canManage && approved > 0 && (
          <button
            className="btn"
            style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            onClick={handleExportDataset}
          >
            <Download size={16} /> Exportar Dataset ({approved})
          </button>
        )}
      </div>

      {/* Org Selector for SuperAdmins */}
      {role === "SuperAdmin" && orgs.length > 0 && (
        <div className="card-static" style={{ marginBottom: "1.5rem", padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
          <label style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-main)", whiteSpace: "nowrap" }}>Entorno:</label>
          <select className="input" value={selectedOrgId} onChange={handleOrgChange} style={{ maxWidth: "280px" }}>
            {orgs.map(org => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <div className="card-static" style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Eye size={20} strokeWidth={1.75} style={{ color: "var(--warning)" }} />
          <div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{pending}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Pendientes de Revisión</div>
          </div>
        </div>
        <div className="card-static" style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <CheckCircle2 size={20} strokeWidth={1.75} style={{ color: "var(--success)" }} />
          <div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{approved}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Aprobadas para Fine-Tuning</div>
          </div>
        </div>
        <div className="card-static" style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <XCircle size={20} strokeWidth={1.75} style={{ color: "var(--danger)" }} />
          <div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{rejected}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Rechazadas</div>
          </div>
        </div>
        {approvalRate !== null && (
          <div className="card-static" style={{ padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ width: "20px", height: "20px", borderRadius: "50%", border: `2px solid ${approvalRate >= 70 ? "var(--success)" : "var(--warning)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: approvalRate >= 70 ? "var(--success)" : "var(--warning)" }} />
            </div>
            <div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: approvalRate >= 70 ? "var(--success)" : "var(--warning)" }}>{approvalRate}%</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Tasa de Aprobación</div>
            </div>
          </div>
        )}
      </div>

      {/* Dataset readiness notice */}
      {canManage && total > 0 && (
        <div style={{
          marginBottom: "1.5rem",
          padding: "0.875rem 1.125rem",
          borderRadius: "var(--radius-md)",
          display: "flex", alignItems: "flex-start", gap: "0.75rem",
          backgroundColor: approved >= 50 ? "rgba(16,185,129,0.06)" : "rgba(245,158,11,0.06)",
          border: `1px solid ${approved >= 50 ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}`,
        }}>
          <Info size={16} style={{ color: approved >= 50 ? "var(--success)" : "var(--warning)", flexShrink: 0, marginTop: "0.125rem" }} />
          <div style={{ fontSize: "0.8375rem", lineHeight: 1.6, color: "var(--text-muted)" }}>
            {approved >= 50 ? (
              <><strong style={{ color: "var(--success)" }}>Dataset listo para fine-tuning.</strong> Tienes {approved} muestras aprobadas. Puedes exportar el JSONL y pasarlo al pipeline de entrenamiento del BSC o a tu proceso de LoRA.</>
            ) : (
              <><strong style={{ color: "var(--warning)" }}>Acumulando muestras.</strong> Tienes {approved} de las ~50 muestras mínimas recomendadas para iniciar un ciclo de fine-tuning. Sigue aprobando correcciones en el editor.</>
            )}
          </div>
        </div>
      )}

      {/* Training Items */}
      {items.length === 0 ? (
        <div className="card-static" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4rem 2rem", textAlign: "center" }}>
          <div style={{ width: "56px", height: "56px", borderRadius: "var(--radius-lg)", backgroundColor: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.25rem", color: "var(--primary)" }}>
            <FolderOpen size={28} strokeWidth={1.75} />
          </div>
          <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-main)" }}>No hay muestras generadas</h3>
          <p style={{ color: "var(--text-muted)", marginTop: "0.5rem", fontSize: "0.875rem" }}>
            El motor de Inferencia aún no ha extraído reglas que requieran entrenamiento o no hay manuscritos ingestados.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {items.map((item) => (
            <div key={item.id} className="card" style={{ padding: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Regla: <span style={{ color: "var(--primary)", marginLeft: "0.25rem" }}>{item.rule}</span>
                </span>
                {item.status === "approved" && <span className="status-badge status-active">APROBADA</span>}
                {item.status === "rejected" && <span className="status-badge status-error">RECHAZADA</span>}
                {item.status === "pending" && <span className="status-badge status-pending">PENDIENTE</span>}
              </div>

              <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem", fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: "0.875rem" }}>
                <div style={{ flex: 1, padding: "0.625rem 0.875rem", backgroundColor: "rgba(239, 68, 68, 0.06)", borderRadius: "var(--radius-md)", borderLeft: "3px solid var(--danger)" }}>
                  <del style={{ color: "var(--danger)" }}>{item.original}</del>
                </div>
                <span style={{ color: "var(--text-muted)", fontSize: "1rem" }}>→</span>
                <div style={{ flex: 1, padding: "0.625rem 0.875rem", backgroundColor: "rgba(16, 185, 129, 0.06)", borderRadius: "var(--radius-md)", borderLeft: "3px solid var(--success)" }}>
                  <span style={{ color: "var(--success)", fontWeight: 600 }}>{item.aiSuggestion}</span>
                </div>
              </div>

              {item.status === "pending" && canManage && (
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: "0.5rem 1.25rem", display: "flex", alignItems: "center", gap: "0.375rem" }}
                    onClick={() => handleAction(item.id!, "rejected")}
                  >
                    <XCircle size={14} /> Rechazar
                  </button>
                  <button
                    className="btn"
                    style={{ padding: "0.5rem 1.25rem", display: "flex", alignItems: "center", gap: "0.375rem" }}
                    onClick={() => handleAction(item.id!, "approved")}
                  >
                    <CheckCircle2 size={14} /> Aprobar para Entrenamiento
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
