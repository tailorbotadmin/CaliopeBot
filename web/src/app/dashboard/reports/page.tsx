"use client";

import { useAuth } from "@/lib/auth-context";
import { BarChart3, TrendingUp, UserCheck, AlertTriangle } from "lucide-react";

type CorrectorKPI = {
  name: string;
  email: string;
  totalReviewed: number;
  acceptRate: number;
  avgTimeMinutes: number;
  topRule: string;
};

const mockCorrectors: CorrectorKPI[] = [
  {
    name: "María García",
    email: "maria@editorial.com",
    totalReviewed: 342,
    acceptRate: 91,
    avgTimeMinutes: 3.2,
    topRule: "Tildes en hiatos",
  },
  {
    name: "Carlos López",
    email: "carlos@editorial.com",
    totalReviewed: 218,
    acceptRate: 87,
    avgTimeMinutes: 4.1,
    topRule: "Concordancia sujeto-verbo",
  },
  {
    name: "Ana Rodríguez",
    email: "ana@editorial.com",
    totalReviewed: 156,
    acceptRate: 94,
    avgTimeMinutes: 2.8,
    topRule: "Comillas latinas",
  },
];

const globalStats = [
  { label: "Total Correcciones", value: "716", icon: BarChart3, color: "var(--primary-light)" },
  { label: "Tasa de Aceptación", value: "90.7%", icon: TrendingUp, color: "rgba(16, 185, 129, 0.1)" },
  { label: "Correctores Activos", value: "3", icon: UserCheck, color: "rgba(59, 130, 246, 0.1)" },
  { label: "Regla Más Frecuente", value: "Tildes", icon: AlertTriangle, color: "rgba(245, 158, 11, 0.1)" },
];

export default function ReportsPage() {
  const { role } = useAuth();

  return (
    <div className="fade-in" style={{ padding: "2.5rem", maxWidth: "1100px", margin: "0 auto" }}>
      <div className="page-header">
        <div>
          <h1>Reportes y KPIs</h1>
          <p>Métricas de corrección por corrector y rendimiento global del sistema.</p>
        </div>
      </div>

      {/* Global Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        {globalStats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="card-static" style={{ display: "flex", alignItems: "center", gap: "0.875rem", padding: "1.25rem" }}>
              <div style={{ width: "44px", height: "44px", borderRadius: "var(--radius-lg)", backgroundColor: s.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon size={20} strokeWidth={1.75} style={{ color: "var(--text-main)" }} />
              </div>
              <div>
                <div style={{ fontSize: "1.375rem", fontWeight: 700, color: "var(--text-main)", lineHeight: 1.2 }}>{s.value}</div>
                <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: "0.125rem" }}>{s.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Corrector Table */}
      <div className="card-static" style={{ overflow: "hidden" }}>
        <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border-color)" }}>
          <h2 style={{ fontSize: "1.0625rem", fontWeight: 700, color: "var(--text-main)" }}>Rendimiento por Corrector</h2>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ backgroundColor: "var(--bg-color)" }}>
              <th style={{ padding: "0.75rem 1.5rem", textAlign: "left", fontWeight: 600, color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Corrector</th>
              <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontWeight: 600, color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Revisadas</th>
              <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontWeight: 600, color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Tasa Acept.</th>
              <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontWeight: 600, color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Tiempo Medio</th>
              <th style={{ padding: "0.75rem 1.5rem", textAlign: "left", fontWeight: 600, color: "var(--text-muted)", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Regla Más Común</th>
            </tr>
          </thead>
          <tbody>
            {mockCorrectors.map((c, i) => (
              <tr key={c.email} style={{ borderTop: "1px solid var(--border-color)" }}>
                <td style={{ padding: "0.875rem 1.5rem" }}>
                  <div style={{ fontWeight: 600, color: "var(--text-main)" }}>{c.name}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{c.email}</div>
                </td>
                <td style={{ padding: "0.875rem 1rem", textAlign: "right", fontWeight: 600, color: "var(--text-main)" }}>{c.totalReviewed}</td>
                <td style={{ padding: "0.875rem 1rem", textAlign: "right" }}>
                  <span style={{ fontWeight: 700, color: c.acceptRate >= 90 ? "var(--success)" : "var(--warning)" }}>
                    {c.acceptRate}%
                  </span>
                </td>
                <td style={{ padding: "0.875rem 1rem", textAlign: "right", color: "var(--text-muted)" }}>{c.avgTimeMinutes} min</td>
                <td style={{ padding: "0.875rem 1.5rem" }}>
                  <span style={{ padding: "0.125rem 0.5rem", backgroundColor: "var(--primary-light)", color: "var(--primary)", borderRadius: "var(--radius-full)", fontSize: "0.75rem", fontWeight: 600 }}>
                    {c.topRule}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
