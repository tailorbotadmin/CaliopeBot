"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { computeOrgKPIs, getOrganizations, OrgKPIs, Organization } from "@/lib/firestore";
import {
  BarChart3, TrendingUp, UserCheck, AlertTriangle,
  CheckCircle2, XCircle, RefreshCw, Building2,
} from "lucide-react";

function AcceptBar({ rate }: { rate: number }) {
  const color = rate >= 90 ? "var(--success)" : rate >= 70 ? "var(--warning)" : "var(--danger)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", justifyContent: "flex-end" }}>
      <div style={{ width: "80px", height: "6px", borderRadius: "3px", backgroundColor: "var(--border-color)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${rate}%`, backgroundColor: color, transition: "width 0.6s ease" }} />
      </div>
      <span style={{ fontWeight: 700, color, minWidth: "36px", textAlign: "right", fontSize: "0.875rem" }}>{rate}%</span>
    </div>
  );
}

export default function ReportsPage() {
  const { role, organizationId } = useAuth();
  const [kpis, setKpis] = useState<OrgKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");

  const isSuperAdmin = role === "SuperAdmin";

  const fetchKPIs = useCallback(async (orgId: string) => {
    if (!orgId) return;
    setLoading(true);
    try {
      const data = await computeOrgKPIs(orgId);
      setKpis(data);
    } catch (err) {
      console.error("Error fetching KPIs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      if (isSuperAdmin) {
        const orgList = await getOrganizations();
        setOrgs(orgList);
        if (orgList.length > 0) {
          setSelectedOrgId(orgList[0].id);
          await fetchKPIs(orgList[0].id);
        }
      } else if (organizationId) {
        setSelectedOrgId(organizationId);
        await fetchKPIs(organizationId);
      }
    }
    init();
  }, [isSuperAdmin, organizationId, fetchKPIs]);

  const handleOrgChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedOrgId(id);
    await fetchKPIs(id);
  };

  const globalStats = kpis
    ? [
        { label: "Correcciones Totales", value: String(kpis.totalCorrections), icon: BarChart3, color: "var(--primary-light)", textColor: "var(--primary)" },
        { label: "Tasa de Aceptación", value: `${kpis.globalAcceptRate}%`, icon: TrendingUp, color: "rgba(16,185,129,0.1)", textColor: "var(--success)" },
        { label: "Editores Activos", value: String(kpis.activeEditors), icon: UserCheck, color: "rgba(59,130,246,0.1)", textColor: "#3b82f6" },
        { label: "Regla Más Frecuente", value: kpis.topRule === "—" ? "Sin datos" : kpis.topRule, icon: AlertTriangle, color: "rgba(245,158,11,0.1)", textColor: "var(--warning)", small: true },
      ]
    : [];

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "1100px", margin: "0 auto" }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Reportes y KPIs</h1>
          <p>Métricas de corrección por editor y rendimiento global del sistema.</p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          {isSuperAdmin && orgs.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Building2 size={15} style={{ color: "var(--text-muted)" }} />
              <select
                className="input"
                value={selectedOrgId}
                onChange={handleOrgChange}
                style={{ maxWidth: "240px", marginBottom: 0 }}
              >
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          <button className="btn btn-secondary" onClick={() => fetchKPIs(selectedOrgId)} title="Actualizar">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "4rem", textAlign: "center", color: "var(--text-muted)" }}>Calculando métricas...</div>
      ) : !kpis ? (
        <div style={{ padding: "4rem", textAlign: "center", color: "var(--text-muted)" }}>Sin datos disponibles.</div>
      ) : (
        <>
          {/* Global Stats Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
            {globalStats.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="card-static" style={{ padding: "1.25rem", display: "flex", alignItems: "center", gap: "0.875rem" }}>
                  <div style={{ width: "44px", height: "44px", borderRadius: "var(--radius-lg)", backgroundColor: s.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={20} strokeWidth={1.75} style={{ color: s.textColor }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: s.small ? "1rem" : "1.5rem", fontWeight: 700, color: s.textColor, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: "0.125rem" }}>{s.label}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Accepted / Rejected summary */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "2rem" }}>
            <div className="card-static" style={{ padding: "1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
              <CheckCircle2 size={28} style={{ color: "var(--success)", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--text-main)" }}>{kpis.totalAccepted}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Correcciones aceptadas</div>
              </div>
            </div>
            <div className="card-static" style={{ padding: "1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
              <XCircle size={28} style={{ color: "var(--danger)", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--text-main)" }}>{kpis.totalRejected}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Correcciones rechazadas</div>
              </div>
            </div>
          </div>

          {/* Editor Performance Table */}
          <div className="card-static" style={{ overflow: "hidden" }}>
            <div style={{ padding: "1.25rem 1.75rem", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)" }}>Rendimiento por Editor</h2>
              <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>{kpis.editors.length} editores</span>
            </div>

            {kpis.editors.length === 0 ? (
              <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.875rem" }}>
                Aún no hay correcciones revisadas. Activa el flujo de corrección para ver métricas.
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
                  {kpis.editors.map((e) => (
                    <tr key={e.editorId} style={{ borderBottom: "1px solid var(--border-color)" }}>
                      <td style={{ padding: "0.875rem 1.25rem" }}>
                        <div style={{ fontWeight: 600, color: "var(--text-main)" }}>{e.editorName}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{e.editorEmail}</div>
                      </td>
                      <td style={{ padding: "0.875rem 1.25rem", textAlign: "right", fontWeight: 600, color: "var(--text-main)" }}>{e.totalReviewed}</td>
                      <td style={{ padding: "0.875rem 1.25rem", textAlign: "right", color: "var(--success)", fontWeight: 600 }}>{e.accepted}</td>
                      <td style={{ padding: "0.875rem 1.25rem" }}>
                        <AcceptBar rate={e.acceptRate} />
                      </td>
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

          {/* Empty state note */}
          {kpis.totalCorrections === 0 && (
            <div style={{ marginTop: "1.5rem", padding: "1rem 1.25rem", backgroundColor: "rgba(99,102,241,0.06)", borderRadius: "var(--radius-md)", borderLeft: "3px solid var(--primary)", fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
              <strong style={{ color: "var(--text-main)" }}>Sin correcciones registradas aún.</strong> Los KPIs se actualizan automáticamente cada vez que un editor acepta o rechaza una sugerencia del pipeline de corrección.
            </div>
          )}
        </>
      )}
    </div>
  );
}
